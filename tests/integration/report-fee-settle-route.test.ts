import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { hashToken, SESSION_COOKIE_NAME } from "@/server/auth";
import { prisma } from "@/server/db";
import { POST } from "../../app/api/v1/admin/sourcing-requests/[requestId]/report-fee/settle/route";

describe("POST /api/v1/admin/sourcing-requests/:requestId/report-fee/settle", () => {
  beforeEach(async () => {
    await prisma.auditEvent.deleteMany();
    await prisma.reportArtifact.deleteMany();
    await prisma.sourcingStatusEvent.deleteMany();
    await prisma.sourcingRequest.deleteMany();
    await prisma.prescription.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });

  async function issueSessionCookie(userId: string): Promise<string> {
    const token = `session-${randomUUID()}`;
    await prisma.session.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        ipHash: null,
        userAgentHash: null
      }
    });

    return `${SESSION_COOKIE_NAME}=${token}`;
  }

  async function seedPendingSettlementRequest(options?: {
    status?: "REPORT_READY" | "PAYMENT_PENDING" | "PAYMENT_SETTLED" | "DELIVERED";
    reportPaymentRequired?: boolean;
  }) {
    const admin = await prisma.user.create({
      data: {
        email: "admin-report-fee-settlement@example.com",
        passwordHash: "hash",
        role: "ADMIN"
      }
    });
    const nonAdmin = await prisma.user.create({
      data: {
        email: "user-report-fee-settlement@example.com",
        passwordHash: "hash",
        role: "USER"
      }
    });

    const prescription = await prisma.prescription.create({
      data: {
        userId: nonAdmin.id,
        countryCode: "NL",
        payload: {
          countryCode: "NL",
          leftEye: { sphere: -1.5 },
          rightEye: { sphere: -1.25 },
          pupillaryDistance: 62
        }
      }
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: nonAdmin.id,
        prescriptionId: prescription.id,
        status: options?.status ?? "PAYMENT_PENDING",
        reportPaymentRequired: options?.reportPaymentRequired ?? true,
        reportFeeCents: 2490,
        currency: "CHF"
      }
    });

    return { admin, nonAdmin, request };
  }

  it("returns 401 when session cookie is missing", async () => {
    const { request } = await seedPendingSettlementRequest();

    const response = await POST(
      new NextRequest(
        `http://localhost/api/v1/admin/sourcing-requests/${request.id}/report-fee/settle`,
        { method: "POST" }
      ),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    const payload = (await response.json()) as { error: { code: string } };
    expect(response.status).toBe(401);
    expect(payload.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 403 for non-admin sessions", async () => {
    const { nonAdmin, request } = await seedPendingSettlementRequest();
    const cookie = await issueSessionCookie(nonAdmin.id);

    const response = await POST(
      new NextRequest(
        `http://localhost/api/v1/admin/sourcing-requests/${request.id}/report-fee/settle`,
        {
          method: "POST",
          headers: { cookie }
        }
      ),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    const payload = (await response.json()) as { error: { code: string } };
    expect(response.status).toBe(403);
    expect(payload.error.code).toBe("FORBIDDEN");
  });

  it("transitions PAYMENT_PENDING -> PAYMENT_SETTLED and writes status/audit events", async () => {
    const { admin, request } = await seedPendingSettlementRequest();
    const cookie = await issueSessionCookie(admin.id);

    const response = await POST(
      new NextRequest(
        `http://localhost/api/v1/admin/sourcing-requests/${request.id}/report-fee/settle`,
        {
          method: "POST",
          headers: { cookie }
        }
      ),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    const payload = (await response.json()) as {
      requestId: string;
      status: string;
      reportFee: { paymentState: string };
      settlement: { settledByUserId: string | null; settledAt: string | null };
    };

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      requestId: request.id,
      status: "PAYMENT_SETTLED",
      reportFee: {
        paymentState: "SETTLED"
      },
      settlement: {
        settledByUserId: admin.id
      }
    });
    expect(payload.settlement.settledAt).toBeTruthy();

    const statusEvent = await prisma.sourcingStatusEvent.findFirst({
      where: {
        sourcingRequestId: request.id,
        toStatus: "PAYMENT_SETTLED"
      }
    });
    expect(statusEvent?.fromStatus).toBe("PAYMENT_PENDING");
    expect(statusEvent?.actorUserId).toBe(admin.id);

    const auditEvent = await prisma.auditEvent.findFirst({
      where: {
        sourcingRequestId: request.id,
        action: "REPORT_FEE_SETTLEMENT_RECORDED"
      }
    });
    expect(auditEvent?.actorUserId).toBe(admin.id);
    expect(auditEvent?.context).toMatchObject({
      fromStatus: "PAYMENT_PENDING",
      toStatus: "PAYMENT_SETTLED",
      product: "REPORT_SERVICE"
    });
  });

  it("returns 409 when request is not in PAYMENT_PENDING state", async () => {
    const { admin, request } = await seedPendingSettlementRequest({
      status: "REPORT_READY"
    });
    const cookie = await issueSessionCookie(admin.id);

    const response = await POST(
      new NextRequest(
        `http://localhost/api/v1/admin/sourcing-requests/${request.id}/report-fee/settle`,
        {
          method: "POST",
          headers: { cookie }
        }
      ),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    const payload = (await response.json()) as { error: { code: string } };
    expect(response.status).toBe(409);
    expect(payload.error.code).toBe("PAYMENT_NOT_PENDING");
  });

  it("is idempotent and does not duplicate status/audit events after settlement", async () => {
    const { admin, request } = await seedPendingSettlementRequest();
    const cookie = await issueSessionCookie(admin.id);

    const firstResponse = await POST(
      new NextRequest(
        `http://localhost/api/v1/admin/sourcing-requests/${request.id}/report-fee/settle`,
        {
          method: "POST",
          headers: { cookie }
        }
      ),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    const secondResponse = await POST(
      new NextRequest(
        `http://localhost/api/v1/admin/sourcing-requests/${request.id}/report-fee/settle`,
        {
          method: "POST",
          headers: { cookie }
        }
      ),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);

    const secondPayload = (await secondResponse.json()) as {
      settlement: { settledByUserId: string | null; settledAt: string | null };
    };
    expect(secondPayload.settlement).toMatchObject({
      settledByUserId: admin.id
    });
    expect(secondPayload.settlement.settledAt).toBeTruthy();

    const statusEvents = await prisma.sourcingStatusEvent.findMany({
      where: {
        sourcingRequestId: request.id,
        toStatus: "PAYMENT_SETTLED"
      }
    });
    expect(statusEvents).toHaveLength(1);

    const auditEvents = await prisma.auditEvent.findMany({
      where: {
        sourcingRequestId: request.id,
        action: "REPORT_FEE_SETTLEMENT_RECORDED"
      }
    });
    expect(auditEvents).toHaveLength(1);
  });

  it("supports form-submit redirects for admin queue detail", async () => {
    const { admin, request } = await seedPendingSettlementRequest();
    const cookie = await issueSessionCookie(admin.id);

    const response = await POST(
      new NextRequest(
        `http://localhost/api/v1/admin/sourcing-requests/${request.id}/report-fee/settle`,
        {
          method: "POST",
          headers: {
            cookie,
            "content-type": "application/x-www-form-urlencoded"
          },
          body: `redirectTo=${encodeURIComponent(
            `/admin/sourcing-requests?requestId=${request.id}`
          )}`
        }
      ),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    const location = response.headers.get("location");
    expect(location).toBeTruthy();
    const redirected = new URL(location!);
    expect(redirected.pathname).toBe("/admin/sourcing-requests");
    expect(redirected.searchParams.get("requestId")).toBe(request.id);
    expect(redirected.searchParams.get("settled")).toBe("1");
    expect(redirected.searchParams.get("settledBy")).toBe(admin.id);
    expect(redirected.searchParams.get("settledAt")).toBeTruthy();
  });

});
