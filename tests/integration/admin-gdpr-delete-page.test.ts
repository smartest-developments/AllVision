import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SESSION_COOKIE_NAME, hashToken } from "@/server/auth";
import { prisma } from "@/server/db";
import { cookies } from "next/headers";
import AdminGdprDeleteRequestsPage from "../../app/admin/gdpr-delete-requests/page";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

const mockedCookies = vi.mocked(cookies);

type MockCookieStore = {
  getAll: () => Array<{ name: string; value: string }>;
};

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

function mockCookieHeader(cookieHeader: string) {
  const [pair] = cookieHeader.split(";");
  const [name, value] = pair.split("=");

  const cookieStore: MockCookieStore = {
    getAll: () => [{ name, value }],
  };

  mockedCookies.mockResolvedValue(
    cookieStore as unknown as Awaited<ReturnType<typeof cookies>>,
  );
}

describe("Admin GDPR delete queue page", () => {
  beforeEach(async () => {
    mockedCookies.mockReset();
    mockedCookies.mockResolvedValue({
      getAll: () => [],
    } as unknown as Awaited<ReturnType<typeof cookies>>);

    await prisma.auditEvent.deleteMany();
    await prisma.reportArtifact.deleteMany();
    await prisma.sourcingStatusEvent.deleteMany();
    await prisma.sourcingRequest.deleteMany();
    await prisma.prescription.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });

  it("shows admin access required for non-admin session", async () => {
    const user = await prisma.user.create({
      data: {
        email: "gdpr-queue-user-page@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });

    const userCookie = await issueSessionCookie(user.id);
    mockCookieHeader(userCookie);

    const markup = renderToStaticMarkup(await AdminGdprDeleteRequestsPage());

    expect(markup).toContain("Admin access required");
    expect(markup).toContain("Admin access required.");
  });

  it("renders pending GDPR deletion requests and execute action", async () => {
    const admin = await prisma.user.create({
      data: {
        email: "gdpr-queue-admin-page@example.com",
        passwordHash: "hash",
        role: "ADMIN",
      },
    });

    const targetUser = await prisma.user.create({
      data: {
        email: "gdpr-pending-page@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });

    const requestEvent = await prisma.auditEvent.create({
      data: {
        actorUserId: targetUser.id,
        entityType: "User",
        entityId: targetUser.id,
        action: "GDPR_DELETE_REQUESTED",
        context: { status: "PENDING_REVIEW" },
      },
    });

    const adminCookie = await issueSessionCookie(admin.id);
    mockCookieHeader(adminCookie);

    const markup = renderToStaticMarkup(await AdminGdprDeleteRequestsPage());

    expect(markup).toContain("Admin GDPR deletion queue");
    expect(markup).toContain(requestEvent.id);
    expect(markup).toContain("gdpr-pending-page@example.com");
    expect(markup).toContain("PENDING_REVIEW");
    expect(markup).toContain(
      `action="/api/v1/admin/gdpr/delete-requests/${requestEvent.id}/execute"`,
    );
  });
});
