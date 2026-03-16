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

  it("renders pending-pricing fallback copy when report fee amount is not populated", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-owner-fee-pending-pricing@example.com",
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

    await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "REPORT_READY",
        reportPaymentRequired: true,
        reportFeeCents: null,
        currency: "EUR",
      },
    });

    mockedResolvePageSessionUserId.mockResolvedValue(owner.id);

    const markup = renderToStaticMarkup(await HomePage());

    expect(markup).toContain("Report fee pending (EUR pending pricing).");
    expect(markup).toContain("Start report fee checkout");
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

  it("renders post-acknowledgment settlement actor-trio fallback metadata from redirect params", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-owner-post-ack-fallback-event-id@example.com",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "REPORT_READY",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:35:00.000Z"),
      },
    });

    mockedResolvePageSessionUserId.mockResolvedValue(owner.id);

    const markup = renderToStaticMarkup(
      await HomePage({
        searchParams: Promise.resolve({
          requestId: request.id,
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

  it("omits post-acknowledgment redirect actor fallback metadata when redirect actor trio is incomplete", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-owner-post-ack-incomplete-actor-trio@example.com",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "REPORT_READY",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:35:00.000Z"),
      },
    });

    mockedResolvePageSessionUserId.mockResolvedValue(owner.id);

    const markup = renderToStaticMarkup(
      await HomePage({
        searchParams: Promise.resolve({
          requestId: request.id,
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

  it("prefers post-ack status payload settled-at/actor-role/event/note metadata over mixed redirect fallback values", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-owner-post-ack-precedence-event-note@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-admin-post-ack-precedence-event-note@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "Status payload settlement note",
        createdAt: new Date("2026-03-10T06:20:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:25:00.000Z"),
      },
    });

    const settlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: {
        sourcingRequestId: request.id,
        toStatus: "PAYMENT_SETTLED",
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    mockedResolvePageSessionUserId.mockResolvedValue(owner.id);

    const markup = renderToStaticMarkup(
      await HomePage({
        searchParams: Promise.resolve({
          requestId: request.id,
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
    expect(markup).toContain(`Settlement evidence token: ${settlementEvent?.id}.`);
    expect(markup).toContain("Settlement note: Status payload settlement note.");
    expect(markup).not.toContain("Settlement was completed at 1999-01-01T00:00:00.000Z");
    expect(markup).not.toContain("Settlement evidence token: redirect-fallback-event-id.");
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
    expect(markup).not.toContain("Settlement actor id: redirect-fallback-user-id.");
    expect(markup).not.toContain("Settlement actor email: redirect-fallback@example.com.");
  });

  it("keeps payload empty-string settlement note authoritative over redirect fallback note on post-ack confirmation", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-owner-post-ack-empty-note-precedence@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-admin-post-ack-empty-note-precedence@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "",
        createdAt: new Date("2026-03-10T06:50:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:55:00.000Z"),
      },
    });

    mockedResolvePageSessionUserId.mockResolvedValue(owner.id);

    const markup = renderToStaticMarkup(
      await HomePage({
        searchParams: Promise.resolve({
          requestId: request.id,
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

  it("keeps payload whitespace-only settlement note authoritative over redirect fallback note on post-ack confirmation", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-owner-post-ack-whitespace-note-precedence@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-admin-post-ack-whitespace-note-precedence@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "   ",
        createdAt: new Date("2026-03-10T06:50:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:55:00.000Z"),
      },
    });

    mockedResolvePageSessionUserId.mockResolvedValue(owner.id);

    const markup = renderToStaticMarkup(
      await HomePage({
        searchParams: Promise.resolve({
          requestId: request.id,
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

  it("renders trimmed payload settlement note and ignores redirect fallback note on post-ack confirmation", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-owner-post-ack-trimmed-note-precedence@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-admin-post-ack-trimmed-note-precedence@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "  Payload note with surrounding whitespace.  ",
        createdAt: new Date("2026-03-10T06:50:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:55:00.000Z"),
      },
    });

    mockedResolvePageSessionUserId.mockResolvedValue(owner.id);

    const markup = renderToStaticMarkup(
      await HomePage({
        searchParams: Promise.resolve({
          requestId: request.id,
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
    expect(markup).toContain("Settlement note: Payload note with surrounding whitespace.");
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });

  it("renders trimmed tab/newline-padded payload settlement note and ignores redirect fallback note on post-ack confirmation", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-owner-post-ack-tab-newline-note-precedence@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-admin-post-ack-tab-newline-note-precedence@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\tPayload note with tab/newline padding.\t\n",
        createdAt: new Date("2026-03-10T06:50:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:55:00.000Z"),
      },
    });

    mockedResolvePageSessionUserId.mockResolvedValue(owner.id);

    const markup = renderToStaticMarkup(
      await HomePage({
        searchParams: Promise.resolve({
          requestId: request.id,
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
    expect(markup).toContain("Settlement note: Payload note with tab/newline padding.");
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });

  it("renders trimmed carriage-return/tab-padded payload settlement note and ignores redirect fallback note on post-ack confirmation", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-owner-post-ack-carriage-tab-note-precedence@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-admin-post-ack-carriage-tab-note-precedence@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\r\tPayload note with carriage-return and tab padding.\t\r",
        createdAt: new Date("2026-03-10T06:50:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:55:00.000Z"),
      },
    });

    mockedResolvePageSessionUserId.mockResolvedValue(owner.id);

    const markup = renderToStaticMarkup(
      await HomePage({
        searchParams: Promise.resolve({
          requestId: request.id,
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
    expect(markup).toContain("Settlement note: Payload note with carriage-return and tab padding.");
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });

  it("renders trimmed mixed carriage-return/newline/tab-padded payload settlement note and ignores redirect fallback note on post-ack confirmation", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-owner-post-ack-mixed-crlf-tab-note-precedence@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-admin-post-ack-mixed-crlf-tab-note-precedence@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\r\n\tPayload note with mixed carriage-return/newline/tab padding.\t\n\r",
        createdAt: new Date("2026-03-10T06:50:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:55:00.000Z"),
      },
    });

    mockedResolvePageSessionUserId.mockResolvedValue(owner.id);

    const markup = renderToStaticMarkup(
      await HomePage({
        searchParams: Promise.resolve({
          requestId: request.id,
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
    expect(markup).toContain("Settlement note: Payload note with mixed carriage-return/newline/tab padding.");
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });

  it("renders trimmed mixed leading/trailing multi-line-whitespace payload settlement note and ignores redirect fallback note on post-ack confirmation", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-owner-post-ack-multiline-edge-note-precedence@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-admin-post-ack-multiline-edge-note-precedence@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t\r\n  Payload note with mixed multi-line edge padding. \r\n\t \n",
        createdAt: new Date("2026-03-10T06:50:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:55:00.000Z"),
      },
    });

    mockedResolvePageSessionUserId.mockResolvedValue(owner.id);

    const markup = renderToStaticMarkup(
      await HomePage({
        searchParams: Promise.resolve({
          requestId: request.id,
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
    expect(markup).toContain("Settlement note: Payload note with mixed multi-line edge padding.");
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });

  it("renders trimmed post-ack payload settlement note with preserved internal blank-line segments and ignores redirect fallback note", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-owner-post-ack-multiline-blank-segment-note-precedence@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-admin-post-ack-multiline-blank-segment-note-precedence@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Payload note line one.\n\nPayload note line two.\r\n \t",
        createdAt: new Date("2026-03-10T06:50:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:55:00.000Z"),
      },
    });

    mockedResolvePageSessionUserId.mockResolvedValue(owner.id);

    const markup = renderToStaticMarkup(
      await HomePage({
        searchParams: Promise.resolve({
          requestId: request.id,
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
    expect(markup).toContain("Settlement note: Payload note line one.\n\nPayload note line two.");
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });

  it("renders trimmed post-ack payload settlement note with preserved repeated internal blank-line segments and ignores redirect fallback note", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-owner-post-ack-repeated-multiline-blank-segment-note-precedence@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-admin-post-ack-repeated-multiline-blank-segment-note-precedence@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Payload note line one.\n\nPayload note line two.\n\nPayload note line three.\r\n \t",
        createdAt: new Date("2026-03-10T06:50:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:55:00.000Z"),
      },
    });

    mockedResolvePageSessionUserId.mockResolvedValue(owner.id);

    const markup = renderToStaticMarkup(
      await HomePage({
        searchParams: Promise.resolve({
          requestId: request.id,
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
    expect(markup).toContain("Settlement note: Payload note line one.\n\nPayload note line two.\n\nPayload note line three.");
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });

  it("renders trimmed post-ack payload settlement note without trailing whitespace-only lines after repeated internal blank-line segments and ignores redirect fallback note", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-owner-post-ack-repeated-multiline-trailing-whitespace-lines-note-precedence@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-admin-post-ack-repeated-multiline-trailing-whitespace-lines-note-precedence@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Payload note line one.\n\nPayload note line two.\n\nPayload note line three.\n   \n\t \r\n",
        createdAt: new Date("2026-03-10T06:50:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:55:00.000Z"),
      },
    });

    mockedResolvePageSessionUserId.mockResolvedValue(owner.id);

    const markup = renderToStaticMarkup(
      await HomePage({
        searchParams: Promise.resolve({
          requestId: request.id,
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
    expect(markup).toContain("Settlement note: Payload note line one.\n\nPayload note line two.\n\nPayload note line three.");
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });

  it("renders trimmed post-ack payload settlement note without mixed tab-only and space-tab trailing whitespace-only lines after repeated internal blank-line segments and ignores redirect fallback note", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-owner-post-ack-repeated-multiline-mixed-trailing-whitespace-lines-note-precedence@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-admin-post-ack-repeated-multiline-mixed-trailing-whitespace-lines-note-precedence@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Payload note line one.\n\nPayload note line two.\n\nPayload note line three.\n\t\t\n \t  \n\t \t\r\n",
        createdAt: new Date("2026-03-10T06:50:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:55:00.000Z"),
      },
    });

    mockedResolvePageSessionUserId.mockResolvedValue(owner.id);

    const markup = renderToStaticMarkup(
      await HomePage({
        searchParams: Promise.resolve({
          requestId: request.id,
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
    expect(markup).toContain("Settlement note: Payload note line one.\n\nPayload note line two.\n\nPayload note line three.");
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });

  it("renders trimmed post-ack payload settlement note without mixed carriage-return trailing whitespace-only line variants after repeated internal blank-line segments and ignores redirect fallback note", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-owner-post-ack-repeated-multiline-mixed-carriage-return-trailing-whitespace-lines-note-precedence@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-admin-post-ack-repeated-multiline-mixed-carriage-return-trailing-whitespace-lines-note-precedence@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Payload note line one.\n\nPayload note line two.\n\nPayload note line three.\n\r \r\t\r\r\n\t \r\n",
        createdAt: new Date("2026-03-10T06:50:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:55:00.000Z"),
      },
    });

    mockedResolvePageSessionUserId.mockResolvedValue(owner.id);

    const markup = renderToStaticMarkup(
      await HomePage({
        searchParams: Promise.resolve({
          requestId: request.id,
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
    expect(markup).toContain("Settlement note: Payload note line one.\n\nPayload note line two.\n\nPayload note line three.");
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });

  it("renders trimmed post-ack payload settlement note without carriage-return-only terminal trailing whitespace tails and ignores redirect fallback note", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-owner-post-ack-repeated-multiline-carriage-return-terminal-tail-note-precedence@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-admin-post-ack-repeated-multiline-carriage-return-terminal-tail-note-precedence@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Payload note line one.\n\nPayload note line two.\n\nPayload note line three.\n\r \r\t\r\r",
        createdAt: new Date("2026-03-10T06:50:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:55:00.000Z"),
      },
    });

    mockedResolvePageSessionUserId.mockResolvedValue(owner.id);

    const markup = renderToStaticMarkup(
      await HomePage({
        searchParams: Promise.resolve({
          requestId: request.id,
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
    expect(markup).toContain("Settlement note: Payload note line one.\n\nPayload note line two.\n\nPayload note line three.");
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });

  it("renders trimmed post-ack payload settlement note without multi-line carriage-return-only terminal trailing whitespace tails and ignores redirect fallback note", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-owner-post-ack-repeated-multiline-multi-line-carriage-return-terminal-tail-note-precedence@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-admin-post-ack-repeated-multiline-multi-line-carriage-return-terminal-tail-note-precedence@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Payload note line one.\n\nPayload note line two.\n\nPayload note line three.\n\r \r\t\r\r\n\r\t \r\r\n\r \r\t\r\r",
        createdAt: new Date("2026-03-10T06:50:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:55:00.000Z"),
      },
    });

    mockedResolvePageSessionUserId.mockResolvedValue(owner.id);

    const markup = renderToStaticMarkup(
      await HomePage({
        searchParams: Promise.resolve({
          requestId: request.id,
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
    expect(markup).toContain("Settlement note: Payload note line one.\n\nPayload note line two.\n\nPayload note line three.");
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });

  it("renders trimmed post-ack payload settlement note without multi-line carriage-return-only terminal whitespace clusters and ignores redirect fallback note", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-owner-post-ack-repeated-multiline-carriage-return-terminal-whitespace-cluster-note-precedence@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-admin-post-ack-repeated-multiline-carriage-return-terminal-whitespace-cluster-note-precedence@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Payload note line one.\n\nPayload note line two.\n\nPayload note line three.\n\r\r \r\t\r\r\r\n\r\r\t \r\r\r\n\r \r\t\r\r\r",
        createdAt: new Date("2026-03-10T06:50:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:55:00.000Z"),
      },
    });

    mockedResolvePageSessionUserId.mockResolvedValue(owner.id);

    const markup = renderToStaticMarkup(
      await HomePage({
        searchParams: Promise.resolve({
          requestId: request.id,
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
    expect(markup).toContain("Settlement note: Payload note line one.\n\nPayload note line two.\n\nPayload note line three.");
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });

  it("renders trimmed post-ack payload settlement note without terminal carriage-return whitespace clusters split by tab-only separator lines and ignores redirect fallback note", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-owner-post-ack-repeated-multiline-carriage-return-terminal-whitespace-cluster-tab-separator-note-precedence@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-admin-post-ack-repeated-multiline-carriage-return-terminal-whitespace-cluster-tab-separator-note-precedence@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Payload note line one.\n\nPayload note line two.\n\nPayload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n\r\r\t \r\r\r\n\t\n\r \r\t\r\r\r",
        createdAt: new Date("2026-03-10T06:50:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:55:00.000Z"),
      },
    });

    mockedResolvePageSessionUserId.mockResolvedValue(owner.id);

    const markup = renderToStaticMarkup(
      await HomePage({
        searchParams: Promise.resolve({
          requestId: request.id,
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
    expect(markup).toContain("Settlement note: Payload note line one.\n\nPayload note line two.\n\nPayload note line three.");
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });

  it("renders trimmed post-ack payload settlement note without terminal carriage-return whitespace clusters split by tab-only separator lines interleaved with space-only separator lines and ignores redirect fallback note", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-owner-post-ack-repeated-multiline-carriage-return-terminal-whitespace-cluster-tab-space-separator-note-precedence@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-admin-post-ack-repeated-multiline-carriage-return-terminal-whitespace-cluster-tab-space-separator-note-precedence@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Payload note line one.\n\nPayload note line two.\n\nPayload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n    \n\r \r\t\r\r\r",
        createdAt: new Date("2026-03-10T06:50:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:55:00.000Z"),
      },
    });

    mockedResolvePageSessionUserId.mockResolvedValue(owner.id);

    const markup = renderToStaticMarkup(
      await HomePage({
        searchParams: Promise.resolve({
          requestId: request.id,
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
    expect(markup).toContain("Settlement note: Payload note line one.\n\nPayload note line two.\n\nPayload note line three.");
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });

  it("renders trimmed post-ack payload settlement note without terminal carriage-return whitespace clusters split by tab-only separators interleaved with mixed-width space-only separators plus trailing tab-only separators and ignores redirect fallback note", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-owner-post-ack-repeated-multiline-carriage-return-terminal-whitespace-cluster-tab-mixed-space-trailing-tab-separator-note-precedence@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-admin-post-ack-repeated-multiline-carriage-return-terminal-whitespace-cluster-tab-mixed-space-trailing-tab-separator-note-precedence@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Payload note line one.\n\nPayload note line two.\n\nPayload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t",
        createdAt: new Date("2026-03-10T06:50:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:55:00.000Z"),
      },
    });

    mockedResolvePageSessionUserId.mockResolvedValue(owner.id);

    const markup = renderToStaticMarkup(
      await HomePage({
        searchParams: Promise.resolve({
          requestId: request.id,
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
    expect(markup).toContain("Settlement note: Payload note line one.\n\nPayload note line two.\n\nPayload note line three.");
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });

  it("renders trimmed post-ack payload settlement note without terminal carriage-return whitespace clusters split by tab-only separators interleaved with mixed-width space-only separator lines and repeated trailing tab-only separator lines and ignores redirect fallback note", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-owner-post-ack-repeated-multiline-carriage-return-terminal-whitespace-cluster-tab-mixed-space-repeated-trailing-tab-separator-note-precedence@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-admin-post-ack-repeated-multiline-carriage-return-terminal-whitespace-cluster-tab-mixed-space-repeated-trailing-tab-separator-note-precedence@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Payload note line one.\n\nPayload note line two.\n\nPayload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t",
        createdAt: new Date("2026-03-10T06:50:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:55:00.000Z"),
      },
    });

    mockedResolvePageSessionUserId.mockResolvedValue(owner.id);

    const markup = renderToStaticMarkup(
      await HomePage({
        searchParams: Promise.resolve({
          requestId: request.id,
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
    expect(markup).toContain("Settlement note: Payload note line one.\n\nPayload note line two.\n\nPayload note line three.");
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });

  it("renders trimmed post-ack payload settlement note without terminal carriage-return whitespace clusters split by tab-only separators interleaved with mixed-width space-only separator lines, repeated trailing tab-only separator lines, and trailing mixed-width space-only separator lines and ignores redirect fallback note", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-owner-post-ack-repeated-multiline-carriage-return-terminal-whitespace-cluster-tab-mixed-space-trailing-mixed-space-separator-note-precedence@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-admin-post-ack-repeated-multiline-carriage-return-terminal-whitespace-cluster-tab-mixed-space-trailing-mixed-space-separator-note-precedence@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Payload note line one.\n\nPayload note line two.\n\nPayload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   ",
        createdAt: new Date("2026-03-10T06:50:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:55:00.000Z"),
      },
    });

    mockedResolvePageSessionUserId.mockResolvedValue(owner.id);

    const markup = renderToStaticMarkup(
      await HomePage({
        searchParams: Promise.resolve({
          requestId: request.id,
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
    expect(markup).toContain("Settlement note: Payload note line one.\n\nPayload note line two.\n\nPayload note line three.");
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });

  it("renders trimmed post-ack payload settlement note without terminal carriage-return whitespace clusters split by tab-only separators interleaved with mixed-width space-only separator lines, repeated trailing tab-only separator lines, trailing mixed-width space-only separator lines, and repeated trailing mixed-width space-only separator lines and ignores redirect fallback note", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-owner-post-ack-repeated-multiline-carriage-return-terminal-whitespace-cluster-tab-mixed-space-repeated-trailing-mixed-space-separator-note-precedence@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-admin-post-ack-repeated-multiline-carriage-return-terminal-whitespace-cluster-tab-mixed-space-repeated-trailing-mixed-space-separator-note-precedence@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Payload note line one.\n\nPayload note line two.\n\nPayload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n \t  \n     ",
        createdAt: new Date("2026-03-10T06:50:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:55:00.000Z"),
      },
    });

    mockedResolvePageSessionUserId.mockResolvedValue(owner.id);

    const markup = renderToStaticMarkup(
      await HomePage({
        searchParams: Promise.resolve({
          requestId: request.id,
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
    expect(markup).toContain("Settlement note: Payload note line one.\n\nPayload note line two.\n\nPayload note line three.");
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });

  it("renders trimmed post-ack payload settlement note without terminal carriage-return whitespace clusters split by tab-only separators interleaved with mixed-width space-only separator lines, repeated trailing tab-only separator lines, and repeated trailing mixed-width space-only separator lines spanning three terminal lines and ignores redirect fallback note", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-owner-post-ack-repeated-multiline-carriage-return-terminal-whitespace-cluster-tab-mixed-space-three-line-trailing-mixed-space-separator-note-precedence@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-admin-post-ack-repeated-multiline-carriage-return-terminal-whitespace-cluster-tab-mixed-space-three-line-trailing-mixed-space-separator-note-precedence@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "\n\t  Payload note line one.\n\nPayload note line two.\n\nPayload note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       ",
        createdAt: new Date("2026-03-10T06:50:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T06:55:00.000Z"),
      },
    });

    mockedResolvePageSessionUserId.mockResolvedValue(owner.id);

    const markup = renderToStaticMarkup(
      await HomePage({
        searchParams: Promise.resolve({
          requestId: request.id,
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
    expect(markup).toContain("Settlement note: Payload note line one.\n\nPayload note line two.\n\nPayload note line three.");
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });

  it("renders settled checkout actor-id fallback metadata from redirect params when status payload omits actor-id context", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-owner-post-checkout-fallback-actor-id@example.com",
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

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "REPORT_READY",
        toStatus: "PAYMENT_PENDING",
        note: "Owner initiated report-fee checkout.",
        createdAt: new Date("2026-03-10T05:15:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        note: "Payment settled by admin.",
        createdAt: new Date("2026-03-10T05:30:00.000Z"),
      },
    });

    mockedResolvePageSessionUserId.mockResolvedValue(owner.id);

    const markup = renderToStaticMarkup(
      await HomePage({
        searchParams: Promise.resolve({
          requestId: request.id,
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
        email: "timeline-owner-post-checkout-fallback-actor-role@example.com",
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

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "REPORT_READY",
        toStatus: "PAYMENT_PENDING",
        note: "Owner initiated report-fee checkout.",
        createdAt: new Date("2026-03-10T05:15:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        note: "Payment settled by admin.",
        createdAt: new Date("2026-03-10T05:30:00.000Z"),
      },
    });

    mockedResolvePageSessionUserId.mockResolvedValue(owner.id);

    const markup = renderToStaticMarkup(
      await HomePage({
        searchParams: Promise.resolve({
          requestId: request.id,
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
        email: "timeline-owner-post-checkout-fallback-actor-email@example.com",
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

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "REPORT_READY",
        toStatus: "PAYMENT_PENDING",
        note: "Owner initiated report-fee checkout.",
        createdAt: new Date("2026-03-10T05:15:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        note: "Payment settled by admin.",
        createdAt: new Date("2026-03-10T05:30:00.000Z"),
      },
    });

    mockedResolvePageSessionUserId.mockResolvedValue(owner.id);

    const markup = renderToStaticMarkup(
      await HomePage({
        searchParams: Promise.resolve({
          requestId: request.id,
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
        email: "timeline-owner-post-checkout-fallback-event-id@example.com",
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

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "REPORT_READY",
        toStatus: "PAYMENT_PENDING",
        note: "Owner initiated report-fee checkout.",
        createdAt: new Date("2026-03-10T05:15:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        note: "Payment settled by admin.",
        createdAt: new Date("2026-03-10T05:30:00.000Z"),
      },
    });

    mockedResolvePageSessionUserId.mockResolvedValue(owner.id);

    const markup = renderToStaticMarkup(
      await HomePage({
        searchParams: Promise.resolve({
          requestId: request.id,
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
        email: "timeline-owner-post-checkout-fallback-note@example.com",
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

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "REPORT_READY",
        toStatus: "PAYMENT_PENDING",
        note: "Owner initiated report-fee checkout.",
        createdAt: new Date("2026-03-10T05:15:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        createdAt: new Date("2026-03-10T05:30:00.000Z"),
      },
    });

    mockedResolvePageSessionUserId.mockResolvedValue(owner.id);

    const markup = renderToStaticMarkup(
      await HomePage({
        searchParams: Promise.resolve({
          requestId: request.id,
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
        email: "timeline-owner-post-checkout-fallback-settled-at@example.com",
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

    const markup = renderToStaticMarkup(
      await HomePage({
        searchParams: Promise.resolve({
          requestId: request.id,
          checkout: "1",
          settledAt: "2026-03-10T05:35:00.000Z",
        }),
      }),
    );

    expect(markup).toContain("Checkout already settled at 2026-03-10T05:35:00.000Z.");
  });

  it("prefers status payload settled timestamp over redirect fallback on post-checkout confirmation", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-owner-post-checkout-precedence-settled-at@example.com",
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

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        note: "Payment settled by admin.",
        createdAt: new Date("2026-03-10T05:30:00.000Z"),
      },
    });

    mockedResolvePageSessionUserId.mockResolvedValue(owner.id);

    const markup = renderToStaticMarkup(
      await HomePage({
        searchParams: Promise.resolve({
          requestId: request.id,
          checkout: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
        }),
      }),
    );

    expect(markup).toContain("Checkout already settled at 2026-03-10T05:30:00.000Z.");
    expect(markup).not.toContain("Checkout already settled at 1999-01-01T00:00:00.000Z.");
  });

  it("prefers status payload settled actor-id over redirect fallback on post-checkout confirmation", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-owner-post-checkout-precedence-actor-id@example.com",
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

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "Payment settled by owner.",
        createdAt: new Date("2026-03-10T05:30:00.000Z"),
      },
    });

    mockedResolvePageSessionUserId.mockResolvedValue(owner.id);

    const markup = renderToStaticMarkup(
      await HomePage({
        searchParams: Promise.resolve({
          requestId: request.id,
          checkout: "1",
          settledByUserId: "redirect-fallback-user-id",
        }),
      }),
    );

    expect(markup).toContain("Checkout already settled at 2026-03-10T05:30:00.000Z.");
    expect(markup).toContain(`Settlement actor id: ${owner.id}.`);
    expect(markup).not.toContain("Settlement actor id: redirect-fallback-user-id.");
  });

  it("prefers status payload settled actor-role over redirect fallback on post-checkout confirmation", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-owner-post-checkout-precedence-role@example.com",
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

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "Payment settled by owner.",
        createdAt: new Date("2026-03-10T05:30:00.000Z"),
      },
    });

    mockedResolvePageSessionUserId.mockResolvedValue(owner.id);

    const markup = renderToStaticMarkup(
      await HomePage({
        searchParams: Promise.resolve({
          requestId: request.id,
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

  it("prefers status payload settled actor-email over redirect fallback on post-checkout confirmation", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-owner-post-checkout-precedence-actor-email@example.com",
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

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "Payment settled by owner.",
        createdAt: new Date("2026-03-10T05:30:00.000Z"),
      },
    });

    mockedResolvePageSessionUserId.mockResolvedValue(owner.id);

    const markup = renderToStaticMarkup(
      await HomePage({
        searchParams: Promise.resolve({
          requestId: request.id,
          checkout: "1",
          settledByUserEmail: "redirect-fallback@example.com",
        }),
      }),
    );

    expect(markup).toContain("Checkout already settled at 2026-03-10T05:30:00.000Z.");
    expect(markup).toContain(`Settlement actor email: ${owner.email}.`);
    expect(markup).not.toContain("Settlement actor email: redirect-fallback@example.com.");
  });

  it("keeps post-checkout actor role/id/email coherent from status payload over mixed redirect fallback metadata", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-owner-post-checkout-coherent-actor-metadata@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-admin-post-checkout-coherent-actor-metadata@example.com",
        passwordHash: "hash",
        role: "ADMIN",
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

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "Payment settled by admin.",
        createdAt: new Date("2026-03-10T05:30:00.000Z"),
      },
    });

    mockedResolvePageSessionUserId.mockResolvedValue(owner.id);

    const markup = renderToStaticMarkup(
      await HomePage({
        searchParams: Promise.resolve({
          requestId: request.id,
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

  it("omits redirect fallback actor role/id/email when actorless status payload is paired with incomplete redirect actor metadata", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-owner-post-checkout-actorless-incomplete-redirect-fallback@example.com",
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

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        note: "Settlement evidence without actor identity.",
        createdAt: new Date("2026-03-10T05:30:00.000Z"),
      },
    });

    mockedResolvePageSessionUserId.mockResolvedValue(owner.id);

    const markup = renderToStaticMarkup(
      await HomePage({
        searchParams: Promise.resolve({
          requestId: request.id,
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

  it("renders redirect fallback actor role/id/email when actorless status payload is paired with a complete redirect actor trio", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-owner-post-checkout-actorless-complete-redirect-fallback@example.com",
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

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        note: "Settlement evidence without actor identity.",
        createdAt: new Date("2026-03-10T05:30:00.000Z"),
      },
    });

    mockedResolvePageSessionUserId.mockResolvedValue(owner.id);

    const markup = renderToStaticMarkup(
      await HomePage({
        searchParams: Promise.resolve({
          requestId: request.id,
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

  it("prefers status payload settlement event-id over redirect fallback on post-checkout confirmation", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-owner-post-checkout-precedence-event-id@example.com",
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

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        note: "Payment settled by admin.",
        createdAt: new Date("2026-03-10T05:30:00.000Z"),
      },
    });

    const settlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: {
        sourcingRequestId: request.id,
        toStatus: "PAYMENT_SETTLED",
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    mockedResolvePageSessionUserId.mockResolvedValue(owner.id);

    const markup = renderToStaticMarkup(
      await HomePage({
        searchParams: Promise.resolve({
          requestId: request.id,
          checkout: "1",
          settlementEventId: "redirect-fallback-event-id",
        }),
      }),
    );

    expect(markup).toContain("Checkout already settled at 2026-03-10T05:30:00.000Z.");
    expect(markup).toContain(`Settlement evidence token: ${settlementEvent?.id}.`);
    expect(markup).not.toContain("Settlement evidence token: redirect-fallback-event-id.");
  });

  it("prefers status payload settlement note over redirect fallback on post-checkout confirmation", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-owner-post-checkout-precedence-note@example.com",
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

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        note: "Status payload settlement note",
        createdAt: new Date("2026-03-10T05:30:00.000Z"),
      },
    });

    mockedResolvePageSessionUserId.mockResolvedValue(owner.id);

    const markup = renderToStaticMarkup(
      await HomePage({
        searchParams: Promise.resolve({
          requestId: request.id,
          checkout: "1",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Checkout already settled at 2026-03-10T05:30:00.000Z.");
    expect(markup).toContain("Settlement note: Status payload settlement note.");
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
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
