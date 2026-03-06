import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/server/db";
import { resolvePageSessionUserId } from "@/server/page-auth";
import GdprPage from "../../app/gdpr/page";

vi.mock("@/server/page-auth", () => ({
  resolvePageSessionUserId: vi.fn(),
}));

const mockedResolvePageSessionUserId = vi.mocked(resolvePageSessionUserId);

describe("GDPR status page", () => {
  beforeEach(async () => {
    mockedResolvePageSessionUserId.mockReset();
    mockedResolvePageSessionUserId.mockResolvedValue(null);
    await prisma.auditEvent.deleteMany();
    await prisma.reportArtifact.deleteMany();
    await prisma.sourcingStatusEvent.deleteMany();
    await prisma.sourcingRequest.deleteMany();
    await prisma.prescription.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });

  it("renders sign-in guidance when user is signed out", async () => {
    const markup = renderToStaticMarkup(await GdprPage());

    expect(markup).toContain("GDPR request history");
    expect(markup).toContain("Sign in to view GDPR request history.");
    expect(markup).toContain("/auth/login?next=%2Fgdpr");
    expect(markup).toContain("/auth/register?next=%2Fgdpr");
    expect(markup).toContain("GDPR_DELETE_LEGAL_HOLD");
  });

  it("renders GDPR history entries and action controls for authenticated user", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "gdpr-history@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });

    await prisma.auditEvent.create({
      data: {
        actorUserId: owner.id,
        entityType: "User",
        entityId: owner.id,
        action: "GDPR_EXPORT_REQUESTED",
        context: { status: "QUEUED" },
      },
    });

    await prisma.auditEvent.create({
      data: {
        actorUserId: owner.id,
        entityType: "User",
        entityId: owner.id,
        action: "GDPR_DELETE_REQUESTED",
        context: { status: "SOFT_DELETED" },
      },
    });

    mockedResolvePageSessionUserId.mockResolvedValue(owner.id);

    const markup = renderToStaticMarkup(await GdprPage());

    expect(markup).toContain("Recent requests");
    expect(markup).toContain("GDPR_DELETE_REQUESTED");
    expect(markup).toContain("SOFT_DELETED");
    expect(markup).toContain("GDPR_EXPORT_REQUESTED");
    expect(markup).toContain("QUEUED");
    expect(markup).toContain('action="/api/v1/gdpr/export"');
    expect(markup).toContain('action="/api/v1/gdpr/delete"');
  });
});
