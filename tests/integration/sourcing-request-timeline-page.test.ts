import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import HomePage from "../../app/page";

describe("Home page sourcing request timeline", () => {
  beforeEach(async () => {
    await prisma.auditEvent.deleteMany();
    await prisma.reportArtifact.deleteMany();
    await prisma.sourcingStatusEvent.deleteMany();
    await prisma.sourcingRequest.deleteMany();
    await prisma.prescription.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });

  it("renders an authenticated timeline card when userId is provided", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-owner@example.com",
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

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "IN_REVIEW",
        reportPaymentRequired: false,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "SUBMITTED",
        toStatus: "IN_REVIEW",
        note: "Manual review started",
      },
    });

    const markup = renderToStaticMarkup(
      await HomePage({ searchParams: Promise.resolve({ userId: owner.id }) }),
    );

    expect(markup).toContain("Sourcing request timeline");
    expect(markup).toContain(`Request ${request.id}`);
    expect(markup).toContain("Current status: IN_REVIEW");
    expect(markup).toContain("SUBMITTED -&gt; IN_REVIEW");
    expect(markup).toContain('aria-label="Authenticated navigation"');
    expect(markup).toContain(`/timeline?userId=${owner.id}`);
  });

  it("renders guidance message when userId is absent", async () => {
    const markup = renderToStaticMarkup(await HomePage({}));

    expect(markup).toContain(
      "Enter a user ID to load owner-only sourcing request statuses.",
    );
  });
});
