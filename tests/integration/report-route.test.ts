import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { hashToken, SESSION_COOKIE_NAME } from "@/server/auth";
import { prisma } from "@/server/db";
import { GET } from "../../app/api/v1/sourcing-requests/[requestId]/report/route";

describe("GET /api/v1/sourcing-requests/:requestId/report", () => {
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
        userAgentHash: null,
      },
    });

    return `${SESSION_COOKIE_NAME}=${token}`;
  }

  it("returns report payload with report-fee product metadata", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "owner-report-route@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: {
          countryCode: "NL",
          leftEye: { sphere: -1.5 },
          rightEye: { sphere: -1.25 },
          pupillaryDistance: 62,
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
        currency: "CHF",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-route.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const cookie = await issueSessionCookie(owner.id);

    const response = await GET(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report`, {
        method: "GET",
        headers: { cookie },
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    const payload = (await response.json()) as {
      reportFee: {
        product: string;
        required: boolean;
        feeCents: number | null;
        currency: string;
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
    };

    expect(response.status).toBe(200);
    expect(payload.reportFee).toEqual({
      product: "REPORT_SERVICE",
      required: true,
      feeCents: 2590,
      currency: "CHF",
      paymentState: "PENDING",
      pendingReason: null,
      checkoutInitiatedAt: null,
      settledAt: null,
      settledByRole: null,
      settledByUserId: null,
      settledByUserEmail: null,
      settlementEventId: null,
      settlementNote: null,
    });
  });

  it("returns settled report-fee payment state when request is PAYMENT_SETTLED", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "owner-report-route-settled@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: {
          countryCode: "NL",
          leftEye: { sphere: -1.5 },
          rightEye: { sphere: -1.25 },
          pupillaryDistance: 62,
        },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        reportFeeCents: 2590,
        currency: "CHF",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-route-settled.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const cookie = await issueSessionCookie(owner.id);

    const response = await GET(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report`, {
        method: "GET",
        headers: { cookie },
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    const payload = (await response.json()) as {
      reportFee: {
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
    };

    expect(response.status).toBe(200);
    expect(payload.reportFee.paymentState).toBe("SETTLED");
    expect(payload.reportFee.pendingReason).toBeNull();
    expect(payload.reportFee.checkoutInitiatedAt).toBeNull();
    expect(payload.reportFee.settledAt).toBeNull();
    expect(payload.reportFee.settledByRole).toBeNull();
    expect(payload.reportFee.settledByUserId).toBeNull();
    expect(payload.reportFee.settledByUserEmail).toBeNull();
    expect(payload.reportFee.settlementEventId).toBeNull();
    expect(payload.reportFee.settlementNote).toBeNull();
  });

  it("returns pending-pricing reason when payment is pending and report fee is not finalized", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "owner-report-route-pricing-in-progress@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: {
          countryCode: "NL",
          leftEye: { sphere: -1.5 },
          rightEye: { sphere: -1.25 },
          pupillaryDistance: 62,
        },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "REPORT_READY",
        reportPaymentRequired: true,
        reportFeeCents: null,
        currency: "CHF",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-route-pricing-in-progress.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const cookie = await issueSessionCookie(owner.id);

    const response = await GET(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report`, {
        method: "GET",
        headers: { cookie },
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    const payload = (await response.json()) as {
      reportFee: {
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
    };

    expect(response.status).toBe(200);
    expect(payload.reportFee.paymentState).toBe("PENDING");
    expect(payload.reportFee.pendingReason).toBe("PRICING_IN_PROGRESS");
    expect(payload.reportFee.checkoutInitiatedAt).toBeNull();
    expect(payload.reportFee.settledAt).toBeNull();
    expect(payload.reportFee.settledByRole).toBeNull();
    expect(payload.reportFee.settledByUserId).toBeNull();
    expect(payload.reportFee.settledByUserEmail).toBeNull();
    expect(payload.reportFee.settlementEventId).toBeNull();
    expect(payload.reportFee.settlementNote).toBeNull();
  });

  it("returns checkout initiation timestamp metadata when PAYMENT_PENDING status event exists", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "owner-report-route-checkout-init@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: {
          countryCode: "NL",
          leftEye: { sphere: -1.5 },
          rightEye: { sphere: -1.25 },
          pupillaryDistance: 62,
        },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        reportFeeCents: 2590,
        currency: "CHF",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-route-checkout-init.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "REPORT_READY",
        toStatus: "PAYMENT_PENDING",
        note: "Owner initiated report-fee checkout.",
        createdAt: new Date("2026-03-10T04:50:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);

    const response = await GET(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report`, {
        method: "GET",
        headers: { cookie },
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    const payload = (await response.json()) as {
      reportFee: {
        checkoutInitiatedAt: string | null;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.reportFee.checkoutInitiatedAt).toBe("2026-03-10T04:50:00.000Z");
  });

  it("returns settlement audit metadata when PAYMENT_SETTLED status event exists", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "owner-report-route-settlement-metadata@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "admin-report-route-settlement-metadata@example.com",
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
          leftEye: { sphere: -1.5 },
          rightEye: { sphere: -1.25 },
          pupillaryDistance: 62,
        },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        reportFeeCents: 2590,
        currency: "CHF",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-route-settlement-metadata.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "Payment settled by admin.",
        createdAt: new Date("2026-03-10T05:25:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);

    const response = await GET(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report`, {
        method: "GET",
        headers: { cookie },
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    const payload = (await response.json()) as {
      reportFee: {
        settledAt: string | null;
        settledByRole: "USER" | "ADMIN" | null;
        settledByUserId: string | null;
        settledByUserEmail: string | null;
        settlementEventId: string | null;
        settlementNote: string | null;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.reportFee.settledAt).toBe("2026-03-10T05:25:00.000Z");
    expect(payload.reportFee.settledByRole).toBe("ADMIN");
    expect(payload.reportFee.settledByUserId).toBe(admin.id);
    expect(payload.reportFee.settledByUserEmail).toBe(admin.email);
    expect(payload.reportFee.settlementEventId).toBeTruthy();
    expect(payload.reportFee.settlementNote).toBe("Payment settled by admin.");
  });
});
