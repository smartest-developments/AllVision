import { beforeEach, describe, expect, it } from "vitest";

import { hashToken } from "@/server/auth";
import { prisma } from "@/server/db";
import { resolveSessionIdentityFromToken } from "@/server/session-identity";

describe("session identity resolver", () => {
  beforeEach(async () => {
    await prisma.auditEvent.deleteMany();
    await prisma.reportArtifact.deleteMany();
    await prisma.sourcingStatusEvent.deleteMany();
    await prisma.sourcingRequest.deleteMany();
    await prisma.prescription.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });

  it("returns identity for active session token", async () => {
    const user = await prisma.user.create({
      data: {
        email: "resolver-owner@example.com",
        passwordHash: "hash",
        role: "ADMIN"
      }
    });
    const sessionToken = "session-token-active";
    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(sessionToken),
        expiresAt: new Date(Date.now() + 60_000)
      }
    });

    const identity = await resolveSessionIdentityFromToken(sessionToken);

    expect(identity).toEqual({
      userId: user.id,
      role: "ADMIN"
    });
  });

  it("returns null when token is missing, expired, or revoked", async () => {
    const user = await prisma.user.create({
      data: {
        email: "resolver-expired@example.com",
        passwordHash: "hash",
        role: "USER"
      }
    });

    const expiredToken = "session-token-expired";
    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(expiredToken),
        expiresAt: new Date(Date.now() - 60_000)
      }
    });

    const revokedToken = "session-token-revoked";
    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(revokedToken),
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: new Date()
      }
    });

    await expect(resolveSessionIdentityFromToken(undefined)).resolves.toBeNull();
    await expect(resolveSessionIdentityFromToken(expiredToken)).resolves.toBeNull();
    await expect(resolveSessionIdentityFromToken(revokedToken)).resolves.toBeNull();
    await expect(resolveSessionIdentityFromToken("unknown-token")).resolves.toBeNull();
  });
});
