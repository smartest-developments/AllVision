import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { hashToken, SESSION_COOKIE_NAME } from "@/server/auth";
import { prisma } from "@/server/db";
import { GET as getAdminQueue } from "../../app/api/v1/admin/sourcing-requests/route";
import { GET as getAdminQueueDetail } from "../../app/api/v1/admin/sourcing-requests/[requestId]/route";
import { PATCH as patchAdminQueueStatus } from "../../app/api/v1/admin/sourcing-requests/[requestId]/status/route";

describe("GET /api/v1/admin/sourcing-requests", () => {
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

  async function seedQueueData() {
    const admin = await prisma.user.create({
      data: {
        email: "admin-queue@example.com",
        passwordHash: "hash",
        role: "ADMIN",
      },
    });

    const user = await prisma.user.create({
      data: {
        email: "queue-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });

    const otherUser = await prisma.user.create({
      data: {
        email: "other-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });

    const nlPrescription = await prisma.prescription.create({
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

    const dePrescription = await prisma.prescription.create({
      data: {
        userId: otherUser.id,
        countryCode: "DE",
        payload: {
          countryCode: "DE",
          leftEye: { sphere: -2.0 },
          rightEye: { sphere: -1.75 },
          pupillaryDistance: 63,
        },
      },
    });

    const inReviewRequest = await prisma.sourcingRequest.create({
      data: {
        userId: user.id,
        prescriptionId: nlPrescription.id,
        status: "IN_REVIEW",
        reportPaymentRequired: false,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: inReviewRequest.id,
        fromStatus: "SUBMITTED",
        toStatus: "IN_REVIEW",
        note: "Admin started review",
        actorUserId: admin.id,
      },
    });

    await prisma.sourcingRequest.create({
      data: {
        userId: otherUser.id,
        prescriptionId: dePrescription.id,
        status: "SUBMITTED",
        reportPaymentRequired: false,
        currency: "EUR",
      },
    });

    await prisma.sourcingRequest.create({
      data: {
        userId: otherUser.id,
        prescriptionId: dePrescription.id,
        status: "REPORT_READY",
        reportPaymentRequired: false,
        currency: "EUR",
      },
    });

    return { admin, inReviewRequest };
  }

  it("returns 401 when session cookie is missing", async () => {
    const response = await getAdminQueue(
      new NextRequest("http://localhost/api/v1/admin/sourcing-requests"),
    );

    const payload = (await response.json()) as { error: { code: string } };
    expect(response.status).toBe(401);
    expect(payload.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 403 for non-admin role", async () => {
    const user = await prisma.user.create({
      data: {
        email: "user-queue@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });

    const userCookie = await issueSessionCookie(user.id);

    const response = await getAdminQueue(
      new NextRequest("http://localhost/api/v1/admin/sourcing-requests", {
        headers: { cookie: userCookie },
      }),
    );

    const payload = (await response.json()) as { error: { code: string } };
    expect(response.status).toBe(403);
    expect(payload.error.code).toBe("FORBIDDEN");
  });

  it("returns 400 for invalid queue filters", async () => {
    const { admin } = await seedQueueData();
    const adminCookie = await issueSessionCookie(admin.id);

    const response = await getAdminQueue(
      new NextRequest("http://localhost/api/v1/admin/sourcing-requests?status=REPORT_READY", {
        headers: { cookie: adminCookie },
      }),
    );

    const payload = (await response.json()) as { error: { code: string } };
    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("INVALID_QUERY");
  });

  it("returns admin queue list and applies status/country filters", async () => {
    const { admin, inReviewRequest } = await seedQueueData();
    const adminCookie = await issueSessionCookie(admin.id);

    const defaultResponse = await getAdminQueue(
      new NextRequest("http://localhost/api/v1/admin/sourcing-requests", {
        headers: { cookie: adminCookie },
      }),
    );

    const defaultPayload = (await defaultResponse.json()) as {
      requests: Array<{ requestId: string; status: string; countryCode: string }>;
    };

    expect(defaultResponse.status).toBe(200);
    expect(defaultPayload.requests).toHaveLength(2);
    expect(defaultPayload.requests.every((request) => request.status !== "REPORT_READY")).toBe(true);

    const filteredResponse = await getAdminQueue(
      new NextRequest(
        "http://localhost/api/v1/admin/sourcing-requests?status=IN_REVIEW&countryCode=nl",
        {
          headers: { cookie: adminCookie },
        },
      ),
    );

    const filteredPayload = (await filteredResponse.json()) as {
      requests: Array<{ requestId: string; status: string; countryCode: string; latestEventAt: string | null }>;
    };

    expect(filteredResponse.status).toBe(200);
    expect(filteredPayload.requests).toEqual([
      expect.objectContaining({
        requestId: inReviewRequest.id,
        status: "IN_REVIEW",
        countryCode: "NL",
      }),
    ]);
    expect(filteredPayload.requests[0]?.latestEventAt).toBeTruthy();
  });

  it("returns admin queue detail for a specific request", async () => {
    const { admin, inReviewRequest } = await seedQueueData();
    const adminCookie = await issueSessionCookie(admin.id);

    const response = await getAdminQueueDetail(
      new NextRequest(`http://localhost/api/v1/admin/sourcing-requests/${inReviewRequest.id}`, {
        headers: { cookie: adminCookie },
      }),
      { params: Promise.resolve({ requestId: inReviewRequest.id }) },
    );

    const payload = (await response.json()) as {
      request: { requestId: string; status: string; countryCode: string };
      timeline: Array<{ toStatus: string }>;
      reportArtifacts: Array<unknown>;
    };

    expect(response.status).toBe(200);
    expect(payload.request).toMatchObject({
      requestId: inReviewRequest.id,
      status: "IN_REVIEW",
      countryCode: "NL",
    });
    expect(payload.timeline[0]?.toStatus).toBe("IN_REVIEW");
    expect(payload.reportArtifacts).toEqual([]);
  });

  it("returns 404 on missing admin queue detail request", async () => {
    const { admin } = await seedQueueData();
    const adminCookie = await issueSessionCookie(admin.id);

    const response = await getAdminQueueDetail(
      new NextRequest("http://localhost/api/v1/admin/sourcing-requests/missing-request", {
        headers: { cookie: adminCookie },
      }),
      { params: Promise.resolve({ requestId: "missing-request" }) },
    );

    const payload = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(404);
    expect(payload.error.code).toBe("NOT_FOUND");
  });

  it("applies admin review decision and writes immutable audit event", async () => {
    const { admin } = await seedQueueData();
    const adminCookie = await issueSessionCookie(admin.id);

    const submittedRequest = await prisma.sourcingRequest.findFirstOrThrow({
      where: { status: "SUBMITTED" },
    });

    const response = await patchAdminQueueStatus(
      new NextRequest(`http://localhost/api/v1/admin/sourcing-requests/${submittedRequest.id}/status`, {
        method: "PATCH",
        headers: { cookie: adminCookie, "content-type": "application/json" },
        body: JSON.stringify({ toStatus: "IN_REVIEW", note: "Manual review accepted" }),
      }),
      { params: Promise.resolve({ requestId: submittedRequest.id }) },
    );

    const payload = (await response.json()) as { requestId: string; status: string };
    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ requestId: submittedRequest.id, status: "IN_REVIEW" });

    const auditEvent = await prisma.auditEvent.findFirst({
      where: {
        sourcingRequestId: submittedRequest.id,
        action: "ADMIN_REVIEW_DECISION_RECORDED",
      },
    });
    expect(auditEvent).not.toBeNull();
    expect(auditEvent?.actorUserId).toBe(admin.id);
    expect(auditEvent?.entityType).toBe("SourcingRequest");
    expect(auditEvent?.context).toMatchObject({
      fromStatus: "SUBMITTED",
      toStatus: "IN_REVIEW",
      note: "Manual review accepted",
    });
  });

  it("returns 409 when admin review decision transition is invalid", async () => {
    const { admin, inReviewRequest } = await seedQueueData();
    const adminCookie = await issueSessionCookie(admin.id);

    const response = await patchAdminQueueStatus(
      new NextRequest(`http://localhost/api/v1/admin/sourcing-requests/${inReviewRequest.id}/status`, {
        method: "PATCH",
        headers: { cookie: adminCookie, "content-type": "application/json" },
        body: JSON.stringify({ toStatus: "IN_REVIEW" }),
      }),
      { params: Promise.resolve({ requestId: inReviewRequest.id }) },
    );

    const payload = (await response.json()) as { error: { code: string; allowed: string[] } };
    expect(response.status).toBe(409);
    expect(payload.error.code).toBe("INVALID_STATUS_TRANSITION");
    expect(payload.error.allowed).toContain("REPORT_READY");
  });
});
