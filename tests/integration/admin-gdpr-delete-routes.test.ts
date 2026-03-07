import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { hashToken, SESSION_COOKIE_NAME } from "@/server/auth";
import { prisma } from "@/server/db";
import { GET as getDeleteQueue } from "../../app/api/v1/admin/gdpr/delete-requests/route";
import { POST as executeDeleteRequest } from "../../app/api/v1/admin/gdpr/delete-requests/[requestId]/execute/route";

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

describe("Admin GDPR delete routes", () => {
  beforeEach(async () => {
    await prisma.auditEvent.deleteMany();
    await prisma.reportArtifact.deleteMany();
    await prisma.sourcingStatusEvent.deleteMany();
    await prisma.sourcingRequest.deleteMany();
    await prisma.prescription.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });

  it("returns 403 for non-admin queue access", async () => {
    const user = await prisma.user.create({
      data: {
        email: "gdpr-queue-user@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });

    const cookie = await issueSessionCookie(user.id);

    const response = await getDeleteQueue(
      new NextRequest("http://localhost/api/v1/admin/gdpr/delete-requests", {
        headers: { cookie },
      }),
    );

    const payload = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(403);
    expect(payload.error.code).toBe("FORBIDDEN");
  });

  it("lists pending deletion requests and excludes executed ones", async () => {
    const admin = await prisma.user.create({
      data: {
        email: "gdpr-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
      },
    });

    const pendingUser = await prisma.user.create({
      data: {
        email: "pending-delete@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });

    const completedUser = await prisma.user.create({
      data: {
        email: "completed-delete@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });

    const pendingEvent = await prisma.auditEvent.create({
      data: {
        actorUserId: pendingUser.id,
        entityType: "User",
        entityId: pendingUser.id,
        action: "GDPR_DELETE_REQUESTED",
        context: { status: "PENDING_REVIEW" },
      },
    });

    const completedRequest = await prisma.auditEvent.create({
      data: {
        actorUserId: completedUser.id,
        entityType: "User",
        entityId: completedUser.id,
        action: "GDPR_DELETE_REQUESTED",
        context: { status: "PENDING_REVIEW" },
      },
    });

    await prisma.auditEvent.create({
      data: {
        actorUserId: admin.id,
        entityType: "User",
        entityId: completedUser.id,
        action: "GDPR_DELETE_COMPLETED",
        context: { requestId: completedRequest.id, status: "ANONYMIZED" },
      },
    });

    const adminCookie = await issueSessionCookie(admin.id);

    const response = await getDeleteQueue(
      new NextRequest("http://localhost/api/v1/admin/gdpr/delete-requests", {
        headers: { cookie: adminCookie },
      }),
    );

    const payload = (await response.json()) as {
      requests: Array<{ requestId: string; userEmail: string; status: string }>;
    };

    expect(response.status).toBe(200);
    expect(payload.requests).toHaveLength(1);
    expect(payload.requests[0]?.requestId).toBe(pendingEvent.id);
    expect(payload.requests[0]?.userEmail).toBe("pending-delete@example.com");
    expect(payload.requests[0]?.status).toBe("PENDING_REVIEW");
  });

  it("executes pending delete request and anonymizes the target user", async () => {
    const admin = await prisma.user.create({
      data: {
        email: "gdpr-admin-exec@example.com",
        passwordHash: "hash",
        role: "ADMIN",
      },
    });

    const targetUser = await prisma.user.create({
      data: {
        email: "gdpr-target-user@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });

    const targetPrescription = await prisma.prescription.create({
      data: {
        userId: targetUser.id,
        countryCode: "CH",
        payload: {
          countryCode: "CH",
          leftEye: { sphere: -1.0 },
          rightEye: { sphere: -1.25 },
          pupillaryDistance: 63,
        },
      },
    });

    const targetRequest = await prisma.sourcingRequest.create({
      data: {
        userId: targetUser.id,
        prescriptionId: targetPrescription.id,
        status: "DELIVERED",
        reportPaymentRequired: false,
        currency: "EUR",
      },
    });

    const reportArtifact = await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: targetRequest.id,
        createdByAdminId: admin.id,
        storageKey: "reports/user-123.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "PORTAL",
        deliveredAt: new Date("2026-03-06T10:00:00.000Z"),
      },
    });

    const deleteRequest = await prisma.auditEvent.create({
      data: {
        actorUserId: targetUser.id,
        entityType: "User",
        entityId: targetUser.id,
        action: "GDPR_DELETE_REQUESTED",
        context: {
          status: "PENDING_REVIEW",
          requestedAt: new Date().toISOString(),
        },
      },
    });

    const adminCookie = await issueSessionCookie(admin.id);

    const response = await executeDeleteRequest(
      new NextRequest(
        `http://localhost/api/v1/admin/gdpr/delete-requests/${deleteRequest.id}/execute`,
        {
          method: "POST",
          headers: { cookie: adminCookie },
        },
      ),
      { params: Promise.resolve({ requestId: deleteRequest.id }) },
    );

    const payload = (await response.json()) as {
      request: {
        requestId: string;
        status: string;
        userId: string;
        reviewedByAdminUserId: string;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.request.requestId).toBe(deleteRequest.id);
    expect(payload.request.status).toBe("ANONYMIZED");
    expect(payload.request.userId).toBe(targetUser.id);
    expect(payload.request.reviewedByAdminUserId).toBe(admin.id);

    const refreshedUser = await prisma.user.findUniqueOrThrow({
      where: { id: targetUser.id },
    });
    expect(refreshedUser.email.startsWith(`deleted-${targetUser.id}-`)).toBe(true);
    expect(refreshedUser.passwordHash.startsWith("deleted:")).toBe(true);

    const refreshedPrescription = await prisma.prescription.findUniqueOrThrow({
      where: { id: targetPrescription.id },
    });
    expect(refreshedPrescription.countryCode).toBe("XX");

    const refreshedArtifact = await prisma.reportArtifact.findUniqueOrThrow({
      where: { id: reportArtifact.id },
    });
    expect(refreshedArtifact.storageKey.startsWith(`deleted:${targetUser.id}:`)).toBe(true);
    expect(refreshedArtifact.checksumSha256).toBeNull();
    expect(refreshedArtifact.deliveryChannel).toBeNull();
    expect(refreshedArtifact.deliveredAt).toBeNull();

    const completedEvent = await prisma.auditEvent.findFirst({
      where: {
        action: "GDPR_DELETE_COMPLETED",
        entityId: targetUser.id,
      },
      orderBy: { createdAt: "desc" },
    });
    expect(completedEvent?.context).toMatchObject({
      requestId: deleteRequest.id,
      status: "ANONYMIZED",
      reviewedByAdminUserId: admin.id,
      revokedSessionCount: 0,
      redactedPrescriptionCount: 1,
      redactedReportArtifactCount: 1,
    });
  });
});
