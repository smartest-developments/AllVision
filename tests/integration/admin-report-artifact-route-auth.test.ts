import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { POST } from "../../app/api/v1/admin/sourcing-requests/[requestId]/report-artifacts/route";
import { prisma } from "@/server/db";

describe("POST /api/v1/admin/sourcing-requests/:requestId/report-artifacts auth", () => {
  beforeEach(async () => {
    await prisma.auditEvent.deleteMany();
    await prisma.reportArtifact.deleteMany();
    await prisma.sourcingStatusEvent.deleteMany();
    await prisma.sourcingRequest.deleteMany();
    await prisma.prescription.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });

  async function seedReviewRequest() {
    const admin = await prisma.user.create({
      data: {
        email: "admin-route@example.com",
        passwordHash: "hash",
        role: "ADMIN"
      }
    });

    const owner = await prisma.user.create({
      data: {
        email: "owner-route@example.com",
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
        },
        consentVersion: null
      }
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "IN_REVIEW",
        reportPaymentRequired: false,
        reportFeeCents: null,
        currency: "EUR"
      }
    });

    return { admin, owner, request };
  }

  it("returns 401 when user header is missing", async () => {
    const { request } = await seedReviewRequest();

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/admin/sourcing-requests/${request.id}/report-artifacts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          storageKey: "reports/request-auth.pdf",
          checksumSha256: "abc123",
          deliveryChannel: "email"
        })
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    const payload = (await response.json()) as { error: { code: string } };
    expect(response.status).toBe(401);
    expect(payload.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 403 for non-admin role", async () => {
    const { owner, request } = await seedReviewRequest();

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/admin/sourcing-requests/${request.id}/report-artifacts`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-id": owner.id,
          "x-user-role": "USER"
        },
        body: JSON.stringify({
          storageKey: "reports/request-auth.pdf",
          checksumSha256: "abc123",
          deliveryChannel: "email"
        })
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    const payload = (await response.json()) as { error: { code: string } };
    expect(response.status).toBe(403);
    expect(payload.error.code).toBe("FORBIDDEN");
  });

  it("allows admin role and writes report artifact", async () => {
    const { admin, request } = await seedReviewRequest();

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/admin/sourcing-requests/${request.id}/report-artifacts`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-id": admin.id,
          "x-user-role": "ADMIN"
        },
        body: JSON.stringify({
          storageKey: "reports/request-auth.pdf",
          checksumSha256: "abc123",
          deliveryChannel: "email"
        })
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    const payload = (await response.json()) as {
      requestId: string;
      status: string;
      artifact: { storageKey: string };
    };

    expect(response.status).toBe(200);
    expect(payload.requestId).toBe(request.id);
    expect(payload.status).toBe("REPORT_READY");
    expect(payload.artifact.storageKey).toBe("reports/request-auth.pdf");
  });
});
