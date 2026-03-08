import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/server/db";
import { resolvePageSessionUserId } from "@/server/page-auth";
import HomePage from "../../app/page";

vi.mock("@/server/page-auth", () => ({
  resolvePageSessionUserId: vi.fn(),
}));

const mockedResolvePageSessionUserId = vi.mocked(resolvePageSessionUserId);

describe("Home page sourcing request timeline", () => {
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

  it("renders an authenticated timeline card from session identity", async () => {
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

    mockedResolvePageSessionUserId.mockResolvedValue(owner.id);

    const markup = renderToStaticMarkup(await HomePage());

    expect(markup).toContain("Sourcing request timeline");
    expect(markup).toContain(`Request ${request.id}`);
    expect(markup).toContain("Current status: IN_REVIEW");
    expect(markup).toContain("SUBMITTED -&gt; IN_REVIEW");
    expect(markup).toContain('aria-label="Authenticated navigation"');
    expect(markup).toContain("/timeline");
    expect(markup).toContain("/gdpr");
    expect(markup).toContain("Open focused timeline view");
    expect(markup).toContain("GDPR self-service actions");
    expect(markup).toContain('action="/api/v1/gdpr/export"');
    expect(markup).toContain('action="/api/v1/gdpr/delete"');
  });

  it("renders report-delivery acknowledgment action when request is report-ready", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-owner-report-ready@example.com",
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
          leftEye: { sphere: -1.0 },
          rightEye: { sphere: -1.25 },
          pupillaryDistance: 61,
        },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "REPORT_READY",
        reportPaymentRequired: false,
        currency: "EUR",
      },
    });

    mockedResolvePageSessionUserId.mockResolvedValue(owner.id);

    const markup = renderToStaticMarkup(await HomePage());

    expect(markup).toContain("Acknowledge report delivery");
    expect(markup).toContain(
      `/api/v1/sourcing-requests/${request.id}/report/ack`,
    );
  });

  it("renders report-fee checkout action and hides delivery acknowledgment when payment is pending", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-owner-payment-pending@example.com",
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
          leftEye: { sphere: -1.0 },
          rightEye: { sphere: -1.25 },
          pupillaryDistance: 61,
        },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "REPORT_READY",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    mockedResolvePageSessionUserId.mockResolvedValue(owner.id);

    const markup = renderToStaticMarkup(await HomePage());

    expect(markup).toContain("Report fee pending (EUR 19.90).");
    expect(markup).toContain(
      `/api/v1/sourcing-requests/${request.id}/report-fee/checkout`,
    );
    expect(markup).toContain(
      'name="redirectTo" value="/timeline?requestId=',
    );
    expect(markup).toContain("Start report fee checkout");
    expect(markup).not.toContain(`/api/v1/sourcing-requests/${request.id}/report/ack`);
  });

  it("renders delivery acknowledgment after report-fee settlement", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-owner-payment-settled@example.com",
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
          leftEye: { sphere: -1.0 },
          rightEye: { sphere: -1.25 },
          pupillaryDistance: 61,
        },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    mockedResolvePageSessionUserId.mockResolvedValue(owner.id);

    const markup = renderToStaticMarkup(await HomePage());

    expect(markup).toContain("Acknowledge report delivery");
    expect(markup).toContain(`/api/v1/sourcing-requests/${request.id}/report/ack`);
    expect(markup).not.toContain("Start report fee checkout");
  });

  it("renders sign-in guidance when session identity is absent", async () => {
    const markup = renderToStaticMarkup(await HomePage());

    expect(markup).toContain(
      "Sign in to load your owner-only sourcing request statuses.",
    );
    expect(markup).toContain("/auth/login?next=%2Ftimeline");
    expect(markup).toContain("/auth/register?next=%2Ftimeline");
    expect(markup).toContain("GDPR self-service actions");
    expect(markup).toContain("Sign in to submit GDPR requests.");
    expect(markup).toContain("For request history and legal-hold guidance");
  });
});
