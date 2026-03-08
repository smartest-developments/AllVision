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

  it("returns null settlement metadata for non-settled statuses", async () => {
    const admin = await prisma.user.create({
      data: { email: "admin-settlement-null@example.com", passwordHash: "hash", role: "ADMIN" },
    });
    const user = await prisma.user.create({
      data: { email: "owner-settlement-null@example.com", passwordHash: "hash", role: "USER" },
    });
    const prescription = await prisma.prescription.create({
      data: {
        userId: user.id,
        countryCode: "IT",
        payload: {
          countryCode: "IT",
          leftEye: { sphere: -1.0 },
          rightEye: { sphere: -1.0 },
          pupillaryDistance: 62,
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

    const adminCookie = await issueSessionCookie(admin.id);

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
      settledByUserId: null,
      settledAt: null,
    });
  });

  it("returns settlement metadata for delivered requests", async () => {
    const admin = await prisma.user.create({
      data: { email: "admin-settlement@example.com", passwordHash: "hash", role: "ADMIN" },
    });
    const user = await prisma.user.create({
      data: { email: "owner-settlement@example.com", passwordHash: "hash", role: "USER" },
    });
    const prescription = await prisma.prescription.create({
      data: {
        userId: user.id,
        countryCode: "CH",
        payload: {
          countryCode: "CH",
          leftEye: { sphere: -1.0 },
          rightEye: { sphere: -1.0 },
          pupillaryDistance: 62,
        },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: user.id,
        prescriptionId: prescription.id,
        status: "DELIVERED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    const settledAt = new Date("2026-03-08T12:00:00.000Z");

    await prisma.sourcingStatusEvent.createMany({
      data: [
        {
          sourcingRequestId: request.id,
          fromStatus: "REPORT_READY",
          toStatus: "PAYMENT_PENDING",
          note: "Checkout started",
          actorUserId: user.id,
          createdAt: new Date("2026-03-08T11:50:00.000Z"),
        },
        {
          sourcingRequestId: request.id,
          fromStatus: "PAYMENT_PENDING",
          toStatus: "PAYMENT_SETTLED",
          note: "Admin settled payment",
          actorUserId: admin.id,
          createdAt: settledAt,
        },
        {
          sourcingRequestId: request.id,
          fromStatus: "PAYMENT_SETTLED",
          toStatus: "DELIVERED",
          note: "Delivery acknowledged",
          actorUserId: user.id,
          createdAt: new Date("2026-03-08T12:10:00.000Z"),
        },
      ],
    });

    const adminCookie = await issueSessionCookie(admin.id);

    const response = await getAdminQueueDetail(
      new NextRequest(`http://localhost/api/v1/admin/sourcing-requests/${request.id}`, {
        headers: { cookie: adminCookie },
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    const payload = (await response.json()) as {
      request: {
        status: string;
        settlement: {
          settledByUserId: string | null;
          settledAt: string | null;
        };
      };
    };

    expect(response.status).toBe(200);
    expect(payload.request.status).toBe("DELIVERED");
    expect(payload.request.settlement.settledByUserId).toBe(admin.id);
    expect(payload.request.settlement.settledAt).toBe(settledAt.toISOString());
  });
});
