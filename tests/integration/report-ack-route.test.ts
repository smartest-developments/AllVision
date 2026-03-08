import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { hashToken, SESSION_COOKIE_NAME } from "@/server/auth";
import { prisma } from "@/server/db";
import { POST } from "../../app/api/v1/sourcing-requests/[requestId]/report/ack/route";

describe("POST /api/v1/sourcing-requests/:requestId/report/ack", () => {
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
    status?: "REPORT_READY" | "PAYMENT_SETTLED";
    reportPaymentRequired?: boolean;
  }) {
    const owner = await prisma.user.create({
      data: {
        email: "owner-ack@example.com",
        passwordHash: "hash",
        role: "USER"
      }
    });
    const other = await prisma.user.create({
      data: {
        email: "other-ack@example.com",
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
        reportPaymentRequired: options?.reportPaymentRequired ?? false,
        currency: "EUR"
      }
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email"
      }
    });

    return { owner, other, request };
  }

  it("returns 401 when session cookie is missing", async () => {
    const { request } = await seedReportReadyRequest();

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST"
      }),
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
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie }
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    const payload = (await response.json()) as { error: { code: string } };
    expect(response.status).toBe(403);
    expect(payload.error.code).toBe("FORBIDDEN");
  });

  it("marks report as delivered and writes immutable delivery acknowledgment audit event", async () => {
    const { owner, request } = await seedReportReadyRequest();
    const cookie = await issueSessionCookie(owner.id);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie }
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    const payload = (await response.json()) as {
      requestId: string;
      status: string;
    };

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      requestId: request.id,
      status: "DELIVERED"
    });

    const statusEvent = await prisma.sourcingStatusEvent.findFirst({
      where: {
        sourcingRequestId: request.id,
        toStatus: "DELIVERED"
      }
    });
    expect(statusEvent).not.toBeNull();
    expect(statusEvent?.fromStatus).toBe("REPORT_READY");
    expect(statusEvent?.actorUserId).toBe(owner.id);

    const auditEvent = await prisma.auditEvent.findFirst({
      where: {
        sourcingRequestId: request.id,
        action: "REPORT_DELIVERY_ACKNOWLEDGED"
      }
    });
    expect(auditEvent).not.toBeNull();
    expect(auditEvent?.actorUserId).toBe(owner.id);
    expect(auditEvent?.entityType).toBe("SourcingRequest");
    expect(auditEvent?.context).toMatchObject({
      fromStatus: "REPORT_READY",
      toStatus: "DELIVERED"
    });
  });

  it("allows acknowledgment after report-fee settlement", async () => {
    const { owner, request } = await seedReportReadyRequest({
      status: "PAYMENT_SETTLED",
      reportPaymentRequired: true
    });
    const cookie = await issueSessionCookie(owner.id);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie }
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    const payload = (await response.json()) as {
      requestId: string;
      status: string;
    };

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      requestId: request.id,
      status: "DELIVERED"
    });

    const statusEvent = await prisma.sourcingStatusEvent.findFirst({
      where: {
        sourcingRequestId: request.id,
        toStatus: "DELIVERED"
      }
    });
    expect(statusEvent?.fromStatus).toBe("PAYMENT_SETTLED");
  });

  it("is idempotent after first acknowledgment and does not duplicate audit/status events", async () => {
    const { owner, request } = await seedReportReadyRequest();
    const cookie = await issueSessionCookie(owner.id);

    const firstResponse = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie }
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    const secondResponse = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie }
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);

    const statusEvents = await prisma.sourcingStatusEvent.findMany({
      where: {
        sourcingRequestId: request.id,
        toStatus: "DELIVERED"
      }
    });
    expect(statusEvents).toHaveLength(1);

    const auditEvents = await prisma.auditEvent.findMany({
      where: {
        sourcingRequestId: request.id,
        action: "REPORT_DELIVERY_ACKNOWLEDGED"
      }
    });
    expect(auditEvents).toHaveLength(1);
  });
});
