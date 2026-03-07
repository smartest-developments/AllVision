import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { hashToken, SESSION_COOKIE_NAME } from "@/server/auth";
import { prisma } from "@/server/db";
import {
  PATCH as patchAdminRequestStatus,
  POST as postAdminRequestStatus,
} from "../../app/api/v1/admin/sourcing-requests/[requestId]/status/route";

describe("PATCH /api/v1/admin/sourcing-requests/:requestId/status", () => {
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

  async function seedReviewRequest() {
    const admin = await prisma.user.create({
      data: {
        email: "admin-review@example.com",
        passwordHash: "hash",
        role: "ADMIN",
      },
    });

    const user = await prisma.user.create({
      data: {
        email: "review-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });

    const prescription = await prisma.prescription.create({
      data: {
        userId: user.id,
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
        userId: user.id,
        prescriptionId: prescription.id,
        status: "SUBMITTED",
        reportPaymentRequired: false,
        currency: "EUR",
      },
    });

    return { admin, user, request };
  }

  it("returns 401 when session cookie is missing", async () => {
    const { request } = await seedReviewRequest();

    const response = await patchAdminRequestStatus(
      new NextRequest(`http://localhost/api/v1/admin/sourcing-requests/${request.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ toStatus: "IN_REVIEW" }),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    const payload = (await response.json()) as { error: { code: string } };
    expect(response.status).toBe(401);
    expect(payload.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 403 for non-admin role", async () => {
    const { request, user } = await seedReviewRequest();
    const userCookie = await issueSessionCookie(user.id);

    const response = await patchAdminRequestStatus(
      new NextRequest(`http://localhost/api/v1/admin/sourcing-requests/${request.id}/status`, {
        method: "PATCH",
        headers: { cookie: userCookie },
        body: JSON.stringify({ toStatus: "IN_REVIEW" }),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    const payload = (await response.json()) as { error: { code: string } };
    expect(response.status).toBe(403);
    expect(payload.error.code).toBe("FORBIDDEN");
  });

  it("returns 400 for invalid decision payload", async () => {
    const { admin, request } = await seedReviewRequest();
    const adminCookie = await issueSessionCookie(admin.id);

    const response = await patchAdminRequestStatus(
      new NextRequest(`http://localhost/api/v1/admin/sourcing-requests/${request.id}/status`, {
        method: "PATCH",
        headers: { cookie: adminCookie },
        body: JSON.stringify({ toStatus: "REPORT_READY" }),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    const payload = (await response.json()) as { error: { code: string } };
    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("INVALID_INPUT");
  });

  it("transitions SUBMITTED to IN_REVIEW and writes immutable audit event", async () => {
    const { admin, request } = await seedReviewRequest();
    const adminCookie = await issueSessionCookie(admin.id);

    const response = await patchAdminRequestStatus(
      new NextRequest(`http://localhost/api/v1/admin/sourcing-requests/${request.id}/status`, {
        method: "PATCH",
        headers: { cookie: adminCookie },
        body: JSON.stringify({ toStatus: "IN_REVIEW", note: "Clinical check started" }),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    const payload = (await response.json()) as {
      requestId: string;
      status: string;
      statusEvent: { id: string };
    };

    expect(response.status).toBe(200);
    expect(payload.requestId).toBe(request.id);
    expect(payload.status).toBe("IN_REVIEW");

    const statusEvent = await prisma.sourcingStatusEvent.findFirst({
      where: {
        sourcingRequestId: request.id,
        toStatus: "IN_REVIEW",
      },
    });
    expect(statusEvent).not.toBeNull();
    expect(statusEvent?.fromStatus).toBe("SUBMITTED");
    expect(statusEvent?.note).toBe("Clinical check started");

    const auditEvent = await prisma.auditEvent.findFirst({
      where: {
        sourcingRequestId: request.id,
        action: "ADMIN_REVIEW_DECISION_RECORDED",
      },
    });
    expect(auditEvent).not.toBeNull();
    expect(auditEvent?.actorUserId).toBe(admin.id);
    expect(auditEvent?.entityType).toBe("SourcingRequest");
    expect(auditEvent?.context).toMatchObject({
      fromStatus: "SUBMITTED",
      toStatus: "IN_REVIEW",
      note: "Clinical check started",
    });
  });

  it("returns 409 for invalid status transition", async () => {
    const { admin, request } = await seedReviewRequest();
    const adminCookie = await issueSessionCookie(admin.id);

    await prisma.sourcingRequest.update({
      where: { id: request.id },
      data: { status: "IN_REVIEW" },
    });

    const response = await patchAdminRequestStatus(
      new NextRequest(`http://localhost/api/v1/admin/sourcing-requests/${request.id}/status`, {
        method: "PATCH",
        headers: { cookie: adminCookie },
        body: JSON.stringify({ toStatus: "IN_REVIEW" }),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    const payload = (await response.json()) as { error: { code: string } };
    expect(response.status).toBe(409);
    expect(payload.error.code).toBe("INVALID_STATUS_TRANSITION");
  });

  it("accepts form-post decision payload and redirects back to admin queue detail", async () => {
    const { admin, request } = await seedReviewRequest();
    const adminCookie = await issueSessionCookie(admin.id);

    const formData = new FormData();
    formData.set("toStatus", "IN_REVIEW");
    formData.set("note", "Queued for admin review.");
    formData.set("redirectTo", `/admin/sourcing-requests?requestId=${request.id}`);

    const response = await postAdminRequestStatus(
      new NextRequest(`http://localhost/api/v1/admin/sourcing-requests/${request.id}/status`, {
        method: "POST",
        headers: { cookie: adminCookie },
        body: formData,
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/admin/sourcing-requests?requestId=${request.id}`,
    );

    const updatedRequest = await prisma.sourcingRequest.findUnique({
      where: { id: request.id },
    });
    expect(updatedRequest?.status).toBe("IN_REVIEW");
  });
});
