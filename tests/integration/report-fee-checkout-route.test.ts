import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { hashToken, SESSION_COOKIE_NAME } from "@/server/auth";
import { prisma } from "@/server/db";
import { POST } from "../../app/api/v1/sourcing-requests/[requestId]/report-fee/checkout/route";

describe("POST /api/v1/sourcing-requests/:requestId/report-fee/checkout", () => {
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

  async function seedReportReadyRequest(options?: {
    reportPaymentRequired?: boolean;
    status?: "SUBMITTED" | "IN_REVIEW" | "REPORT_READY" | "PAYMENT_PENDING" | "PAYMENT_SETTLED" | "DELIVERED" | "CANCELLED";
  }) {
    const owner = await prisma.user.create({
      data: {
        email: "owner-report-fee-checkout@example.com",
        passwordHash: "hash",
        role: "USER"
      }
    });
    const other = await prisma.user.create({
      data: {
        email: "other-report-fee-checkout@example.com",
        passwordHash: "hash",
        role: "USER"
      }
    });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
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
        userId: owner.id,
        prescriptionId: prescription.id,
        status: options?.status ?? "REPORT_READY",
        reportPaymentRequired: options?.reportPaymentRequired ?? true,
        reportFeeCents: 2490,
        currency: "CHF"
      }
    });

    return { owner, other, request };
  }

  it("returns 401 when session cookie is missing", async () => {
    const { request } = await seedReportReadyRequest();

    const response = await POST(
      new NextRequest(
        `http://localhost/api/v1/sourcing-requests/${request.id}/report-fee/checkout`,
        { method: "POST" }
      ),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    const payload = (await response.json()) as { error: { code: string } };
    expect(response.status).toBe(401);
    expect(payload.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 403 when request does not belong to caller", async () => {
    const { other, request } = await seedReportReadyRequest();
    const cookie = await issueSessionCookie(other.id);

    const response = await POST(
      new NextRequest(
        `http://localhost/api/v1/sourcing-requests/${request.id}/report-fee/checkout`,
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

  it("returns 409 when report fee is not required", async () => {
    const { owner, request } = await seedReportReadyRequest({
      reportPaymentRequired: false
    });
    const cookie = await issueSessionCookie(owner.id);

    const response = await POST(
      new NextRequest(
        `http://localhost/api/v1/sourcing-requests/${request.id}/report-fee/checkout`,
        {
          method: "POST",
          headers: { cookie }
        }
      ),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    const payload = (await response.json()) as { error: { code: string } };
    expect(response.status).toBe(409);
    expect(payload.error.code).toBe("REPORT_FEE_NOT_REQUIRED");
  });

  it("transitions REPORT_READY -> PAYMENT_PENDING and writes status/audit events", async () => {
    const { owner, request } = await seedReportReadyRequest();
    const cookie = await issueSessionCookie(owner.id);

    const response = await POST(
      new NextRequest(
        `http://localhost/api/v1/sourcing-requests/${request.id}/report-fee/checkout`,
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
    };

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      requestId: request.id,
      status: "PAYMENT_PENDING",
      reportFee: {
        paymentState: "PENDING"
      }
    });

    const statusEvent = await prisma.sourcingStatusEvent.findFirst({
      where: {
        sourcingRequestId: request.id,
        toStatus: "PAYMENT_PENDING"
      }
    });
    expect(statusEvent).not.toBeNull();
    expect(statusEvent?.fromStatus).toBe("REPORT_READY");
    expect(statusEvent?.actorUserId).toBe(owner.id);

    const auditEvent = await prisma.auditEvent.findFirst({
      where: {
        sourcingRequestId: request.id,
        action: "REPORT_FEE_CHECKOUT_INITIATED"
      }
    });
    expect(auditEvent).not.toBeNull();
    expect(auditEvent?.actorUserId).toBe(owner.id);
    expect(auditEvent?.context).toMatchObject({
      fromStatus: "REPORT_READY",
      toStatus: "PAYMENT_PENDING",
      product: "REPORT_SERVICE"
    });
  });

  it("is idempotent and does not duplicate status/audit events after first checkout init", async () => {
    const { owner, request } = await seedReportReadyRequest();
    const cookie = await issueSessionCookie(owner.id);

    const firstResponse = await POST(
      new NextRequest(
        `http://localhost/api/v1/sourcing-requests/${request.id}/report-fee/checkout`,
        {
          method: "POST",
          headers: { cookie }
        }
      ),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    const secondResponse = await POST(
      new NextRequest(
        `http://localhost/api/v1/sourcing-requests/${request.id}/report-fee/checkout`,
        {
          method: "POST",
          headers: { cookie }
        }
      ),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);

    const statusEvents = await prisma.sourcingStatusEvent.findMany({
      where: {
        sourcingRequestId: request.id,
        toStatus: "PAYMENT_PENDING"
      }
    });
    expect(statusEvents).toHaveLength(1);

    const auditEvents = await prisma.auditEvent.findMany({
      where: {
        sourcingRequestId: request.id,
        action: "REPORT_FEE_CHECKOUT_INITIATED"
      }
    });
    expect(auditEvents).toHaveLength(1);
  });
});
