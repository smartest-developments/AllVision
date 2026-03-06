import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/server/db";
import { resolvePageSessionUserId } from "@/server/page-auth";
import TimelinePage from "../../app/timeline/page";

vi.mock("@/server/page-auth", () => ({
  resolvePageSessionUserId: vi.fn(),
}));

const mockedResolvePageSessionUserId = vi.mocked(resolvePageSessionUserId);

describe("Timeline page deep-linking", () => {
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

  it("renders focused request card when requestId belongs to session user", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-focus-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "IT",
        payload: {
          countryCode: "IT",
          leftEye: { sphere: -1.25 },
          rightEye: { sphere: -1.5 },
          pupillaryDistance: 62,
        },
      },
    });

    const focusedRequest = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "IN_REVIEW",
        reportPaymentRequired: false,
        currency: "EUR",
      },
    });

    await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "SUBMITTED",
        reportPaymentRequired: false,
        currency: "EUR",
      },
    });

    mockedResolvePageSessionUserId.mockResolvedValue(owner.id);

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: focusedRequest.id,
        }),
      }),
    );

    expect(markup).toContain("Focused request");
    expect(markup).toContain(`Request ${focusedRequest.id}`);
    expect(markup).not.toContain("No request matching this request ID");
  });

  it("does not reveal another user's request when requestId does not belong to session user", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });

    const other = await prisma.user.create({
      data: {
        email: "timeline-other@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });

    const ownerPrescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "IT",
        payload: {
          countryCode: "IT",
          leftEye: { sphere: -1.25 },
          rightEye: { sphere: -1.5 },
          pupillaryDistance: 62,
        },
      },
    });

    const otherPrescription = await prisma.prescription.create({
      data: {
        userId: other.id,
        countryCode: "DE",
        payload: {
          countryCode: "DE",
          leftEye: { sphere: -2.0 },
          rightEye: { sphere: -1.75 },
          pupillaryDistance: 63,
        },
      },
    });

    await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: ownerPrescription.id,
        status: "IN_REVIEW",
        reportPaymentRequired: false,
        currency: "EUR",
      },
    });

    const otherRequest = await prisma.sourcingRequest.create({
      data: {
        userId: other.id,
        prescriptionId: otherPrescription.id,
        status: "SUBMITTED",
        reportPaymentRequired: false,
        currency: "EUR",
      },
    });

    mockedResolvePageSessionUserId.mockResolvedValue(owner.id);

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: otherRequest.id,
        }),
      }),
    );

    expect(markup).toContain("No request matching this request ID was found for this account.");
    expect(markup).toContain("Clear request focus");
    expect(markup).toContain("/timeline");
    expect(markup).not.toContain(`Request ${otherRequest.id}`);
  });
});
