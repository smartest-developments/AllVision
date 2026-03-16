import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/server/db";
import { resolvePageSessionIdentity } from "@/server/page-auth";
import TimelinePage from "../../app/timeline/page";

vi.mock("@/server/page-auth", () => ({
  resolvePageSessionIdentity: vi.fn(),
}));

const mockedResolvePageSessionIdentity = vi.mocked(resolvePageSessionIdentity);

// Global cleanup to avoid cross-describe state leakage in this large file.
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
    expect(markup).toContain(
      `name="redirectTo" value="/timeline?requestId=${reportReadyRequest.id}&amp;ack=1"`,
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
      `name="redirectTo" value="/timeline?requestId=${reportReadyRequest.id}&amp;checkout=1"`,
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

    expect(markup).toContain("Pricing in progress");
    expect(markup).toContain("Report fee pending (pricing in progress; EUR amount not finalized).");
    expect(markup).toContain(
      `/api/v1/sourcing-requests/${reportReadyRequest.id}/report-fee/checkout`,
    );
    expect(markup).toContain("Start report fee checkout");
  });

  it("renders reason-aware checkout confirmation copy after redirect marker", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-report-fee-post-checkout-owner@example.com",
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

    const pendingRequest = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_PENDING",
        reportPaymentRequired: true,
        reportFeeCents: null,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: pendingRequest.id,
        fromStatus: "REPORT_READY",
        toStatus: "PAYMENT_PENDING",
        note: "Owner initiated report-fee checkout.",
        createdAt: new Date("2026-03-10T04:45:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({
      userId: owner.id,
      role: "USER",
    });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: pendingRequest.id,
          checkout: "1",
        }),
      }),
    );

    expect(markup).toContain("Checkout started. Pricing is still in progress");
    expect(markup).toContain("Pricing in progress");
    expect(markup).toContain("Checkout initiated at 2026-03-10T04:45:00.000Z.");
  });

  it("renders delivery acknowledgment action after report-fee settlement", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-report-fee-settled-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-report-fee-settled-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "REPORT_READY",
        toStatus: "PAYMENT_PENDING",
        note: "Owner initiated report-fee checkout.",
        createdAt: new Date("2026-03-10T04:55:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "Payment settled by admin.",
        createdAt: new Date("2026-03-10T05:05:00.000Z"),
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

    expect(markup).toContain(
      "Report-fee settlement was recorded at 2026-03-10T05:05:00.000Z by an admin.",
    );
    expect(markup).toContain("Settlement note: Payment settled by admin.");
    expect(markup).toContain(`Settlement actor id: ${admin.id}.`);
    expect(markup).toContain(`Settlement actor email: ${admin.email}.`);
    expect(markup).toContain("Settlement evidence token:");
    expect(markup).toContain("Acknowledge report delivery");
    expect(markup).toContain(
      `/api/v1/sourcing-requests/${settledRequest.id}/report/ack`,
    );
    expect(markup).not.toContain("Start report fee checkout");
  });

  it("renders settled checkout confirmation copy with actor email after redirect marker", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-report-fee-post-checkout-settled-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-report-fee-post-checkout-settled-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "REPORT_READY",
        toStatus: "PAYMENT_PENDING",
        note: "Owner initiated report-fee checkout.",
        createdAt: new Date("2026-03-10T05:15:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "Payment settled by admin.",
        createdAt: new Date("2026-03-10T05:30:00.000Z"),
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
          checkout: "1",
        }),
      }),
    );

    expect(markup).toContain("Checkout already settled at 2026-03-10T05:30:00.000Z.");
    expect(markup).toContain(`Settlement actor email: ${admin.email}.`);
  });

  it("renders settled checkout actor-id fallback metadata from redirect params when status payload omits actor-id context", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-report-fee-post-checkout-fallback-owner@example.com",
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

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "REPORT_READY",
        toStatus: "PAYMENT_PENDING",
        note: "Owner initiated report-fee checkout.",
        createdAt: new Date("2026-03-10T05:15:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        note: "Payment settled by admin.",
        createdAt: new Date("2026-03-10T05:30:00.000Z"),
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
          checkout: "1",
          settledByUserId: "redirect-fallback-user-id",
        }),
      }),
    );

    expect(markup).toContain("Checkout already settled at 2026-03-10T05:30:00.000Z.");
    expect(markup).toContain("Settlement actor id: redirect-fallback-user-id.");
  });

  it("renders settled checkout actor-role fallback metadata from redirect params when status payload omits role context", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-report-fee-post-checkout-fallback-role-owner@example.com",
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

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "REPORT_READY",
        toStatus: "PAYMENT_PENDING",
        note: "Owner initiated report-fee checkout.",
        createdAt: new Date("2026-03-10T05:15:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        note: "Payment settled by admin.",
        createdAt: new Date("2026-03-10T05:30:00.000Z"),
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
          checkout: "1",
          settledByRole: "ADMIN",
        }),
      }),
    );

    expect(markup).toContain(
      "Checkout already settled at 2026-03-10T05:30:00.000Z by an admin.",
    );
  });

  it("renders settled checkout actor-email fallback metadata from redirect params when status payload omits actor-email context", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-report-fee-post-checkout-fallback-email-owner@example.com",
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

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "REPORT_READY",
        toStatus: "PAYMENT_PENDING",
        note: "Owner initiated report-fee checkout.",
        createdAt: new Date("2026-03-10T05:15:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        note: "Payment settled by admin.",
        createdAt: new Date("2026-03-10T05:30:00.000Z"),
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
          checkout: "1",
          settledByUserEmail: "redirect-fallback@example.com",
        }),
      }),
    );

    expect(markup).toContain("Checkout already settled at 2026-03-10T05:30:00.000Z.");
    expect(markup).toContain("Settlement actor email: redirect-fallback@example.com.");
  });

  it("renders settled checkout event-id fallback metadata from redirect params when status payload omits event-id context", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-report-fee-post-checkout-fallback-event-id-owner@example.com",
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

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "REPORT_READY",
        toStatus: "PAYMENT_PENDING",
        note: "Owner initiated report-fee checkout.",
        createdAt: new Date("2026-03-10T05:15:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        note: "Payment settled by admin.",
        createdAt: new Date("2026-03-10T05:30:00.000Z"),
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
          checkout: "1",
          settlementEventId: "redirect-fallback-event-id",
        }),
      }),
    );

    expect(markup).toContain("Checkout already settled at 2026-03-10T05:30:00.000Z.");
    expect(markup).toContain("Settlement evidence token: redirect-fallback-event-id.");
  });

  it("renders settled checkout settlement-note fallback metadata from redirect params when status payload omits note context", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-report-fee-post-checkout-fallback-note-owner@example.com",
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

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "REPORT_READY",
        toStatus: "PAYMENT_PENDING",
        note: "Owner initiated report-fee checkout.",
        createdAt: new Date("2026-03-10T05:15:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        createdAt: new Date("2026-03-10T05:30:00.000Z"),
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
          checkout: "1",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Checkout already settled at 2026-03-10T05:30:00.000Z.");
    expect(markup).toContain("Settlement note: redirect-fallback-note.");
  });

  it("renders settled checkout timestamp fallback metadata from redirect params when status payload omits settled-at context", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-checkout-fallback-settled-at@example.com",
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
          checkout: "1",
          settledAt: "2026-03-10T05:35:00.000Z",
        }),
      }),
    );

    expect(markup).toContain("Checkout already settled at 2026-03-10T05:35:00.000Z.");
  });

  it("prefers status payload settled timestamp over redirect fallback on timeline post-checkout confirmation", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-checkout-precedence-settled-at@example.com",
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

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        note: "Payment settled by admin.",
        createdAt: new Date("2026-03-10T05:30:00.000Z"),
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
          checkout: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
        }),
      }),
    );

    expect(markup).toContain("Checkout already settled at 2026-03-10T05:30:00.000Z.");
    expect(markup).not.toContain("Checkout already settled at 1999-01-01T00:00:00.000Z.");
  });

  it("prefers status payload settled actor-id over redirect fallback on timeline post-checkout confirmation", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-checkout-precedence-actor-id@example.com",
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

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "Payment settled by owner.",
        createdAt: new Date("2026-03-10T05:30:00.000Z"),
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
          checkout: "1",
          settledByUserId: "redirect-fallback-user-id",
        }),
      }),
    );

    expect(markup).toContain("Checkout already settled at 2026-03-10T05:30:00.000Z.");
    expect(markup).toContain(`Settlement actor id: ${owner.id}.`);
    expect(markup).not.toContain("Settlement actor id: redirect-fallback-user-id.");
  });

  it("prefers status payload settled actor-role over redirect fallback on timeline post-checkout confirmation", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-checkout-precedence-role@example.com",
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

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "Payment settled by owner.",
        createdAt: new Date("2026-03-10T05:30:00.000Z"),
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
          checkout: "1",
          settledByRole: "ADMIN",
        }),
      }),
    );

    expect(markup).toContain(
      "Checkout already settled at 2026-03-10T05:30:00.000Z by the account owner.",
    );
    expect(markup).not.toContain("Checkout already settled at 2026-03-10T05:30:00.000Z by an admin.");
  });

  it("prefers status payload settled actor-email over redirect fallback on timeline post-checkout confirmation", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-checkout-precedence-actor-email@example.com",
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

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "Payment settled by owner.",
        createdAt: new Date("2026-03-10T05:30:00.000Z"),
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
          checkout: "1",
          settledByUserEmail: "redirect-fallback@example.com",
        }),
      }),
    );

    expect(markup).toContain("Checkout already settled at 2026-03-10T05:30:00.000Z.");
    expect(markup).toContain(`Settlement actor email: ${owner.email}.`);
    expect(markup).not.toContain("Settlement actor email: redirect-fallback@example.com.");
  });

  it("keeps timeline post-checkout actor role/id/email coherent from status payload over mixed redirect fallback metadata", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-checkout-coherent-actor-metadata-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-checkout-coherent-actor-metadata-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "Payment settled by admin.",
        createdAt: new Date("2026-03-10T05:30:00.000Z"),
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
          checkout: "1",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
        }),
      }),
    );

    expect(markup).toContain(
      "Checkout already settled at 2026-03-10T05:30:00.000Z by an admin.",
    );
    expect(markup).toContain(`Settlement actor id: ${admin.id}.`);
    expect(markup).toContain(`Settlement actor email: ${admin.email}.`);
    expect(markup).not.toContain("by the account owner.");
    expect(markup).not.toContain("Settlement actor id: redirect-fallback-user-id.");
    expect(markup).not.toContain("Settlement actor email: redirect-fallback@example.com.");
  });

  it("omits timeline redirect fallback actor role/id/email when actorless status payload is paired with incomplete redirect actor metadata", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-checkout-actorless-incomplete-redirect-fallback-owner@example.com",
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

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        note: "Settlement evidence without actor identity.",
        createdAt: new Date("2026-03-10T05:30:00.000Z"),
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
          checkout: "1",
          settledByRole: "ADMIN",
        }),
      }),
    );

    expect(markup).toContain("Checkout already settled at 2026-03-10T05:30:00.000Z.");
    expect(markup).not.toContain("by an admin.");
    expect(markup).not.toContain("by the account owner.");
    expect(markup).not.toContain("Settlement actor id:");
    expect(markup).not.toContain("Settlement actor email:");
  });

  it("renders timeline redirect fallback actor role/id/email when actorless status payload is paired with a complete redirect actor trio", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-checkout-actorless-complete-redirect-fallback-owner@example.com",
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

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        note: "Settlement evidence without actor identity.",
        createdAt: new Date("2026-03-10T05:30:00.000Z"),
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
          checkout: "1",
          settledByRole: "ADMIN",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
        }),
      }),
    );

    expect(markup).toContain(
      "Checkout already settled at 2026-03-10T05:30:00.000Z by an admin.",
    );
    expect(markup).toContain("Settlement actor id: redirect-fallback-user-id.");
    expect(markup).toContain("Settlement actor email: redirect-fallback@example.com.");
    expect(markup).not.toContain("by the account owner.");
  });

  it("prefers status payload settlement event-id over redirect fallback on timeline post-checkout confirmation", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-checkout-precedence-event-id@example.com",
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

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        note: "Payment settled by admin.",
        createdAt: new Date("2026-03-10T05:30:00.000Z"),
      },
    });

    const settlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: {
        sourcingRequestId: settledRequest.id,
        toStatus: "PAYMENT_SETTLED",
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({
      userId: owner.id,
      role: "USER",
    });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          checkout: "1",
          settlementEventId: "redirect-fallback-event-id",
        }),
      }),
    );

    expect(markup).toContain("Checkout already settled at 2026-03-10T05:30:00.000Z.");
    expect(markup).toContain(`Settlement evidence token: ${settlementEvent?.id}.`);
    expect(markup).not.toContain("Settlement evidence token: redirect-fallback-event-id.");
  });

  it("prefers status payload settlement note over redirect fallback on timeline post-checkout confirmation", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-checkout-precedence-note@example.com",
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

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        note: "Status payload settlement note",
        createdAt: new Date("2026-03-10T05:30:00.000Z"),
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
          checkout: "1",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Checkout already settled at 2026-03-10T05:30:00.000Z.");
    expect(markup).toContain("Settlement note: Status payload settlement note.");
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });

  it("prefers post-ack payload settled-at/actor-role/event/note metadata over mixed redirect fallback values", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-report-fee-post-ack-settled-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-report-fee-post-ack-settled-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "Payment settled by admin.",
        createdAt: new Date("2026-03-10T06:20:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:25:00.000Z"),
      },
    });

    const settlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: {
        sourcingRequestId: settledRequest.id,
        toStatus: "PAYMENT_SETTLED",
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({
      userId: owner.id,
      role: "USER",
    });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T06:20:00.000Z by an admin.");
    expect(markup).not.toContain("by the account owner.");
    expect(markup).toContain(`Settlement actor id: ${admin.id}.`);
    expect(markup).toContain(`Settlement actor email: ${admin.email}.`);
    expect(markup).toContain(`Settlement evidence token: ${settlementEvent?.id}.`);
    expect(markup).toContain("Settlement note: Payment settled by admin..");
    expect(markup).not.toContain("Settlement was completed at 1999-01-01T00:00:00.000Z");
    expect(markup).not.toContain("Settlement actor id: redirect-fallback-user-id.");
    expect(markup).not.toContain("Settlement actor email: redirect-fallback@example.com.");
    expect(markup).not.toContain("Settlement evidence token: redirect-fallback-event-id.");
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });

  it("keeps timeline payload empty-string settlement note authoritative over redirect fallback note on post-ack confirmation", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-empty-note-precedence-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-empty-note-precedence-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "",
        createdAt: new Date("2026-03-10T06:50:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:55:00.000Z"),
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
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T06:50:00.000Z by an admin.");
    expect(markup).not.toContain("Settlement note:");
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });

  it("keeps timeline payload whitespace-only settlement note authoritative over redirect fallback note on post-ack confirmation", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-whitespace-note-precedence-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-whitespace-note-precedence-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "   ",
        createdAt: new Date("2026-03-10T06:50:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:55:00.000Z"),
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
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T06:50:00.000Z by an admin.");
    expect(markup).not.toContain("Settlement note:");
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });

  it("renders timeline trimmed payload settlement note and ignores redirect fallback note on post-ack confirmation", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-trimmed-note-precedence-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-trimmed-note-precedence-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "  Timeline payload note with surrounding whitespace.  ",
        createdAt: new Date("2026-03-10T06:50:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:55:00.000Z"),
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
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T06:50:00.000Z by an admin.");
    expect(markup).toContain("Settlement note: Timeline payload note with surrounding whitespace.");
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });

  it("renders timeline trimmed tab/newline-padded payload settlement note and ignores redirect fallback note on post-ack confirmation", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-tab-newline-note-precedence-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-tab-newline-note-precedence-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\tTimeline payload note with tab/newline padding.\t\n",
        createdAt: new Date("2026-03-10T06:50:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:55:00.000Z"),
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
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T06:50:00.000Z by an admin.");
    expect(markup).toContain("Settlement note: Timeline payload note with tab/newline padding.");
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });

  it("renders timeline trimmed carriage-return/tab-padded payload settlement note and ignores redirect fallback note on post-ack confirmation", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-carriage-tab-note-precedence-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-carriage-tab-note-precedence-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\r\tTimeline payload note with carriage-return and tab padding.\t\r",
        createdAt: new Date("2026-03-10T06:50:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:55:00.000Z"),
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
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T06:50:00.000Z by an admin.");
    expect(markup).toContain("Settlement note: Timeline payload note with carriage-return and tab padding.");
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });

  it("renders timeline trimmed mixed carriage-return/newline/tab-padded payload settlement note and ignores redirect fallback note on post-ack confirmation", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-mixed-crlf-tab-note-precedence-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-mixed-crlf-tab-note-precedence-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\r\n\tTimeline payload note with mixed carriage-return/newline/tab padding.\t\n\r",
        createdAt: new Date("2026-03-10T06:50:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:55:00.000Z"),
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
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T06:50:00.000Z by an admin.");
    expect(markup).toContain("Settlement note: Timeline payload note with mixed carriage-return/newline/tab padding.");
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });

  it("renders timeline trimmed mixed leading/trailing multi-line-whitespace payload settlement note and ignores redirect fallback note on post-ack confirmation", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-multiline-edge-note-precedence-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-multiline-edge-note-precedence-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t\r\n  Timeline payload note with mixed multi-line edge padding. \r\n\t \n",
        createdAt: new Date("2026-03-10T06:50:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:55:00.000Z"),
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
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T06:50:00.000Z by an admin.");
    expect(markup).toContain("Settlement note: Timeline payload note with mixed multi-line edge padding.");
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });

  it("renders timeline trimmed post-ack payload settlement note with preserved internal blank-line segments and ignores redirect fallback note", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-multiline-blank-segment-note-precedence-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-multiline-blank-segment-note-precedence-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\r\n \t",
        createdAt: new Date("2026-03-10T06:50:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:55:00.000Z"),
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
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T06:50:00.000Z by an admin.");
    expect(markup).toContain("Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.");
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });

  it("renders timeline trimmed post-ack payload settlement note with preserved repeated internal blank-line segments and ignores redirect fallback note", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-repeated-multiline-blank-segment-note-precedence-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-repeated-multiline-blank-segment-note-precedence-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\r\n \t",
        createdAt: new Date("2026-03-10T06:50:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:55:00.000Z"),
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
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T06:50:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });

  it("renders timeline trimmed post-ack payload settlement note without trailing whitespace-only lines after repeated internal blank-line segments and ignores redirect fallback note", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-repeated-multiline-trailing-whitespace-lines-note-precedence-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-repeated-multiline-trailing-whitespace-lines-note-precedence-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n   \n\t \r\n",
        createdAt: new Date("2026-03-10T06:50:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:55:00.000Z"),
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
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T06:50:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });

  it("renders timeline trimmed post-ack payload settlement note without mixed tab-only and space-tab trailing whitespace-only lines after repeated internal blank-line segments and ignores redirect fallback note", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-repeated-multiline-mixed-trailing-whitespace-lines-note-precedence-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-repeated-multiline-mixed-trailing-whitespace-lines-note-precedence-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\t\t\n \t  \n\t \t\r\n",
        createdAt: new Date("2026-03-10T06:50:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:55:00.000Z"),
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
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T06:50:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });

  it("renders timeline trimmed post-ack payload settlement note without mixed carriage-return trailing whitespace-only line variants after repeated internal blank-line segments and ignores redirect fallback note", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-repeated-multiline-mixed-carriage-return-trailing-whitespace-lines-note-precedence-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-repeated-multiline-mixed-carriage-return-trailing-whitespace-lines-note-precedence-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r \r\t\r\r\n\t \r\n",
        createdAt: new Date("2026-03-10T06:50:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:55:00.000Z"),
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
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T06:50:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });

  it("renders timeline trimmed post-ack payload settlement note without carriage-return-only terminal trailing whitespace tails and ignores redirect fallback note", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-repeated-multiline-carriage-return-terminal-tail-note-precedence-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-repeated-multiline-carriage-return-terminal-tail-note-precedence-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r \r\t\r\r",
        createdAt: new Date("2026-03-10T06:50:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:55:00.000Z"),
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
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T06:50:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });

  it("renders timeline trimmed post-ack payload settlement note without multi-line carriage-return-only terminal trailing whitespace tails and ignores redirect fallback note", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-repeated-multiline-multi-line-carriage-return-terminal-tail-note-precedence-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-repeated-multiline-multi-line-carriage-return-terminal-tail-note-precedence-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r \r\t\r\r\n\r\t \r\r\n\r \r\t\r\r",
        createdAt: new Date("2026-03-10T06:50:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:55:00.000Z"),
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
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T06:50:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });

  it("renders timeline trimmed post-ack payload settlement note without multi-line carriage-return-only terminal whitespace clusters and ignores redirect fallback note", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-repeated-multiline-carriage-return-terminal-whitespace-cluster-note-precedence-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-repeated-multiline-carriage-return-terminal-whitespace-cluster-note-precedence-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r\r \r\t\r\r\r\n\r\r\t \r\r\r\n\r \r\t\r\r\r",
        createdAt: new Date("2026-03-10T06:50:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:55:00.000Z"),
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
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T06:50:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });

  it("renders timeline trimmed post-ack payload settlement note without terminal carriage-return whitespace clusters split by tab-only separator lines and ignores redirect fallback note", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-repeated-multiline-carriage-return-terminal-whitespace-cluster-tab-separator-note-precedence-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-repeated-multiline-carriage-return-terminal-whitespace-cluster-tab-separator-note-precedence-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n\r\r\t \r\r\r\n\t\n\r \r\t\r\r\r",
        createdAt: new Date("2026-03-10T06:50:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:55:00.000Z"),
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
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T06:50:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });

  it("renders timeline trimmed post-ack payload settlement note without terminal carriage-return whitespace clusters split by tab-only separator lines interleaved with space-only separator lines and ignores redirect fallback note", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-repeated-multiline-carriage-return-terminal-whitespace-cluster-tab-space-separator-note-precedence-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-repeated-multiline-carriage-return-terminal-whitespace-cluster-tab-space-separator-note-precedence-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n    \n\r \r\t\r\r\r",
        createdAt: new Date("2026-03-10T06:50:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:55:00.000Z"),
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
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T06:50:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });

  it("renders timeline trimmed post-ack payload settlement note without terminal carriage-return whitespace clusters split by tab-only separators interleaved with mixed-width space-only separators plus trailing tab-only separators and ignores redirect fallback note", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-repeated-multiline-carriage-return-terminal-whitespace-cluster-tab-mixed-space-trailing-tab-separator-note-precedence-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-repeated-multiline-carriage-return-terminal-whitespace-cluster-tab-mixed-space-trailing-tab-separator-note-precedence-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t",
        createdAt: new Date("2026-03-10T06:50:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:55:00.000Z"),
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
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T06:50:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });

  it("renders timeline trimmed post-ack payload settlement note without terminal carriage-return whitespace clusters split by tab-only separators interleaved with mixed-width space-only separator lines and repeated trailing tab-only separator lines and ignores redirect fallback note", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-repeated-multiline-carriage-return-terminal-whitespace-cluster-tab-mixed-space-repeated-trailing-tab-separator-note-precedence-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-repeated-multiline-carriage-return-terminal-whitespace-cluster-tab-mixed-space-repeated-trailing-tab-separator-note-precedence-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t",
        createdAt: new Date("2026-03-10T06:50:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:55:00.000Z"),
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
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T06:50:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });

  it("renders timeline trimmed post-ack payload settlement note without terminal carriage-return whitespace clusters split by tab-only separators interleaved with mixed-width space-only separator lines, repeated trailing tab-only separator lines, and trailing mixed-width space-only separator lines and ignores redirect fallback note", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-repeated-multiline-carriage-return-terminal-whitespace-cluster-tab-mixed-space-trailing-mixed-space-separator-note-precedence-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-repeated-multiline-carriage-return-terminal-whitespace-cluster-tab-mixed-space-trailing-mixed-space-separator-note-precedence-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   ",
        createdAt: new Date("2026-03-10T06:50:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:55:00.000Z"),
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
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T06:50:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });

  it("renders timeline trimmed post-ack payload settlement note without terminal carriage-return whitespace clusters split by tab-only separators interleaved with mixed-width space-only separator lines, repeated trailing tab-only separator lines, trailing mixed-width space-only separator lines, and repeated trailing mixed-width space-only separator lines and ignores redirect fallback note", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-repeated-multiline-carriage-return-terminal-whitespace-cluster-tab-mixed-space-repeated-trailing-mixed-space-separator-note-precedence-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-repeated-multiline-carriage-return-terminal-whitespace-cluster-tab-mixed-space-repeated-trailing-mixed-space-separator-note-precedence-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n \t  \n     ",
        createdAt: new Date("2026-03-10T06:50:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:55:00.000Z"),
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
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T06:50:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });

  it("renders timeline trimmed post-ack payload settlement note without terminal carriage-return whitespace clusters split by tab-only separators interleaved with mixed-width space-only separator lines, repeated trailing tab-only separator lines, and repeated trailing mixed-width space-only separator lines spanning three terminal lines and ignores redirect fallback note", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-repeated-multiline-carriage-return-terminal-whitespace-cluster-tab-mixed-space-three-line-trailing-mixed-space-separator-note-precedence-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-repeated-multiline-carriage-return-terminal-whitespace-cluster-tab-mixed-space-three-line-trailing-mixed-space-separator-note-precedence-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       ",
        createdAt: new Date("2026-03-10T06:50:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:55:00.000Z"),
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
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T06:50:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });

  it("renders post-delivery acknowledgment settlement timestamp and actor-trio fallback metadata when status payload omits settlement context", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-report-fee-post-ack-fallback-owner@example.com",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "REPORT_READY",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:35:00.000Z"),
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
          ack: "1",
          settledAt: "2026-03-10T06:30:00.000Z",
          settledByRole: "ADMIN",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T06:30:00.000Z by an admin.");
    expect(markup).toContain("Settlement actor id: redirect-fallback-user-id.");
    expect(markup).toContain("Settlement actor email: redirect-fallback@example.com.");
    expect(markup).toContain("Settlement evidence token: redirect-fallback-event-id.");
    expect(markup).toContain("Settlement note: redirect-fallback-note.");
  });

  it("omits timeline post-ack redirect actor fallback metadata when redirect actor trio is incomplete", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-report-fee-post-ack-incomplete-actor-trio-owner@example.com",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "REPORT_READY",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:35:00.000Z"),
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
          ack: "1",
          settledAt: "2026-03-10T06:30:00.000Z",
          settledByRole: "ADMIN",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T06:30:00.000Z.");
    expect(markup).not.toContain("Settlement actor id:");
    expect(markup).not.toContain("Settlement actor email:");
  });
});

describe("Timeline page deep-linking (AT-AUTO-UI-84)", () => {
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

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span four terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-four-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-four-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      ",
        createdAt: new Date("2026-03-10T06:50:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:55:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T06:50:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("Timeline page deep-linking (AT-AUTO-UI-85)", () => {
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

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span five terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-five-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-five-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      ",
        createdAt: new Date("2026-03-10T07:05:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T07:10:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T07:05:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("Timeline page deep-linking (AT-AUTO-UI-86)", () => {
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

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span six terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-six-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-six-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       ",
        createdAt: new Date("2026-03-10T07:25:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T07:30:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T07:25:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("Timeline page deep-linking (AT-AUTO-UI-87)", () => {
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

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span seven terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-seven-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-seven-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         ",
        createdAt: new Date("2026-03-10T07:45:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T07:50:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T07:45:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("Timeline page deep-linking (AT-AUTO-UI-88)", () => {
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

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span eight terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-eight-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-eight-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           ",
        createdAt: new Date("2026-03-10T08:05:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T08:10:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T08:05:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("Timeline page deep-linking (AT-AUTO-UI-89)", () => {
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

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span nine terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-nine-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-nine-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n        \n",
        createdAt: new Date("2026-03-10T08:25:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T08:30:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T08:25:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("Timeline page deep-linking (AT-AUTO-UI-90)", () => {
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

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span ten terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-ten-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-ten-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n",
        createdAt: new Date("2026-03-10T08:35:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T08:40:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T08:35:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("Timeline page deep-linking (AT-AUTO-UI-91)", () => {
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

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span eleven terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-eleven-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-eleven-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n",
        createdAt: new Date("2026-03-10T08:45:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T08:50:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T08:45:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("Timeline page deep-linking (AT-AUTO-UI-92)", () => {
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

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span twelve terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-twelve-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-twelve-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n",
        createdAt: new Date("2026-03-10T08:55:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T09:00:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T08:55:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("Timeline page deep-linking (AT-AUTO-UI-93)", () => {
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

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span thirteen terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-thirteen-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-thirteen-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n",
        createdAt: new Date("2026-03-10T09:05:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T09:10:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T09:05:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("Timeline page deep-linking (AT-AUTO-UI-94)", () => {
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

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span fourteen terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-fourteen-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-fourteen-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n",
        createdAt: new Date("2026-03-10T09:15:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T09:20:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T09:15:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("Timeline page deep-linking (AT-AUTO-UI-95)", () => {
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

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span fifteen terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-fifteen-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-fifteen-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n",
        createdAt: new Date("2026-03-10T09:25:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T09:30:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T09:25:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("Timeline page deep-linking (AT-AUTO-UI-96)", () => {
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

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span sixteen terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-sixteen-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-sixteen-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n",
        createdAt: new Date("2026-03-10T09:35:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T09:40:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T09:35:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("Timeline page deep-linking (AT-AUTO-UI-97)", () => {
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

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span seventeen terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-seventeen-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-seventeen-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n",
        createdAt: new Date("2026-03-10T09:45:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T09:50:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T09:45:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("Timeline page deep-linking (AT-AUTO-UI-98)", () => {
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

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span eighteen terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-eighteen-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-eighteen-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n",
        createdAt: new Date("2026-03-10T09:55:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T10:00:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T09:55:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("Timeline page deep-linking (AT-AUTO-UI-99)", () => {
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

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span nineteen terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-nineteen-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-nineteen-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n  \n",
        createdAt: new Date("2026-03-10T10:05:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T10:10:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T10:05:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("Timeline page deep-linking (AT-AUTO-UI-109)", () => {
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

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span twenty-nine terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-twenty-nine-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-twenty-nine-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n  \n \n    \n   \n  \n     \n",
        createdAt: new Date("2026-03-10T10:19:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T10:20:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T10:19:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("Timeline page deep-linking (AT-AUTO-UI-106)", () => {
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

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span twenty-six terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-twenty-six-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-twenty-six-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n  \n \n    \n   \n  \n     \n      \n       \n",
        createdAt: new Date("2026-03-10T10:20:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T10:21:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T10:20:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("Timeline page deep-linking (AT-AUTO-UI-107)", () => {
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

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span twenty-seven terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-twenty-seven-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-twenty-seven-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n  \n \n    \n   \n  \n     \n      \n       \n        \n",
        createdAt: new Date("2026-03-10T10:22:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T10:23:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T10:22:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("Timeline page deep-linking (AT-AUTO-UI-108)", () => {
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

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span twenty-eight terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-twenty-eight-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-twenty-eight-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n  \n \n    \n   \n  \n     \n      \n       \n        \n          \n",
        createdAt: new Date("2026-03-10T10:24:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T10:25:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T10:24:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("Timeline page deep-linking (AT-AUTO-UI-105)", () => {
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

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span twenty-five terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-twenty-five-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-twenty-five-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n  \n \n    \n   \n  \n     \n      \n",
        createdAt: new Date("2026-03-10T10:19:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T10:20:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T10:19:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("Timeline page deep-linking (AT-AUTO-UI-104)", () => {
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

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span twenty-four terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-twenty-four-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-twenty-four-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n  \n \n    \n   \n  \n     \n",
        createdAt: new Date("2026-03-10T10:19:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T10:21:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T10:19:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("Timeline page deep-linking (AT-AUTO-UI-100)", () => {
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

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span twenty terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-twenty-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-twenty-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n  \n \n",
        createdAt: new Date("2026-03-10T10:15:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T10:20:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T10:15:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("Timeline page deep-linking (AT-AUTO-UI-101)", () => {
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

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span twenty-one terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-twenty-one-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-twenty-one-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n  \n \n    \n",
        createdAt: new Date("2026-03-10T10:16:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T10:20:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T10:16:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("Timeline page deep-linking (AT-AUTO-UI-102)", () => {
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

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span twenty-two terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-twenty-two-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-twenty-two-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n  \n \n    \n   \n",
        createdAt: new Date("2026-03-10T10:17:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T10:20:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T10:17:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("Timeline page deep-linking (AT-AUTO-UI-103)", () => {
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

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span twenty-three terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-twenty-three-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-twenty-three-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n  \n \n    \n   \n  \n",
        createdAt: new Date("2026-03-10T10:18:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T10:20:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T10:18:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("Timeline page deep-linking (AT-AUTO-UI-99)", () => {
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

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span nineteen terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-nineteen-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-nineteen-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n  \n\n",
        createdAt: new Date("2026-03-10T10:05:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T10:10:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T10:05:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("Timeline page deep-linking (AT-AUTO-UI-110)", () => {
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

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span thirty terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-thirty-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-thirty-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n  \n \n    \n   \n  \n     \n      \n       \n        \n          \n            \n              \n",
        createdAt: new Date("2026-03-10T10:20:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T10:21:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T10:20:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("Timeline page deep-linking (AT-AUTO-UI-111)", () => {
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

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span thirty-one terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-thirty-one-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-thirty-one-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n  \n \n    \n   \n  \n     \n      \n       \n        \n          \n            \n              \n                \n",
        createdAt: new Date("2026-03-10T10:22:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T10:23:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T10:22:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("Timeline page deep-linking (AT-AUTO-UI-112)", () => {
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

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span thirty-two terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-thirty-two-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-thirty-two-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n  \n \n    \n   \n  \n     \n      \n       \n        \n          \n            \n              \n                \n                  \n",
        createdAt: new Date("2026-03-10T10:24:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T10:25:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T10:24:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("Timeline page deep-linking (AT-AUTO-UI-113)", () => {
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

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span thirty-three terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-thirty-three-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-thirty-three-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n  \n \n    \n   \n  \n     \n      \n       \n        \n          \n            \n              \n                \n                  \n                    \n",
        createdAt: new Date("2026-03-10T10:26:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T10:27:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T10:26:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("Timeline page deep-linking (AT-AUTO-UI-114)", () => {
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

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span thirty-four terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-thirty-four-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-thirty-four-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n  \n \n    \n   \n  \n     \n      \n       \n        \n          \n            \n              \n                \n                  \n                    \n                      \n",
        createdAt: new Date("2026-03-10T10:28:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T10:29:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T10:28:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("Timeline page deep-linking (AT-AUTO-UI-115)", () => {
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

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span thirty-five terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-thirty-five-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-thirty-five-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n  \n \n    \n   \n  \n     \n      \n       \n        \n          \n            \n              \n                \n                  \n                    \n                      \n                        \n",
        createdAt: new Date("2026-03-10T10:30:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T10:31:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T10:30:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("Timeline page deep-linking (AT-AUTO-UI-116)", () => {
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

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span thirty-six terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-thirty-six-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-thirty-six-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n  \n \n    \n   \n  \n     \n      \n       \n        \n          \n            \n              \n                \n                  \n                    \n                      \n                        \n                          \n",
        createdAt: new Date("2026-03-10T10:32:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T10:33:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T10:32:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("Timeline page deep-linking (AT-AUTO-UI-118)", () => {
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

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span thirty-eight terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-thirty-eight-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-thirty-eight-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n  \n \n    \n   \n  \n     \n      \n       \n        \n          \n            \n              \n                \n                  \n                    \n                      \n                        \n                          \n                            \n",
        createdAt: new Date("2026-03-10T10:34:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T10:35:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T10:34:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("Timeline page deep-linking (AT-AUTO-UI-117)", () => {
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

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span thirty-seven terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-thirty-seven-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-thirty-seven-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n  \n \n    \n   \n  \n     \n      \n       \n        \n          \n            \n              \n                \n                  \n                    \n                      \n                        \n                          \n                            \n                              \n",
        createdAt: new Date("2026-03-10T10:38:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T10:39:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T10:38:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("Timeline page deep-linking (AT-AUTO-UI-119)", () => {
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

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span thirty-nine terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-thirty-nine-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-thirty-nine-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n  \n \n    \n   \n  \n     \n      \n       \n        \n          \n            \n              \n                \n                  \n                    \n                      \n                        \n                          \n                            \n                              \n                                \n",
        createdAt: new Date("2026-03-10T10:39:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T10:40:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T10:39:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("Timeline page deep-linking (AT-AUTO-UI-120)", () => {
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

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span forty terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-forty-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-forty-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n  \n \n    \n   \n  \n     \n      \n       \n        \n          \n            \n              \n                \n                  \n                    \n                      \n                        \n                          \n                            \n                              \n                                \n                                  \n",
        createdAt: new Date("2026-03-10T10:40:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T10:43:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T10:40:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("Timeline page deep-linking (AT-AUTO-UI-122)", () => {
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

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span forty-two terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-forty-two-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-forty-two-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n  \n \n    \n   \n  \n     \n      \n       \n        \n          \n            \n              \n                \n                  \n                    \n                      \n                        \n                          \n                            \n                              \n                                \n                                  \n                                    \n",
        createdAt: new Date("2026-03-10T10:42:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T10:43:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T10:42:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("Timeline page deep-linking (AT-AUTO-UI-123)", () => {
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

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span forty-three terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-forty-three-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-forty-three-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 43 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T10:43:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T10:43:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T10:43:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("Timeline page deep-linking (AT-AUTO-UI-124)", () => {
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

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span forty-four terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-forty-four-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-forty-four-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 44 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T10:44:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T10:44:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T10:44:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("Timeline page deep-linking (AT-AUTO-UI-125)", () => {
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

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span forty-five terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-forty-five-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-forty-five-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 45 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T10:45:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T10:45:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T10:45:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("Timeline page deep-linking (AT-AUTO-UI-126)", () => {
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

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span forty-six terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-forty-six-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-forty-six-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 46 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T10:46:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T10:46:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T10:46:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("Timeline page deep-linking (AT-AUTO-UI-126)", () => {
  beforeEach(async () => {
    await prisma.reportArtifact.deleteMany();
    await prisma.sourcingStatusEvent.deleteMany();
    await prisma.sourcingRequest.deleteMany();
    await prisma.prescription.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span forty-six terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-forty-six-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-forty-six-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 46 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T10:46:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T10:46:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T10:46:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("Timeline page deep-linking (AT-AUTO-UI-126)", () => {
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

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span forty-six terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-forty-six-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-forty-six-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 46 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T10:46:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T10:46:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T10:46:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("Timeline page deep-linking (AT-AUTO-UI-127)", () => {
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

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span forty-seven terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-forty-seven-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-forty-seven-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 47 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T10:47:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T10:47:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T10:47:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span forty-eight terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-forty-eight-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-forty-eight-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 48 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T10:48:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T10:48:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T10:48:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span forty-nine terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-forty-nine-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-forty-nine-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 49 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T10:49:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T10:49:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T10:49:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span fifty terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-fifty-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-fifty-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 50 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T10:50:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T10:50:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T10:50:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });

  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span fifty-one terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-fifty-one-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-fifty-one-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 51 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T10:51:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T10:51:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T10:51:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-132)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span fifty-two terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-fifty-two-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-fifty-two-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 52 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T10:52:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T10:52:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T10:52:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-133)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span fifty-three terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-fifty-three-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-fifty-three-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 53 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T10:53:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T10:53:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T10:53:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-134)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span fifty-four terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-fifty-four-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-fifty-four-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 54 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T10:54:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T10:54:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T10:54:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-135)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span fifty-five terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-fifty-five-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-fifty-five-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 55 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T10:55:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T10:55:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T10:55:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-136)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span fifty-six terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-fifty-six-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-fifty-six-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 56 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T10:56:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T10:56:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T10:56:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-137)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span fifty-seven terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-fifty-seven-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-fifty-seven-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 57 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T10:57:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T10:57:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T10:57:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-138)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span fifty-eight terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-fifty-eight-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-fifty-eight-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 58 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T10:58:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T10:58:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T10:58:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-139)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span fifty-nine terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-fifty-nine-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-fifty-nine-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 59 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T10:59:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T10:59:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T10:59:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-140)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span sixty terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-sixty-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-sixty-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 60 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T11:00:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T11:00:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T11:00:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-137)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span fifty-seven terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-fifty-seven-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-fifty-seven-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 57 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T10:57:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T10:57:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T10:57:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-141)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span sixty-one terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-sixty-one-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-sixty-one-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 61 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T11:01:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T11:01:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T11:01:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-142)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span sixty-two terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-sixty-two-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-sixty-two-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 62 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T11:02:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T11:02:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T11:02:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-143)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span sixty-three terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-sixty-three-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-sixty-three-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 63 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T11:03:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T11:03:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T11:03:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-144)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span sixty-four terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-sixty-four-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-sixty-four-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 64 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T11:04:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T11:04:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T11:04:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-145)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span sixty-five terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-sixty-five-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-sixty-five-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 65 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T11:05:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T11:05:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T11:05:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-146)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span sixty-six terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-sixty-six-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-sixty-six-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 66 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T11:07:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T11:07:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T11:07:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-147)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span sixty-seven terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-sixty-seven-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-sixty-seven-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 67 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T11:06:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T11:06:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T11:06:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-145)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span sixty-five terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-sixty-five-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-sixty-five-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 65 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T11:05:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T11:05:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T11:05:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-145)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span sixty-five terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-sixty-five-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-sixty-five-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 65 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T11:05:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T11:05:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T11:05:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-146)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span sixty-six terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-sixty-six-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-sixty-six-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 66 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T11:05:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T11:05:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T11:05:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-148)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span sixty-eight terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-sixty-eight-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-sixty-eight-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 68 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T11:08:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T11:08:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T11:08:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-149)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span sixty-nine terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-sixty-nine-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-sixty-nine-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 69 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T11:09:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T11:09:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T11:09:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-150)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span seventy terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-seventy-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-seventy-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 70 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T11:10:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T11:10:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T11:10:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-151)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span seventy-one terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-seventy-one-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-seventy-one-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 71 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T11:11:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T11:11:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T11:11:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-152)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span seventy-two terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-seventy-two-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-seventy-two-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 72 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T11:12:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T11:12:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T11:12:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-153)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span seventy-three terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-seventy-three-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-seventy-three-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 73 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T11:13:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T11:13:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T11:13:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-154)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span seventy-four terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-seventy-four-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-seventy-four-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 74 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T11:14:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T11:14:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T11:14:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-155)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span seventy-five terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-seventy-five-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-seventy-five-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 75 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T11:15:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T11:15:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T11:15:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-156)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span seventy-six terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-seventy-six-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-seventy-six-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 76 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T11:16:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T11:16:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T11:16:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-157)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span seventy-seven terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-seventy-seven-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-seventy-seven-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 77 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T11:17:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T11:17:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T11:17:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});


describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-158)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span seventy-eight terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-seventy-eight-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-seventy-eight-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 78 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T11:18:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T11:18:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T11:18:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-159)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span seventy-nine terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-seventy-nine-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-seventy-nine-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 79 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T11:19:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T11:19:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T11:19:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-160)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span eighty terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-eighty-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-eighty-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 80 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T11:20:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T11:20:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T11:20:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-161)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span eighty-one terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-eighty-one-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-eighty-one-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 81 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T11:21:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T11:21:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T11:21:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-163)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span eighty-three terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-eighty-three-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-eighty-three-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 83 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T11:22:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T11:22:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T11:22:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-164)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span eighty-four terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-eighty-four-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-eighty-four-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 84 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T11:23:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T11:23:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T11:23:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-165)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span eighty-five terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-eighty-five-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-eighty-five-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 85 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T11:24:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T11:24:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T11:24:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-166)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span eighty-six terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-eighty-six-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-eighty-six-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 86 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T11:25:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T11:25:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T11:25:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-167)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span eighty-seven terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-eighty-seven-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-eighty-seven-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 87 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T11:22:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T11:22:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T11:22:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-165)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span eighty-five terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-eighty-five-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-eighty-five-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 85 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T11:24:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T11:24:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T11:24:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-166)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span eighty-six terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-eighty-six-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-eighty-six-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 86 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T11:23:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T11:23:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T11:23:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-167)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span eighty-seven terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-eighty-seven-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-eighty-seven-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 87 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T11:26:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T11:26:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T11:26:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-168)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span eighty-eight terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-eighty-eight-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-eighty-eight-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 88 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T11:28:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T11:28:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T11:28:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-169)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span eighty-nine terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-eighty-nine-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-eighty-nine-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 89 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T11:30:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T11:30:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T11:30:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-170)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span ninety terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-ninety-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-ninety-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 90 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T11:32:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T11:32:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T11:32:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-169)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span eighty-nine terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-eighty-nine-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-eighty-nine-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 89 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T11:29:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T11:29:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T11:29:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-170)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span ninety terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-ninety-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-ninety-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 90 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T11:32:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T11:32:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T11:32:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-170)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span ninety terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-ninety-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-ninety-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 90 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T11:31:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T11:31:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T11:31:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-171)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span ninety-one terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-ninety-one-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-ninety-one-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 91 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T11:33:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T11:33:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T11:33:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});

describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-172)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span ninety-two terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-ninety-two-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-ninety-two-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 92 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T11:34:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T11:34:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T11:34:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});
