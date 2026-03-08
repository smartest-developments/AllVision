import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { hashToken, SESSION_COOKIE_NAME } from "@/server/auth";
import { prisma } from "@/server/db";
import { POST as postTemplateDraft } from "../../app/api/v1/admin/sourcing-requests/[requestId]/report-template-drafts/route";

describe("POST /api/v1/admin/sourcing-requests/:requestId/report-template-drafts", () => {
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

  async function seedAdminRequest() {
    const admin = await prisma.user.create({
      data: {
        email: "admin-template-draft@example.com",
        passwordHash: "hash",
        role: "ADMIN",
      },
    });

    const user = await prisma.user.create({
      data: {
        email: "owner-template-draft@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });

    const prescription = await prisma.prescription.create({
      data: {
        userId: user.id,
        countryCode: "DE",
        payload: {
          countryCode: "DE",
          leftEye: { sphere: -2 },
          rightEye: { sphere: -1.75 },
          pupillaryDistance: 63,
        },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: user.id,
        prescriptionId: prescription.id,
        status: "IN_REVIEW",
        reportPaymentRequired: false,
        currency: "EUR",
      },
    });

    return { admin, user, request };
  }

  it("returns 401 when session cookie is missing", async () => {
    const { request } = await seedAdminRequest();
    const formData = new FormData();
    formData.set("templateId", "QUALITY_RISK_ASSESSMENT");
    formData.set("templateBody", "Draft body");

    const response = await postTemplateDraft(
      new NextRequest(
        `http://localhost/api/v1/admin/sourcing-requests/${request.id}/report-template-drafts`,
        {
          method: "POST",
          body: formData,
        },
      ),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    const payload = (await response.json()) as { error: { code: string } };
    expect(response.status).toBe(401);
    expect(payload.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 403 for non-admin role", async () => {
    const { user, request } = await seedAdminRequest();
    const userCookie = await issueSessionCookie(user.id);

    const formData = new FormData();
    formData.set("templateId", "QUALITY_RISK_ASSESSMENT");
    formData.set("templateBody", "Draft body");

    const response = await postTemplateDraft(
      new NextRequest(
        `http://localhost/api/v1/admin/sourcing-requests/${request.id}/report-template-drafts`,
        {
          method: "POST",
          headers: { cookie: userCookie },
          body: formData,
        },
      ),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    const payload = (await response.json()) as { error: { code: string } };
    expect(response.status).toBe(403);
    expect(payload.error.code).toBe("FORBIDDEN");
  });

  it("persists draft audit event and redirects to admin detail path when redirectTo is present", async () => {
    const { admin, request } = await seedAdminRequest();
    const adminCookie = await issueSessionCookie(admin.id);

    const formData = new FormData();
    formData.set("templateId", "QUALITY_RISK_ASSESSMENT");
    formData.set("templateBody", "Saved report draft text.");
    formData.set(
      "redirectTo",
      `/admin/sourcing-requests?requestId=${request.id}&templateId=QUALITY_RISK_ASSESSMENT`,
    );

    const response = await postTemplateDraft(
      new NextRequest(
        `http://localhost/api/v1/admin/sourcing-requests/${request.id}/report-template-drafts`,
        {
          method: "POST",
          headers: { cookie: adminCookie },
          body: formData,
        },
      ),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/admin/sourcing-requests?requestId=${request.id}&templateId=QUALITY_RISK_ASSESSMENT`,
    );

    const savedDraftEvent = await prisma.auditEvent.findFirst({
      where: {
        sourcingRequestId: request.id,
        action: "ADMIN_REPORT_TEMPLATE_DRAFT_SAVED",
      },
      orderBy: { createdAt: "desc" },
    });

    expect(savedDraftEvent).not.toBeNull();
    expect(savedDraftEvent?.actorUserId).toBe(admin.id);
    expect(savedDraftEvent?.context).toMatchObject({
      templateId: "QUALITY_RISK_ASSESSMENT",
      templateBody: "Saved report draft text.",
    });
  });
});
