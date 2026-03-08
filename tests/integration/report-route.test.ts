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
      };
    };

    expect(response.status).toBe(200);
    expect(payload.reportFee).toEqual({
      product: "REPORT_SERVICE",
      required: true,
      feeCents: 2590,
      currency: "CHF",
      paymentState: "PENDING",
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
      };
    };

    expect(response.status).toBe(200);
    expect(payload.reportFee.paymentState).toBe("SETTLED");
  });
});
