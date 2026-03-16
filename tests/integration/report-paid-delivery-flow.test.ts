import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { hashToken, SESSION_COOKIE_NAME } from "@/server/auth";
import { prisma } from "@/server/db";
import { POST as ackReport } from "../../app/api/v1/sourcing-requests/[requestId]/report/ack/route";
import { POST as checkoutReportFee } from "../../app/api/v1/sourcing-requests/[requestId]/report-fee/checkout/route";
import { POST as settleReportFee } from "../../app/api/v1/admin/sourcing-requests/[requestId]/report-fee/settle/route";

describe("paid report delivery end-to-end flow", () => {
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

  async function seedPaidReportReadyRequest() {
    const owner = await prisma.user.create({
      data: {
        email: "owner-e2e-flow@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "admin-e2e-flow@example.com",
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
        reportFeeCents: 2490,
        currency: "CHF",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: admin.id,
        storageKey: "reports/e2e-flow.pdf",
        checksumSha256: "e2e-flow-sha",
        deliveryChannel: "email",
      },
    });

    return { owner, admin, request };
  }

  it("supports REPORT_READY -> PAYMENT_PENDING -> PAYMENT_SETTLED -> DELIVERED", async () => {
    const { owner, admin, request } = await seedPaidReportReadyRequest();
    const ownerCookie = await issueSessionCookie(owner.id);
    const adminCookie = await issueSessionCookie(admin.id);

    const checkoutResponse = await checkoutReportFee(
      new NextRequest(
        `http://localhost/api/v1/sourcing-requests/${request.id}/report-fee/checkout`,
        {
          method: "POST",
          headers: { cookie: ownerCookie },
        },
      ),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(checkoutResponse.status).toBe(200);

    const settleResponse = await settleReportFee(
      new NextRequest(
        `http://localhost/api/v1/admin/sourcing-requests/${request.id}/report-fee/settle`,
        {
          method: "POST",
          headers: { cookie: adminCookie },
        },
      ),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(settleResponse.status).toBe(200);

    const ackResponse = await ackReport(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie: ownerCookie },
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    const ackPayload = (await ackResponse.json()) as {
      requestId: string;
      status: string;
      reportFee: { settledByUserEmail: string | null };
    };

    expect(ackResponse.status).toBe(200);
    expect(ackPayload).toMatchObject({
      requestId: request.id,
      status: "DELIVERED",
      reportFee: { settledByUserEmail: admin.email },
    });

    const statusEvents = await prisma.sourcingStatusEvent.findMany({
      where: { sourcingRequestId: request.id },
      orderBy: { createdAt: "asc" },
      select: { fromStatus: true, toStatus: true },
    });
    expect(statusEvents).toEqual(
      expect.arrayContaining([
        { fromStatus: "REPORT_READY", toStatus: "PAYMENT_PENDING" },
        { fromStatus: "PAYMENT_PENDING", toStatus: "PAYMENT_SETTLED" },
        { fromStatus: "PAYMENT_SETTLED", toStatus: "DELIVERED" },
      ]),
    );

    const auditEvents = await prisma.auditEvent.findMany({
      where: { sourcingRequestId: request.id },
      select: { action: true },
    });
    expect(auditEvents.map((event) => event.action)).toEqual(
      expect.arrayContaining([
        "REPORT_FEE_CHECKOUT_INITIATED",
        "REPORT_FEE_SETTLEMENT_RECORDED",
        "REPORT_DELIVERY_ACKNOWLEDGED",
      ]),
    );

    const finalRequest = await prisma.sourcingRequest.findUnique({ where: { id: request.id } });
    expect(finalRequest?.status).toBe("DELIVERED");
  });
});
