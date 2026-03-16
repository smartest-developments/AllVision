import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { hashToken, SESSION_COOKIE_NAME } from "@/server/auth";
import { prisma } from "@/server/db";
import { POST } from "../../app/api/v1/sourcing-requests/[requestId]/report-fee/checkout/route";

type ReportFeePayload = {
  paymentState: string;
  pendingReason: "PRICING_IN_PROGRESS" | null;
  checkoutInitiatedAt: string | null;
  settledAt: string | null;
  settledByRole: "USER" | "ADMIN" | null;
  settledByUserId: string | null;
  settledByUserEmail: string | null;
  settlementEventId: string | null;
  settlementNote: string | null;
};

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
      reportFee: ReportFeePayload;
    };

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      requestId: request.id,
      status: "PAYMENT_PENDING",
      reportFee: {
        paymentState: "PENDING",
        pendingReason: null,
        checkoutInitiatedAt: expect.any(String),
        settledAt: null,
        settledByRole: null,
        settledByUserId: null,
        settledByUserEmail: null,
        settlementEventId: null,
        settlementNote: null,
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

  it("returns pendingReason metadata when checkout starts without finalized fee amount", async () => {
    const { owner, request } = await seedReportReadyRequest();
    await prisma.sourcingRequest.update({
      where: { id: request.id },
      data: { reportFeeCents: null },
    });
    const cookie = await issueSessionCookie(owner.id);

    const response = await POST(
      new NextRequest(
        `http://localhost/api/v1/sourcing-requests/${request.id}/report-fee/checkout`,
        {
          method: "POST",
          headers: { cookie },
        },
      ),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    const payload = (await response.json()) as {
      reportFee: ReportFeePayload;
    };

    expect(response.status).toBe(200);
    expect(payload.reportFee.paymentState).toBe("PENDING");
    expect(payload.reportFee.pendingReason).toBe("PRICING_IN_PROGRESS");
    expect(payload.reportFee.checkoutInitiatedAt).toEqual(expect.any(String));
    expect(payload.reportFee.settledAt).toBeNull();
    expect(payload.reportFee.settledByRole).toBeNull();
    expect(payload.reportFee.settledByUserId).toBeNull();
    expect(payload.reportFee.settledByUserEmail).toBeNull();
    expect(payload.reportFee.settlementEventId).toBeNull();
    expect(payload.reportFee.settlementNote).toBeNull();
  });

  it("returns settlement actor email metadata when checkout is idempotent on settled requests", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "owner-report-fee-checkout-settled@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "admin-report-fee-checkout-settled@example.com",
        passwordHash: "hash",
        role: "ADMIN",
      },
    });
    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: {
          countryCode: "NL",
          leftEye: { sphere: -1.25 },
          rightEye: { sphere: -1.0 },
          pupillaryDistance: 63,
        },
      },
    });
    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        reportFeeCents: 2490,
        currency: "CHF",
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "REPORT_READY",
        toStatus: "PAYMENT_PENDING",
        actorUserId: owner.id,
        note: "Owner initiated report-fee checkout.",
        createdAt: new Date("2026-03-10T04:10:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "Payment settled by admin.",
        createdAt: new Date("2026-03-10T05:15:00.000Z"),
      },
    });
    const cookie = await issueSessionCookie(owner.id);

    const response = await POST(
      new NextRequest(
        `http://localhost/api/v1/sourcing-requests/${request.id}/report-fee/checkout`,
        {
          method: "POST",
          headers: { cookie },
        },
      ),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    const payload = (await response.json()) as { status: string; reportFee: ReportFeePayload };

    expect(response.status).toBe(200);
    expect(payload.status).toBe("PAYMENT_SETTLED");
    expect(payload.reportFee.paymentState).toBe("SETTLED");
    expect(payload.reportFee.pendingReason).toBeNull();
    expect(payload.reportFee.checkoutInitiatedAt).toBe("2026-03-10T04:10:00.000Z");
    expect(payload.reportFee.settledAt).toBe("2026-03-10T05:15:00.000Z");
    expect(payload.reportFee.settledByRole).toBe("ADMIN");
    expect(payload.reportFee.settledByUserId).toBe(admin.id);
    expect(payload.reportFee.settledByUserEmail).toBe(admin.email);
    expect(payload.reportFee.settlementEventId).toBeTruthy();
    expect(payload.reportFee.settlementNote).toBe("Payment settled by admin.");
  });

  it("appends settlement actor query metadata on safe form redirects when settled actor evidence exists", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "owner-report-fee-checkout-settled-redirect@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "admin-report-fee-checkout-settled-redirect@example.com",
        passwordHash: "hash",
        role: "ADMIN",
      },
    });
    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "CH",
        payload: {
          countryCode: "CH",
          leftEye: { sphere: -1.0 },
          rightEye: { sphere: -0.75 },
          pupillaryDistance: 61,
        },
      },
    });
    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        reportFeeCents: 2490,
        currency: "CHF",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "Payment settled by admin.",
        createdAt: new Date("2026-03-11T00:50:00.000Z"),
      },
    });
    const cookie = await issueSessionCookie(owner.id);

    const response = await POST(
      new NextRequest(
        `http://localhost/api/v1/sourcing-requests/${request.id}/report-fee/checkout`,
        {
          method: "POST",
          headers: {
            cookie,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: `redirectTo=${encodeURIComponent(`/timeline?requestId=${request.id}&checkout=1`)}`,
        },
      ),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    const location = response.headers.get("location");
    expect(location).toBeTruthy();
    expect(location).toContain(`/timeline?requestId=${request.id}&checkout=1`);
    expect(location).toContain(
      `settledAt=${encodeURIComponent("2026-03-11T00:50:00.000Z")}`,
    );
    expect(location).toContain("settledByRole=ADMIN");
    expect(location).toContain(`settledByUserId=${encodeURIComponent(admin.id)}`);
    expect(location).toContain(
      `settledByUserEmail=${encodeURIComponent(admin.email)}`,
    );
    expect(location).toContain("settlementEventId=");
    expect(location).toContain(
      `settlementNote=${encodeURIComponent("Payment settled by admin.")}`,
    );
  });

  it("keeps settledAt, settledByRole, settledByUserId, settledByUserEmail, settlementEventId, and settlementNote redirect metadata absent when checkout redirect has no immutable settlement evidence", async () => {
    const { owner, request } = await seedReportReadyRequest();
    const cookie = await issueSessionCookie(owner.id);

    const response = await POST(
      new NextRequest(
        `http://localhost/api/v1/sourcing-requests/${request.id}/report-fee/checkout`,
        {
          method: "POST",
          headers: {
            cookie,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: `redirectTo=${encodeURIComponent(`/timeline?requestId=${request.id}&checkout=1`)}`,
        },
      ),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    const location = response.headers.get("location");
    expect(location).toBeTruthy();
    expect(location).toContain(`/timeline?requestId=${request.id}&checkout=1`);
    expect(location).not.toContain("settledAt=");
    expect(location).not.toContain("settledByRole=");
    expect(location).not.toContain("settledByUserId=");
    expect(location).not.toContain("settledByUserEmail=");
    expect(location).not.toContain("settlementEventId=");
    expect(location).not.toContain("settlementNote=");
  });

  it("keeps settled redirect actor-role/id/email metadata omitted together when immutable settlement evidence has no actor identity", async () => {
    const { owner, request } = await seedReportReadyRequest();
    const cookie = await issueSessionCookie(owner.id);

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "REPORT_READY",
        toStatus: "PAYMENT_PENDING",
        actorUserId: owner.id,
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        note: "Settlement evidence without actor identity.",
        createdAt: new Date("2026-03-11T02:10:00.000Z"),
      },
    });

    const response = await POST(
      new NextRequest(
        `http://localhost/api/v1/sourcing-requests/${request.id}/report-fee/checkout`,
        {
          method: "POST",
          headers: {
            cookie,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: `redirectTo=${encodeURIComponent(`/timeline?requestId=${request.id}&checkout=1`)}`,
        },
      ),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    const location = response.headers.get("location");
    expect(location).toBeTruthy();
    expect(location).toContain(`/timeline?requestId=${request.id}&checkout=1`);
    expect(location).toContain(
      `settledAt=${encodeURIComponent("2026-03-11T02:10:00.000Z")}`,
    );
    expect(location).toContain("settlementEventId=");
    expect(location).toContain(
      `settlementNote=${encodeURIComponent("Settlement evidence without actor identity.")}`,
    );
    expect(location).not.toContain("settledByRole=");
    expect(location).not.toContain("settledByUserId=");
    expect(location).not.toContain("settledByUserEmail=");
  });

  it("keeps settled redirect actor metadata aligned to one immutable actor source", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "owner-checkout-redirect-metadata-alignment@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "admin-checkout-redirect-metadata-alignment@example.com",
        passwordHash: "hash",
        role: "ADMIN",
      },
    });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "CH",
        payload: {
          countryCode: "CH",
          leftEye: { sphere: -1.0 },
          rightEye: { sphere: -0.75 },
          pupillaryDistance: 61,
        },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "REPORT_READY",
        reportPaymentRequired: true,
        reportFeeCents: 2590,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "REPORT_READY",
        toStatus: "PAYMENT_PENDING",
        actorUserId: owner.id,
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "Payment settled by admin.",
        createdAt: new Date("2026-03-11T01:15:00.000Z"),
      },
    });
    const cookie = await issueSessionCookie(owner.id);

    const response = await POST(
      new NextRequest(
        `http://localhost/api/v1/sourcing-requests/${request.id}/report-fee/checkout`,
        {
          method: "POST",
          headers: {
            cookie,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: `redirectTo=${encodeURIComponent(`/timeline?requestId=${request.id}&checkout=1`)}`,
        },
      ),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    const location = response.headers.get("location");
    expect(location).toBeTruthy();
    const redirectUrl = new URL(location ?? "", "http://localhost");
    expect(redirectUrl.searchParams.get("settledByRole")).toBe("ADMIN");
    expect(redirectUrl.searchParams.get("settledByUserId")).toBe(admin.id);
    expect(redirectUrl.searchParams.get("settledByUserEmail")).toBe(admin.email);
    const settledActorKeys = Array.from(redirectUrl.searchParams.keys()).filter((key) =>
      key.startsWith("settledBy"),
    );
    expect(settledActorKeys.sort()).toEqual(
      ["settledByRole", "settledByUserId", "settledByUserEmail"].sort(),
    );
    expect(redirectUrl.searchParams.get("settledByUserId")).not.toBe(owner.id);
    expect(redirectUrl.searchParams.get("settledByUserEmail")).not.toBe(owner.email);
  });
});
