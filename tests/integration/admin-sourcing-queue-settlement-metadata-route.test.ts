import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { hashToken, SESSION_COOKIE_NAME } from "@/server/auth";
import { prisma } from "@/server/db";
import { GET as getAdminQueueDetail } from "../../app/api/v1/admin/sourcing-requests/[requestId]/route";

describe("GET /api/v1/admin/sourcing-requests/:requestId settlement metadata", () => {
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

  it("returns settlement actor/timestamp when request reached PAYMENT_SETTLED", async () => {
    const admin = await prisma.user.create({
      data: {
        email: "settlement-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
      },
    });

    const adminCookie = await issueSessionCookie(admin.id);

    const prescription = await prisma.prescription.create({
      data: {
        userId: admin.id,
        countryCode: "IT",
        payload: {
          countryCode: "IT",
          leftEye: { sphere: -1.0 },
          rightEye: { sphere: -1.0 },
          pupillaryDistance: 63,
        },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: admin.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        reportFeeCents: 2400,
        currency: "EUR",
      },
    });

    const settledAt = new Date("2026-03-08T18:45:00.000Z");
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "Settlement completed",
        createdAt: settledAt,
      },
    });

    const response = await getAdminQueueDetail(
      new NextRequest(`http://localhost/api/v1/admin/sourcing-requests/${request.id}`, {
        headers: { cookie: adminCookie },
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    const payload = (await response.json()) as {
      request: {
        settlement: {
          settledByUserId: string | null;
          settledAt: string | null;
        };
      };
    };

    expect(response.status).toBe(200);
    expect(payload.request.settlement).toEqual({
      settledByUserId: admin.id,
      settledAt: settledAt.toISOString(),
    });
  });
});
