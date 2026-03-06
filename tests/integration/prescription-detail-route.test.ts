import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { hashToken, SESSION_COOKIE_NAME } from "@/server/auth";
import { prisma } from "@/server/db";
import { GET } from "../../app/api/v1/prescriptions/[prescriptionId]/route";

describe("GET /api/v1/prescriptions/:prescriptionId", () => {
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
    const response = await GET(
      new NextRequest("http://localhost/api/v1/prescriptions/prescription_1"),
      { params: Promise.resolve({ prescriptionId: "prescription_1" }) }
    );
    const payload = (await response.json()) as {
      error: { code: string; message: string };
    };

    expect(response.status).toBe(401);
    expect(payload.error.code).toBe("UNAUTHORIZED");
  });

  it("returns prescription payload for owner session", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "owner-prescription@example.com",
        passwordHash: "hash",
        role: "USER"
      }
    });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "IT",
        payload: {
          countryCode: "IT",
          leftEye: { sphere: -1.25 },
          rightEye: { sphere: -1.5 },
          pupillaryDistance: 62
        },
        consentVersion: "v1"
      }
    });

    const ownerCookie = await issueSessionCookie(owner.id);
    const response = await GET(
      new NextRequest(`http://localhost/api/v1/prescriptions/${prescription.id}`, {
        headers: { cookie: ownerCookie }
      }),
      { params: Promise.resolve({ prescriptionId: prescription.id }) }
    );
    const payload = (await response.json()) as {
      id: string;
      userId: string;
      countryCode: string;
      consentVersion: string | null;
      payload: { countryCode: string };
    };

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      id: prescription.id,
      userId: owner.id,
      countryCode: "IT",
      consentVersion: "v1",
      payload: { countryCode: "IT" }
    });
  });

  it("returns prescription payload for admin session", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "owner-for-admin@example.com",
        passwordHash: "hash",
        role: "USER"
      }
    });

    const admin = await prisma.user.create({
      data: {
        email: "admin-prescription@example.com",
        passwordHash: "hash",
        role: "ADMIN"
      }
    });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: {
          countryCode: "NL",
          leftEye: { sphere: -0.5 },
          rightEye: { sphere: -0.75 },
          pupillaryDistance: 63
        }
      }
    });

    const adminCookie = await issueSessionCookie(admin.id);
    const response = await GET(
      new NextRequest(`http://localhost/api/v1/prescriptions/${prescription.id}`, {
        headers: { cookie: adminCookie }
      }),
      { params: Promise.resolve({ prescriptionId: prescription.id }) }
    );

    expect(response.status).toBe(200);
  });

  it("returns 403 for non-owner non-admin session", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "owner-guarded@example.com",
        passwordHash: "hash",
        role: "USER"
      }
    });

    const intruder = await prisma.user.create({
      data: {
        email: "intruder-guarded@example.com",
        passwordHash: "hash",
        role: "USER"
      }
    });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "DE",
        payload: {
          countryCode: "DE",
          leftEye: { sphere: -1.0 },
          rightEye: { sphere: -1.25 },
          pupillaryDistance: 61
        }
      }
    });

    const intruderCookie = await issueSessionCookie(intruder.id);
    const response = await GET(
      new NextRequest(`http://localhost/api/v1/prescriptions/${prescription.id}`, {
        headers: { cookie: intruderCookie }
      }),
      { params: Promise.resolve({ prescriptionId: prescription.id }) }
    );
    const payload = (await response.json()) as {
      error: { code: string; message: string };
    };

    expect(response.status).toBe(403);
    expect(payload.error.code).toBe("FORBIDDEN");
  });

  it("returns 404 when prescription is missing", async () => {
    const admin = await prisma.user.create({
      data: {
        email: "admin-missing-prescription@example.com",
        passwordHash: "hash",
        role: "ADMIN"
      }
    });
    const adminCookie = await issueSessionCookie(admin.id);

    const response = await GET(
      new NextRequest("http://localhost/api/v1/prescriptions/missing-prescription", {
        headers: { cookie: adminCookie }
      }),
      { params: Promise.resolve({ prescriptionId: "missing-prescription" }) }
    );
    const payload = (await response.json()) as {
      error: { code: string; message: string };
    };

    expect(response.status).toBe(404);
    expect(payload.error.code).toBe("NOT_FOUND");
  });
});
