import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { hashToken, SESSION_COOKIE_NAME } from "@/server/auth";
import { prisma } from "@/server/db";
import { POST } from "../../app/api/v1/gdpr/export/route";

describe("POST /api/v1/gdpr/export", () => {
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
    const response = await POST(new NextRequest("http://localhost/api/v1/gdpr/export", { method: "POST" }));

    const payload = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(401);
    expect(payload.error.code).toBe("UNAUTHORIZED");
  });

  it("queues a personal-data export request for authenticated user", async () => {
    const user = await prisma.user.create({
      data: {
        email: "gdpr-export-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });

    const userCookie = await issueSessionCookie(user.id);

    const response = await POST(
      new NextRequest("http://localhost/api/v1/gdpr/export", {
        method: "POST",
        headers: { cookie: userCookie },
      }),
    );

    const payload = (await response.json()) as {
      request: { requestId: string; status: string; requestedAt: string };
    };

    expect(response.status).toBe(202);
    expect(payload.request.status).toBe("QUEUED");
    expect(payload.request.requestId).toBeTruthy();
    expect(new Date(payload.request.requestedAt).toString()).not.toBe("Invalid Date");

    const auditEvent = await prisma.auditEvent.findUnique({
      where: { id: payload.request.requestId },
    });

    expect(auditEvent).not.toBeNull();
    expect(auditEvent?.actorUserId).toBe(user.id);
    expect(auditEvent?.entityType).toBe("User");
    expect(auditEvent?.entityId).toBe(user.id);
    expect(auditEvent?.action).toBe("GDPR_EXPORT_REQUESTED");
    expect(auditEvent?.context).toMatchObject({ status: "QUEUED" });
  });
});
