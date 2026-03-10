import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SESSION_COOKIE_NAME, hashToken } from "@/server/auth";
import { prisma } from "@/server/db";
import { cookies } from "next/headers";
import { sortFilterGroupsByDisplayOrder } from "../../app/admin/sourcing-requests/filter-groups";
import AdminSourcingQueuePage from "../../app/admin/sourcing-requests/page";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

const mockedCookies = vi.mocked(cookies);

type MockCookieStore = {
  getAll: () => Array<{ name: string; value: string }>;
};

describe("Admin sourcing queue page", () => {
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

  async function seedAdminQueue(
    status: "SUBMITTED" | "IN_REVIEW" | "PAYMENT_PENDING" | "PAYMENT_SETTLED" = "IN_REVIEW",
  ) {
    const admin = await prisma.user.create({
      data: {
        email: "admin-queue-page@example.com",
        passwordHash: "hash",
        role: "ADMIN",
      },
    });

    const owner = await prisma.user.create({
      data: {
        email: "owner-queue-page@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: {
          countryCode: "NL",
          leftEye: { sphere: -1.5 },
          rightEye: { sphere: -1.25 },
          pupillaryDistance: 62,
        },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status,
        reportPaymentRequired: false,
        currency: "EUR",
      },
    });

    if (status === "IN_REVIEW") {
      await prisma.sourcingStatusEvent.create({
        data: {
          sourcingRequestId: request.id,
          fromStatus: "SUBMITTED",
          toStatus: "IN_REVIEW",
          note: "Admin triage",
          actorUserId: admin.id,
        },
      });
    }

    if (status === "PAYMENT_SETTLED") {
      await prisma.sourcingStatusEvent.create({
        data: {
          sourcingRequestId: request.id,
          fromStatus: "PAYMENT_PENDING",
          toStatus: "PAYMENT_SETTLED",
          note: "Payment settled",
          actorUserId: admin.id,
        },
      });
    }

    return { admin, owner, request };
  }

  it("renders API-backed queue cards with filter-bound detail navigation", async () => {
    const { admin, request } = await seedAdminQueue();
    const adminCookie = await issueSessionCookie(admin.id);
    mockCookieHeader(adminCookie);

    const markup = renderToStaticMarkup(
      await AdminSourcingQueuePage({
        searchParams: Promise.resolve({
          status: "IN_REVIEW",
          countryCode: "nl",
        }),
      }),
    );

    expect(markup).toContain("Admin sourcing queue");
    expect(markup).toContain(`Request ${request.id}`);
    expect(markup).toContain("data-status-tone=\"WARNING\"");
    expect(markup).toContain("In review");
    expect(markup).toContain("owner-queue-page@example.com");
    expect(markup).toContain("requestId=");
    expect(markup).toContain("Open request detail");
    expect(markup).toContain("Filter guidance (active group:");
    expect(markup).toContain("Triage queue");
    expect(markup).toContain("Settlement evidence queue");
    expect(markup).toContain("Submitted and in-review requests awaiting admin triage decisions.");
    expect(markup).toContain("Settled and delivered requests with payment-settlement evidence attached.");
    expect(markup).toContain("Submitted + In review");
    expect(markup).toContain("Payment settled + Delivered");
    expect(markup).toContain("optgroup");
    expect(markup).toContain("label=\"Triage queue\"");
    expect(markup).toContain("label=\"Settlement evidence queue\"");
    expect(markup).toContain("Selected status tone:");
    expect(markup).toContain("Warning tone: prioritize active review and follow-up actions.");
    expect(markup).toContain(
      "Transition hint: Admin triage in progress; prepare report artifact inputs.",
    );
    expect(markup).toContain("Next action: Upload report artifact");
    expect(markup.indexOf("label=\"Triage queue\"")).toBeLessThan(
      markup.indexOf("label=\"Settlement evidence queue\""),
    );
  });

  it("sorts queue filter groups by API displayOrder with stable fallback", () => {
    const sorted = sortFilterGroupsByDisplayOrder([
      {
        key: "SETTLED",
        displayOrder: 30,
        label: "Settlement evidence queue",
        description: "settled",
        statuses: ["PAYMENT_SETTLED", "DELIVERED"],
      },
      {
        key: "TRIAGE",
        displayOrder: 10,
        label: "Triage queue",
        description: "triage",
        statuses: ["SUBMITTED", "IN_REVIEW"],
      },
      {
        key: "TRIAGE",
        displayOrder: undefined,
        label: "Fallback queue",
        description: "no order",
        statuses: ["SUBMITTED", "IN_REVIEW"],
      },
    ]);

    expect(sorted.map((group) => group.label)).toEqual([
      "Triage queue",
      "Settlement evidence queue",
      "Fallback queue",
    ]);
  });

  it("renders request detail timeline via admin queue detail contract", async () => {
    const { admin, request } = await seedAdminQueue();
    const adminCookie = await issueSessionCookie(admin.id);
    mockCookieHeader(adminCookie);

    const markup = renderToStaticMarkup(
      await AdminSourcingQueuePage({
        searchParams: Promise.resolve({
          requestId: request.id,
        }),
      }),
    );

    expect(markup).toContain("Request detail");
    expect(markup).toContain(`Request ${request.id} (IN_REVIEW)`);
    expect(markup).toContain("SUBMITTED -&gt; IN_REVIEW");
    expect(markup).toContain("Next action: Upload report artifact");
    expect(markup).toContain("No report artifacts attached.");
  });

  it("loads selected report template on admin request detail", async () => {
    const { admin, request } = await seedAdminQueue("IN_REVIEW");
    const adminCookie = await issueSessionCookie(admin.id);
    mockCookieHeader(adminCookie);

    const markup = renderToStaticMarkup(
      await AdminSourcingQueuePage({
        searchParams: Promise.resolve({
          requestId: request.id,
          templateId: "QUALITY_RISK_ASSESSMENT",
        }),
      }),
    );

    expect(markup).toContain("Report template library");
    expect(markup).toContain("Loaded template: Quality risk assessment");
    expect(markup).toContain("Quality checks:");
    expect(markup).toContain("Risk matrix:");
    expect(markup).toContain("templateId=QUALITY_RISK_ASSESSMENT");
    expect(markup).toContain("Save template draft");
    expect(markup).toContain("No saved draft yet.");
    expect(markup).toContain(
      `action=\"/api/v1/admin/sourcing-requests/${request.id}/report-template-drafts\"`,
    );
  });

  it("loads the latest persisted template draft for selected template", async () => {
    const { admin, request } = await seedAdminQueue("IN_REVIEW");
    const adminCookie = await issueSessionCookie(admin.id);
    mockCookieHeader(adminCookie);

    await prisma.auditEvent.create({
      data: {
        actorUserId: admin.id,
        sourcingRequestId: request.id,
        entityType: "SourcingRequest",
        entityId: request.id,
        action: "ADMIN_REPORT_TEMPLATE_DRAFT_SAVED",
        context: {
          templateId: "QUALITY_RISK_ASSESSMENT",
          templateBody: "Saved draft body from prior edit.",
        },
      },
    });

    const markup = renderToStaticMarkup(
      await AdminSourcingQueuePage({
        searchParams: Promise.resolve({
          requestId: request.id,
          templateId: "QUALITY_RISK_ASSESSMENT",
        }),
      }),
    );

    expect(markup).toContain("Loaded template: Quality risk assessment");
    expect(markup).toContain("Saved draft body from prior edit.");
    expect(markup).toContain("Saved draft loaded");
  });

  it("loads draft by selected template even when another template was saved later", async () => {
    const { admin, request } = await seedAdminQueue("IN_REVIEW");
    const adminCookie = await issueSessionCookie(admin.id);
    mockCookieHeader(adminCookie);

    await prisma.auditEvent.createMany({
      data: [
        {
          actorUserId: admin.id,
          sourcingRequestId: request.id,
          entityType: "SourcingRequest",
          entityId: request.id,
          action: "ADMIN_REPORT_TEMPLATE_DRAFT_SAVED",
          context: {
            templateId: "QUALITY_RISK_ASSESSMENT",
            templateBody: "Quality-specific draft body.",
          },
        },
        {
          actorUserId: admin.id,
          sourcingRequestId: request.id,
          entityType: "SourcingRequest",
          entityId: request.id,
          action: "ADMIN_REPORT_TEMPLATE_DRAFT_SAVED",
          context: {
            templateId: "DELIVERY_READINESS",
            templateBody: "Most recent draft for delivery template.",
          },
        },
      ],
    });

    const markup = renderToStaticMarkup(
      await AdminSourcingQueuePage({
        searchParams: Promise.resolve({
          requestId: request.id,
          templateId: "QUALITY_RISK_ASSESSMENT",
        }),
      }),
    );

    expect(markup).toContain("Loaded template: Quality risk assessment");
    expect(markup).toContain("Quality-specific draft body.");
    expect(markup).not.toContain("Most recent draft for delivery template.");
  });

  it("renders review action form for submitted detail requests", async () => {
    const { admin, request } = await seedAdminQueue("SUBMITTED");
    const adminCookie = await issueSessionCookie(admin.id);
    mockCookieHeader(adminCookie);

    const markup = renderToStaticMarkup(
      await AdminSourcingQueuePage({
        searchParams: Promise.resolve({
          requestId: request.id,
          status: "SUBMITTED",
        }),
      }),
    );

    expect(markup).toContain("Review action");
    expect(markup).toContain(`action=\"/api/v1/admin/sourcing-requests/${request.id}/status\"`);
    expect(markup).toContain("name=\"toStatus\"");
    expect(markup).toContain("value=\"IN_REVIEW\"");
    expect(markup).toContain("Mark in review");
  });

  it("renders report-fee settlement form for payment-pending requests", async () => {
    const { admin, request } = await seedAdminQueue("PAYMENT_PENDING");
    const adminCookie = await issueSessionCookie(admin.id);
    mockCookieHeader(adminCookie);

    const markup = renderToStaticMarkup(
      await AdminSourcingQueuePage({
        searchParams: Promise.resolve({
          requestId: request.id,
        }),
      }),
    );

    expect(markup).toContain("Report-fee settlement");
    expect(markup).toContain("Mark payment settled");
    expect(markup).toContain(
      `action=\"/api/v1/admin/sourcing-requests/${request.id}/report-fee/settle\"`,
    );
    expect(markup).toContain("name=\"redirectTo\"");
  });

  it("renders settlement metadata on queue cards for settled status filters", async () => {
    const { admin, request } = await seedAdminQueue("PAYMENT_SETTLED");
    const adminCookie = await issueSessionCookie(admin.id);
    mockCookieHeader(adminCookie);

    const markup = renderToStaticMarkup(
      await AdminSourcingQueuePage({
        searchParams: Promise.resolve({
          status: "PAYMENT_SETTLED",
        }),
      }),
    );

    expect(markup).toContain(`Request ${request.id}`);
    expect(markup).toContain("data-status-tone=\"SUCCESS\"");
    expect(markup).toContain("Payment settled");
    expect(markup).toContain(
      "Transition hint: Settlement evidence confirmed; delivery acknowledgment can proceed.",
    );
    expect(markup).toContain(`Settled by: ${admin.id}`);
    expect(markup).toContain("Settled at:");
    expect(markup).not.toContain("Settled at: N/A");
    expect(markup).toContain("active group: <strong>Settlement evidence queue</strong>");
  });

  it("renders settlement success banner with settlement metadata when redirected with settled marker", async () => {
    const { admin, request } = await seedAdminQueue("PAYMENT_PENDING");
    const adminCookie = await issueSessionCookie(admin.id);
    mockCookieHeader(adminCookie);

    const markup = renderToStaticMarkup(
      await AdminSourcingQueuePage({
        searchParams: Promise.resolve({
          requestId: request.id,
          settled: "1",
          settledBy: admin.id,
          settledAt: "2026-03-08T16:41:22.000Z",
        }),
      }),
    );

    expect(markup).toContain("Report-fee settlement recorded successfully.");
    expect(markup).toContain(`Settled by: ${admin.id}`);
    expect(markup).toContain("Settled at: 2026-03-08T16:41:22.000Z");
  });

  it("renders settlement success fallback metadata from detail payload when redirect omits actor/timestamp", async () => {
    const { admin, request } = await seedAdminQueue("PAYMENT_SETTLED");
    const adminCookie = await issueSessionCookie(admin.id);
    mockCookieHeader(adminCookie);

    const markup = renderToStaticMarkup(
      await AdminSourcingQueuePage({
        searchParams: Promise.resolve({
          requestId: request.id,
          settled: "1",
        }),
      }),
    );

    expect(markup).toContain("Report-fee settlement recorded successfully.");
    expect(markup).toContain(`Settled by: ${admin.id}`);
    expect(markup).toContain("Settled at: ");
    expect(markup).not.toContain("Settled at: N/A");
  });

  it("shows admin access required message for non-admin session", async () => {
    const user = await prisma.user.create({
      data: {
        email: "user-no-admin@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });

    const userCookie = await issueSessionCookie(user.id);
    mockCookieHeader(userCookie);

    const markup = renderToStaticMarkup(await AdminSourcingQueuePage({}));

    expect(markup).toContain("Admin access required");
    expect(markup).toContain("Admin access required.");
  });

  it("renders SLA snapshot metrics for current queue scope", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-07T12:00:00.000Z"));
    try {
      const admin = await prisma.user.create({
        data: {
          email: "admin-sla-page@example.com",
          passwordHash: "hash",
          role: "ADMIN",
        },
      });

      const owner = await prisma.user.create({
        data: {
          email: "owner-sla-page@example.com",
          passwordHash: "hash",
          role: "USER",
        },
      });

      const prescription = await prisma.prescription.create({
        data: {
          userId: owner.id,
          countryCode: "DE",
          payload: {
            countryCode: "DE",
            leftEye: { sphere: -1.5 },
            rightEye: { sphere: -1.25 },
            pupillaryDistance: 62,
          },
        },
      });

      await prisma.sourcingRequest.create({
        data: {
          userId: owner.id,
          prescriptionId: prescription.id,
          status: "SUBMITTED",
          reportPaymentRequired: false,
          currency: "EUR",
          createdAt: new Date("2026-03-07T10:00:00.000Z"),
        },
      });

      const inReviewRequest = await prisma.sourcingRequest.create({
        data: {
          userId: owner.id,
          prescriptionId: prescription.id,
          status: "IN_REVIEW",
          reportPaymentRequired: false,
          currency: "EUR",
          createdAt: new Date("2026-03-07T08:00:00.000Z"),
        },
      });

      await prisma.sourcingStatusEvent.create({
        data: {
          sourcingRequestId: inReviewRequest.id,
          fromStatus: "SUBMITTED",
          toStatus: "IN_REVIEW",
          note: "Triage started",
          actorUserId: admin.id,
          createdAt: new Date("2026-03-07T10:30:00.000Z"),
        },
      });

      const reportReadyRequest = await prisma.sourcingRequest.create({
        data: {
          userId: owner.id,
          prescriptionId: prescription.id,
          status: "REPORT_READY",
          reportPaymentRequired: false,
          currency: "EUR",
          createdAt: new Date("2026-03-06T10:00:00.000Z"),
        },
      });

      await prisma.sourcingStatusEvent.create({
        data: {
          sourcingRequestId: reportReadyRequest.id,
          fromStatus: "IN_REVIEW",
          toStatus: "REPORT_READY",
          note: "Report ready",
          actorUserId: admin.id,
          createdAt: new Date("2026-03-06T20:00:00.000Z"),
        },
      });

      const deliveredRequest = await prisma.sourcingRequest.create({
        data: {
          userId: owner.id,
          prescriptionId: prescription.id,
          status: "DELIVERED",
          reportPaymentRequired: false,
          currency: "EUR",
          createdAt: new Date("2026-03-05T12:00:00.000Z"),
        },
      });

      await prisma.sourcingStatusEvent.create({
        data: {
          sourcingRequestId: deliveredRequest.id,
          fromStatus: "IN_REVIEW",
          toStatus: "REPORT_READY",
          note: "Report ready",
          actorUserId: admin.id,
          createdAt: new Date("2026-03-06T00:00:00.000Z"),
        },
      });

      await prisma.reportArtifact.create({
        data: {
          sourcingRequestId: deliveredRequest.id,
          createdByAdminId: admin.id,
          storageKey: "reports/delivered.pdf",
          checksumSha256: "abc123",
          deliveryChannel: "EMAIL_LINK",
          deliveredAt: new Date("2026-03-06T12:00:00.000Z"),
        },
      });

      const adminCookie = await issueSessionCookie(admin.id);
      mockCookieHeader(adminCookie);

      const markup = renderToStaticMarkup(await AdminSourcingQueuePage({}));

      expect(markup).toContain("SLA snapshot");
      expect(markup).toContain("Total queue items: 2");
      expect(markup).toContain("Submitted: 1");
      expect(markup).toContain("In review: 1");
      expect(markup).toContain("Average queue age: 3.0h");
      expect(markup).toContain("Oldest queue age: 4.0h");
      expect(markup).toContain("Average first-review latency: 2.5h");
      expect(markup).toContain("Median submit -&gt; report ready: 11.0h");
      expect(markup).toContain("Median submit -&gt; delivered: 24.0h");
      expect(markup).toContain(
        "Report-ready throughput buckets: &lt;24h 2 | 24-72h 0 | &gt;72h 0",
      );
      expect(markup).toContain(
        "Delivered throughput buckets: &lt;24h 0 | 24-72h 1 | &gt;72h 0",
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
