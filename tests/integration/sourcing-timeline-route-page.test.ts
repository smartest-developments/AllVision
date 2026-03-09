import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/server/db";
import { resolvePageSessionIdentity } from "@/server/page-auth";
import TimelinePage from "../../app/timeline/page";

vi.mock("@/server/page-auth", () => ({
  resolvePageSessionIdentity: vi.fn(),
}));

const mockedResolvePageSessionIdentity = vi.mocked(resolvePageSessionIdentity);

describe("Timeline page deep-linking", () => {
  beforeEach(async () => {
    mockedResolvePageSessionIdentity.mockReset();
    mockedResolvePageSessionIdentity.mockResolvedValue(null);
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

    mockedResolvePageSessionIdentity.mockResolvedValue({
      userId: owner.id,
      role: "USER",
    });

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

    mockedResolvePageSessionIdentity.mockResolvedValue({
      userId: owner.id,
      role: "USER",
    });

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

  it("renders sign-in CTA links with return path when session identity is absent", async () => {
    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: "req_123",
        }),
      }),
    );

    expect(markup).toContain(
      "Sign in to load your owner-only sourcing request statuses.",
    );
    expect(markup).toContain(
      "/auth/login?next=%2Ftimeline%3FrequestId%3Dreq_123",
    );
    expect(markup).toContain(
      "/auth/register?next=%2Ftimeline%3FrequestId%3Dreq_123",
    );
  });

  it("renders prescription detail panel for owner-visible record", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-prescription-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "CH",
        payload: {
          countryCode: "CH",
          leftEye: { sphere: -1.0 },
          rightEye: { sphere: -0.75 },
          pupillaryDistance: 61,
        },
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({
      userId: owner.id,
      role: "USER",
    });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          prescriptionId: prescription.id,
        }),
      }),
    );

    expect(markup).toContain(`Prescription detail ${prescription.id}`);
    expect(markup).toContain("Country: CH");
    expect(markup).toContain("Left sphere: -1");
    expect(markup).toContain("Right sphere: -0.75");
    expect(markup).toContain("Pupillary distance: 61");
  });

  it("renders forbidden prescription message when record belongs to another user", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-prescription-actor@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const other = await prisma.user.create({
      data: {
        email: "timeline-prescription-other@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const prescription = await prisma.prescription.create({
      data: {
        userId: other.id,
        countryCode: "DE",
        payload: {
          countryCode: "DE",
          leftEye: { sphere: -2.0 },
          rightEye: { sphere: -1.5 },
          pupillaryDistance: 63,
        },
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({
      userId: owner.id,
      role: "USER",
    });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          prescriptionId: prescription.id,
        }),
      }),
    );

    expect(markup).toContain(
      "Prescription detail unavailable: access denied for this account (403).",
    );
  });

  it("renders not-found prescription message for unknown record id", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-prescription-not-found@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({
      userId: owner.id,
      role: "USER",
    });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          prescriptionId: "missing-prescription-id",
        }),
      }),
    );

    expect(markup).toContain(
      "Prescription detail unavailable: record not found (404).",
    );
  });

  it("renders report-delivery acknowledgment action for focused report-ready request", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-report-ready-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "CH",
        payload: {
          countryCode: "CH",
          leftEye: { sphere: -1.0 },
          rightEye: { sphere: -0.75 },
          pupillaryDistance: 61,
        },
      },
    });

    const reportReadyRequest = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "REPORT_READY",
        reportPaymentRequired: false,
        currency: "EUR",
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({
      userId: owner.id,
      role: "USER",
    });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: reportReadyRequest.id,
        }),
      }),
    );

    expect(markup).toContain("Acknowledge report delivery");
    expect(markup).toContain(
      `/api/v1/sourcing-requests/${reportReadyRequest.id}/report/ack`,
    );
  });

  it("renders report-fee checkout CTA when report payment is required", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-report-fee-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "CH",
        payload: {
          countryCode: "CH",
          leftEye: { sphere: -1.0 },
          rightEye: { sphere: -0.75 },
          pupillaryDistance: 61,
        },
      },
    });

    const reportReadyRequest = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "REPORT_READY",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({
      userId: owner.id,
      role: "USER",
    });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: reportReadyRequest.id,
        }),
      }),
    );

    expect(markup).toContain("Report fee pending (EUR 19.90).");
    expect(markup).toContain(
      `/api/v1/sourcing-requests/${reportReadyRequest.id}/report-fee/checkout`,
    );
    expect(markup).toContain(
      `name="redirectTo" value="/timeline?requestId=${reportReadyRequest.id}"`,
    );
    expect(markup).toContain("Start report fee checkout");
    expect(markup).not.toContain("Acknowledge report delivery");
  });

  it("renders pending-pricing fallback copy on focused timeline when report fee amount is unavailable", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-report-fee-pending-pricing-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "CH",
        payload: {
          countryCode: "CH",
          leftEye: { sphere: -1.0 },
          rightEye: { sphere: -0.75 },
          pupillaryDistance: 61,
        },
      },
    });

    const reportReadyRequest = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "REPORT_READY",
        reportPaymentRequired: true,
        reportFeeCents: null,
        currency: "EUR",
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({
      userId: owner.id,
      role: "USER",
    });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: reportReadyRequest.id,
        }),
      }),
    );

    expect(markup).toContain("Report fee pending (EUR pending pricing).");
    expect(markup).toContain(
      `/api/v1/sourcing-requests/${reportReadyRequest.id}/report-fee/checkout`,
    );
    expect(markup).toContain("Start report fee checkout");
  });

  it("renders delivery acknowledgment action after report-fee settlement", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-report-fee-settled-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "CH",
        payload: {
          countryCode: "CH",
          leftEye: { sphere: -1.0 },
          rightEye: { sphere: -0.75 },
          pupillaryDistance: 61,
        },
      },
    });

    const settledRequest = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({
      userId: owner.id,
      role: "USER",
    });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
        }),
      }),
    );

    expect(markup).toContain("Acknowledge report delivery");
    expect(markup).toContain(
      `/api/v1/sourcing-requests/${settledRequest.id}/report/ack`,
    );
    expect(markup).not.toContain("Start report fee checkout");
  });
});
