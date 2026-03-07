import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { hashToken, SESSION_COOKIE_NAME } from "@/server/auth";
import { prisma } from "@/server/db";
import { POST } from "../../app/api/v1/gdpr/delete/route";

describe("POST /api/v1/gdpr/delete", () => {
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

  it("returns 401 when session cookie is missing", async () => {
    const response = await POST(new NextRequest("http://localhost/api/v1/gdpr/delete", { method: "POST" }));

    const payload = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(401);
    expect(payload.error.code).toBe("UNAUTHORIZED");
  });

  it("queues deletion request for admin review when legal hold checks pass", async () => {
    const user = await prisma.user.create({
      data: {
        email: "gdpr-delete-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });

    const prescription = await prisma.prescription.create({
      data: {
        userId: user.id,
        countryCode: "CH",
        payload: {
          countryCode: "CH",
          leftEye: { sphere: -1.0 },
          rightEye: { sphere: -1.25 },
          pupillaryDistance: 62,
        },
      },
    });

    await prisma.sourcingRequest.create({
      data: {
        userId: user.id,
        prescriptionId: prescription.id,
        status: "DELIVERED",
        reportPaymentRequired: false,
        currency: "EUR",
      },
    });

    const userCookie = await issueSessionCookie(user.id);

    const response = await POST(
      new NextRequest("http://localhost/api/v1/gdpr/delete", {
        method: "POST",
        headers: { cookie: userCookie },
      }),
    );

    const payload = (await response.json()) as {
      request: {
        requestId: string;
        status: string;
        requestedAt: string;
      };
    };

    expect(response.status).toBe(202);
    expect(payload.request.status).toBe("PENDING_REVIEW");
    expect(new Date(payload.request.requestedAt).toString()).not.toBe("Invalid Date");

    const refreshedUser = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(refreshedUser.email).toBe("gdpr-delete-owner@example.com");

    const events = await prisma.auditEvent.findMany({
      where: {
        entityType: "User",
        entityId: user.id,
        action: {
          in: ["GDPR_DELETE_REQUESTED", "GDPR_DELETE_COMPLETED"],
        },
      },
      orderBy: { createdAt: "asc" },
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.id).toBe(payload.request.requestId);
    expect(events[0]?.action).toBe("GDPR_DELETE_REQUESTED");
    expect(events[0]?.context).toMatchObject({ status: "PENDING_REVIEW", legalHoldChecked: true });
  });

  it("returns 409 when legal hold is active", async () => {
    const user = await prisma.user.create({
      data: {
        email: "gdpr-legal-hold@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });

    const prescription = await prisma.prescription.create({
      data: {
        userId: user.id,
        countryCode: "CH",
        payload: {
          countryCode: "CH",
          leftEye: { sphere: -1.0 },
          rightEye: { sphere: -1.25 },
          pupillaryDistance: 62,
        },
      },
    });

    await prisma.sourcingRequest.create({
      data: {
        userId: user.id,
        prescriptionId: prescription.id,
        status: "IN_REVIEW",
        reportPaymentRequired: false,
        currency: "EUR",
      },
    });

    const userCookie = await issueSessionCookie(user.id);

    const response = await POST(
      new NextRequest("http://localhost/api/v1/gdpr/delete", {
        method: "POST",
        headers: { cookie: userCookie },
      }),
    );

    const payload = (await response.json()) as {
      error: { code: string; message: string };
    };

    expect(response.status).toBe(409);
    expect(payload.error.code).toBe("GDPR_DELETE_LEGAL_HOLD");

    const events = await prisma.auditEvent.findMany({
      where: {
        actorUserId: user.id,
        action: "GDPR_DELETE_REQUESTED",
      },
    });
    expect(events).toHaveLength(0);
  });
});
