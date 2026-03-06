import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { hashToken, SESSION_COOKIE_NAME } from "@/server/auth";
import { prisma } from "@/server/db";
import { GET } from "../../app/api/v1/sourcing-requests/route";

describe("GET /api/v1/sourcing-requests", () => {
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

  it("returns 401 when session cookie is missing", async () => {
    const request = new NextRequest("http://localhost/api/v1/sourcing-requests");

    const response = await GET(request);
    const payload = (await response.json()) as {
      error: { code: string; message: string };
    };

    expect(response.status).toBe(401);
    expect(payload.error.code).toBe("UNAUTHORIZED");
  });

  it("returns owner-only sourcing status timeline list", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "owner-route@example.com",
        passwordHash: "hash",
        role: "USER"
      }
    });

    const otherUser = await prisma.user.create({
      data: {
        email: "other-route@example.com",
        passwordHash: "hash",
        role: "USER"
      }
    });

    const ownerPrescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "IT",
        payload: {
          countryCode: "IT",
          leftEye: { sphere: -1.25 },
          rightEye: { sphere: -1.5 },
          pupillaryDistance: 62
        }
      }
    });

    const ownerRequest = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: ownerPrescription.id,
        status: "IN_REVIEW",
        reportPaymentRequired: false,
        currency: "EUR"
      }
    });

    await prisma.sourcingStatusEvent.createMany({
      data: [
        {
          sourcingRequestId: ownerRequest.id,
          fromStatus: "SUBMITTED",
          toStatus: "IN_REVIEW",
          note: "Admin started review"
        }
      ]
    });

    const otherPrescription = await prisma.prescription.create({
      data: {
        userId: otherUser.id,
        countryCode: "DE",
        payload: {
          countryCode: "DE",
          leftEye: { sphere: -2.0 },
          rightEye: { sphere: -1.75 },
          pupillaryDistance: 63
        }
      }
    });

    await prisma.sourcingRequest.create({
      data: {
        userId: otherUser.id,
        prescriptionId: otherPrescription.id,
        status: "SUBMITTED",
        reportPaymentRequired: false,
        currency: "EUR"
      }
    });

    const ownerCookie = await issueSessionCookie(owner.id);
    const request = new NextRequest("http://localhost/api/v1/sourcing-requests", {
      headers: {
        cookie: ownerCookie,
        "x-user-id": otherUser.id
      }
    });

    const response = await GET(request);
    const payload = (await response.json()) as {
      requests: Array<{
        requestId: string;
        status: string;
        timeline: Array<{
          fromStatus: string | null;
          toStatus: string;
          note: string | null;
        }>;
      }>;
      legal: {
        title: string;
        bullets: string[];
        surfaceNote: string;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.requests).toHaveLength(1);
    expect(payload.requests[0]).toMatchObject({
      requestId: ownerRequest.id,
      status: "IN_REVIEW",
      timeline: [{ fromStatus: "SUBMITTED", toStatus: "IN_REVIEW", note: "Admin started review" }]
    });
    expect(payload.requests[0]?.requestId).not.toBe(otherUser.id);
    expect(payload.legal.title).toBe("Legal Notice");
  });
});
