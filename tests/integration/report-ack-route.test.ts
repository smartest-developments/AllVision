import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { hashToken, SESSION_COOKIE_NAME } from "@/server/auth";
import { prisma } from "@/server/db";
// Top-level helper so all describe blocks in this large file can issue a session cookie
// without redefining the function in each block.
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
import { POST } from "../../app/api/v1/sourcing-requests/[requestId]/report/ack/route";

describe("POST /api/v1/sourcing-requests/:requestId/report/ack", () => {
  beforeEach(async () => {
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
        userAgentHash: null
      }
    });

    return `${SESSION_COOKIE_NAME}=${token}`;
  }

  async function seedReportReadyRequest(options?: {
    status?: "REPORT_READY" | "PAYMENT_SETTLED";
    reportPaymentRequired?: boolean;
  }) {
    const owner = await prisma.user.create({
      data: {
        email: "owner-ack@example.com",
        passwordHash: "hash",
        role: "USER"
      }
    });
    const other = await prisma.user.create({
      data: {
        email: "other-ack@example.com",
        passwordHash: "hash",
        role: "USER"
      }
    });
    const admin = await prisma.user.create({
      data: {
        email: "admin-ack@example.com",
        passwordHash: "hash",
        role: "ADMIN"
      }
    });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: {
          countryCode: "NL",
          leftEye: { sphere: -1.5 },
          rightEye: { sphere: -1.25 },
          pupillaryDistance: 62
        }
      }
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: options?.status ?? "REPORT_READY",
        reportPaymentRequired: options?.reportPaymentRequired ?? false,
        currency: "EUR"
      }
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email"
      }
    });

    if (options?.status === "PAYMENT_SETTLED") {
      await prisma.sourcingStatusEvent.create({
        data: {
          sourcingRequestId: request.id,
          fromStatus: "PAYMENT_PENDING",
          toStatus: "PAYMENT_SETTLED",
          actorUserId: admin.id,
          note: "Settlement recorded by admin.",
          createdAt: new Date("2026-03-10T06:20:00.000Z"),
        },
      });
    }

    return { owner, other, request, admin };
  }

  it("returns 401 when session cookie is missing", async () => {
    const { request } = await seedReportReadyRequest();

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST"
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    const payload = (await response.json()) as { error: { code: string } };
    expect(response.status).toBe(401);
    expect(payload.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 403 when request does not belong to caller", async () => {
    const { other, request } = await seedReportReadyRequest();
    const cookie = await issueSessionCookie(other.id);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie }
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    const payload = (await response.json()) as { error: { code: string } };
    expect(response.status).toBe(403);
    expect(payload.error.code).toBe("FORBIDDEN");
  });

  it("marks report as delivered and writes immutable delivery acknowledgment audit event", async () => {
    const { owner, request } = await seedReportReadyRequest();
    const cookie = await issueSessionCookie(owner.id);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie }
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    const payload = (await response.json()) as {
      requestId: string;
      status: string;
      reportFee: {
        settledByUserEmail: string | null;
      };
    };

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      requestId: request.id,
      status: "DELIVERED",
      reportFee: {
        settledByUserEmail: null,
      },
    });

    const statusEvent = await prisma.sourcingStatusEvent.findFirst({
      where: {
        sourcingRequestId: request.id,
        toStatus: "DELIVERED"
      }
    });
    expect(statusEvent).not.toBeNull();
    expect(statusEvent?.fromStatus).toBe("REPORT_READY");
    expect(statusEvent?.actorUserId).toBe(owner.id);

    const auditEvent = await prisma.auditEvent.findFirst({
      where: {
        sourcingRequestId: request.id,
        action: "REPORT_DELIVERY_ACKNOWLEDGED"
      }
    });
    expect(auditEvent).not.toBeNull();
    expect(auditEvent?.actorUserId).toBe(owner.id);
    expect(auditEvent?.entityType).toBe("SourcingRequest");
    expect(auditEvent?.context).toMatchObject({
      fromStatus: "REPORT_READY",
      toStatus: "DELIVERED"
    });
  });

  it("allows acknowledgment after report-fee settlement", async () => {
    const { owner, request, admin } = await seedReportReadyRequest({
      status: "PAYMENT_SETTLED",
      reportPaymentRequired: true
    });
    const cookie = await issueSessionCookie(owner.id);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie }
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    const payload = (await response.json()) as {
      requestId: string;
      status: string;
      reportFee: {
        settledByUserEmail: string | null;
      };
    };

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      requestId: request.id,
      status: "DELIVERED",
      reportFee: {
        settledByUserEmail: admin.email,
      },
    });

    const statusEvent = await prisma.sourcingStatusEvent.findFirst({
      where: {
        sourcingRequestId: request.id,
        toStatus: "DELIVERED"
      }
    });
    expect(statusEvent?.fromStatus).toBe("PAYMENT_SETTLED");
  });

  it("supports form redirect response for timeline/home acknowledgment flows", async () => {
    const { owner, request } = await seedReportReadyRequest();
    const cookie = await issueSessionCookie(owner.id);

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1`,
    );
  });

  it("appends settlement actor-role, actor-id, actor-email, event-id, and note redirect metadata when settled acknowledgment uses form redirect", async () => {
    const { owner, request, admin } = await seedReportReadyRequest({
      status: "PAYMENT_SETTLED",
      reportPaymentRequired: true,
    });
    const cookie = await issueSessionCookie(owner.id);

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    const settlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: {
        sourcingRequestId: request.id,
        toStatus: "PAYMENT_SETTLED",
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=ADMIN&settledAt=${encodeURIComponent(
        "2026-03-10T06:20:00.000Z",
      )}&settledByUserId=${encodeURIComponent(admin.id)}&settledByUserEmail=${encodeURIComponent(admin.email)}&settlementEventId=${encodeURIComponent(settlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Settlement recorded by admin.")}`,
    );
  });

  it("omits settlement actor redirect params when latest settlement evidence has no actor identity", async () => {
    const { owner, request } = await seedReportReadyRequest({
      status: "PAYMENT_SETTLED",
      reportPaymentRequired: true,
    });
    const cookie = await issueSessionCookie(owner.id);

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: null,
        note: "Settlement evidence without actor identity.",
        createdAt: new Date("2026-03-10T06:40:00.000Z"),
      },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    const settlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: {
        sourcingRequestId: request.id,
        toStatus: "PAYMENT_SETTLED",
        actorUserId: null,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledAt=${encodeURIComponent(
        "2026-03-10T06:40:00.000Z",
      )}&settlementEventId=${encodeURIComponent(settlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Settlement evidence without actor identity.")}`,
    );
  });

  it("uses only the latest settlement event for redirect actor trio metadata and preserves query ordering", async () => {
    const { owner, request, admin } = await seedReportReadyRequest({
      status: "PAYMENT_SETTLED",
      reportPaymentRequired: true,
    });
    const cookie = await issueSessionCookie(owner.id);

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "Older owner settlement evidence.",
        createdAt: new Date("2026-03-10T05:50:00.000Z"),
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "Latest owner settlement evidence.",
        createdAt: new Date("2026-03-10T06:45:00.000Z"),
      },
    });

    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: {
        sourcingRequestId: request.id,
        toStatus: "PAYMENT_SETTLED",
        note: "Latest owner settlement evidence.",
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent(
        "2026-03-10T06:45:00.000Z",
      )}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement evidence.")}`,
    );
    expect(response.headers.get("location")).not.toContain(
      encodeURIComponent(admin.id),
    );
    expect(response.headers.get("location")).not.toContain(
      encodeURIComponent("Settlement recorded by admin."),
    );
  });

  it("keeps actor trio omitted and preserves settledAt/event/note ordering when latest settlement evidence is actorless", async () => {
    const { owner, request, admin } = await seedReportReadyRequest({
      status: "PAYMENT_SETTLED",
      reportPaymentRequired: true,
    });
    const cookie = await issueSessionCookie(owner.id);

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "Older owner settlement evidence.",
        createdAt: new Date("2026-03-10T06:30:00.000Z"),
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: null,
        note: "Latest actorless settlement evidence.",
        createdAt: new Date("2026-03-10T06:55:00.000Z"),
      },
    });

    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: {
        sourcingRequestId: request.id,
        toStatus: "PAYMENT_SETTLED",
        note: "Latest actorless settlement evidence.",
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledAt=${encodeURIComponent(
        "2026-03-10T06:55:00.000Z",
      )}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest actorless settlement evidence.")}`,
    );
    expect(response.headers.get("location")).not.toContain("settledByRole=");
    expect(response.headers.get("location")).not.toContain("settledByUserId=");
    expect(response.headers.get("location")).not.toContain("settledByUserEmail=");
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(owner.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(owner.email));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });

  it("omits settlementNote redirect metadata when latest actorful settlement evidence has a null note", async () => {
    const { owner, request, admin } = await seedReportReadyRequest({
      status: "PAYMENT_SETTLED",
      reportPaymentRequired: true,
    });
    const cookie = await issueSessionCookie(owner.id);

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: null,
        createdAt: new Date("2026-03-10T07:05:00.000Z"),
      },
    });

    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: {
        sourcingRequestId: request.id,
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent(
        "2026-03-10T07:05:00.000Z",
      )}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}`,
    );
    expect(response.headers.get("location")).not.toContain("settlementNote=");
    expect(response.headers.get("location")).not.toContain(
      encodeURIComponent("Settlement recorded by admin."),
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });

  it("omits settlementNote redirect metadata when latest actorful settlement evidence has an empty-string note", async () => {
    const { owner, request, admin } = await seedReportReadyRequest({
      status: "PAYMENT_SETTLED",
      reportPaymentRequired: true,
    });
    const cookie = await issueSessionCookie(owner.id);

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "",
        createdAt: new Date("2026-03-10T07:15:00.000Z"),
      },
    });

    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: {
        sourcingRequestId: request.id,
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent(
        "2026-03-10T07:15:00.000Z",
      )}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}`,
    );
    expect(response.headers.get("location")).not.toContain("settlementNote=");
    expect(response.headers.get("location")).not.toContain(
      encodeURIComponent("Settlement recorded by admin."),
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });

  it("omits settlementNote redirect metadata when latest actorful settlement evidence has a whitespace-only note", async () => {
    const { owner, request, admin } = await seedReportReadyRequest({
      status: "PAYMENT_SETTLED",
      reportPaymentRequired: true,
    });
    const cookie = await issueSessionCookie(owner.id);

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "   ",
        createdAt: new Date("2026-03-10T07:20:00.000Z"),
      },
    });

    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: {
        sourcingRequestId: request.id,
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent(
        "2026-03-10T07:20:00.000Z",
      )}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}`,
    );
    expect(response.headers.get("location")).not.toContain("settlementNote=");
    expect(response.headers.get("location")).not.toContain(
      encodeURIComponent("Settlement recorded by admin."),
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });

  it("normalizes settlementNote redirect metadata when latest actorful settlement evidence has surrounding whitespace", async () => {
    const { owner, request, admin } = await seedReportReadyRequest({
      status: "PAYMENT_SETTLED",
      reportPaymentRequired: true,
    });
    const cookie = await issueSessionCookie(owner.id);

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "  Latest owner settlement note with surrounding whitespace.  ",
        createdAt: new Date("2026-03-10T07:25:00.000Z"),
      },
    });

    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: {
        sourcingRequestId: request.id,
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent(
        "2026-03-10T07:25:00.000Z",
      )}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note with surrounding whitespace.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });

  it("normalizes settlementNote redirect metadata when latest actorful settlement evidence is tab/newline padded", async () => {
    const { owner, request, admin } = await seedReportReadyRequest({
      status: "PAYMENT_SETTLED",
      reportPaymentRequired: true,
    });
    const cookie = await issueSessionCookie(owner.id);

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\tLatest owner settlement note with tab and newline padding.\t\n",
        createdAt: new Date("2026-03-10T07:30:00.000Z"),
      },
    });

    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: {
        sourcingRequestId: request.id,
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent(
        "2026-03-10T07:30:00.000Z",
      )}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note with tab and newline padding.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });

  it("normalizes settlementNote redirect metadata when latest actorful settlement evidence is carriage-return/tab padded", async () => {
    const { owner, request, admin } = await seedReportReadyRequest({
      status: "PAYMENT_SETTLED",
      reportPaymentRequired: true,
    });
    const cookie = await issueSessionCookie(owner.id);

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\r\tLatest owner settlement note with carriage-return and tab padding.\t\r",
        createdAt: new Date("2026-03-10T07:35:00.000Z"),
      },
    });

    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: {
        sourcingRequestId: request.id,
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent(
        "2026-03-10T07:35:00.000Z",
      )}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note with carriage-return and tab padding.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });

  it("normalizes settlementNote redirect metadata when latest actorful settlement evidence is mixed carriage-return/newline/tab padded", async () => {
    const { owner, request, admin } = await seedReportReadyRequest({
      status: "PAYMENT_SETTLED",
      reportPaymentRequired: true,
    });
    const cookie = await issueSessionCookie(owner.id);

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\r\n\tLatest owner settlement note with mixed carriage-return/newline/tab padding.\t\n\r",
        createdAt: new Date("2026-03-10T07:40:00.000Z"),
      },
    });

    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: {
        sourcingRequestId: request.id,
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent(
        "2026-03-10T07:40:00.000Z",
      )}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note with mixed carriage-return/newline/tab padding.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });

  it("normalizes settlementNote redirect metadata when latest actorful settlement evidence has mixed leading/trailing multi-line whitespace padding", async () => {
    const { owner, request, admin } = await seedReportReadyRequest({
      status: "PAYMENT_SETTLED",
      reportPaymentRequired: true,
    });
    const cookie = await issueSessionCookie(owner.id);

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t\r\n  Latest owner settlement note with mixed multi-line edge padding. \r\n\t \n",
        createdAt: new Date("2026-03-10T07:45:00.000Z"),
      },
    });

    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: {
        sourcingRequestId: request.id,
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent(
        "2026-03-10T07:45:00.000Z",
      )}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note with mixed multi-line edge padding.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });

  it("normalizes settlementNote redirect metadata while preserving internal blank-line segments for mixed edge-padded notes", async () => {
    const { owner, request, admin } = await seedReportReadyRequest({
      status: "PAYMENT_SETTLED",
      reportPaymentRequired: true,
    });
    const cookie = await issueSessionCookie(owner.id);

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\r\n \t",
        createdAt: new Date("2026-03-10T07:50:00.000Z"),
      },
    });

    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: {
        sourcingRequestId: request.id,
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent(
        "2026-03-10T07:50:00.000Z",
      )}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });

  it("normalizes settlementNote redirect metadata while preserving repeated internal blank-line segments for mixed edge-padded notes", async () => {
    const { owner, request, admin } = await seedReportReadyRequest({
      status: "PAYMENT_SETTLED",
      reportPaymentRequired: true,
    });
    const cookie = await issueSessionCookie(owner.id);

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\r\n \t",
        createdAt: new Date("2026-03-10T07:55:00.000Z"),
      },
    });

    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: {
        sourcingRequestId: request.id,
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent(
        "2026-03-10T07:55:00.000Z",
      )}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });

  it("normalizes settlementNote redirect metadata while dropping trailing whitespace-only lines after repeated internal blank-line segments", async () => {
    const { owner, request, admin } = await seedReportReadyRequest({
      status: "PAYMENT_SETTLED",
      reportPaymentRequired: true,
    });
    const cookie = await issueSessionCookie(owner.id);

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n   \n\t \r\n",
        createdAt: new Date("2026-03-10T08:00:00.000Z"),
      },
    });

    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: {
        sourcingRequestId: request.id,
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent(
        "2026-03-10T08:00:00.000Z",
      )}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });

  it("normalizes settlementNote redirect metadata while dropping mixed tab-only and space-tab trailing whitespace-only lines after repeated internal blank-line segments", async () => {
    const { owner, request, admin } = await seedReportReadyRequest({
      status: "PAYMENT_SETTLED",
      reportPaymentRequired: true,
    });
    const cookie = await issueSessionCookie(owner.id);

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\t\t\n \t  \n\t \t\r\n",
        createdAt: new Date("2026-03-10T08:05:00.000Z"),
      },
    });

    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: {
        sourcingRequestId: request.id,
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent(
        "2026-03-10T08:05:00.000Z",
      )}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });

  it("normalizes settlementNote redirect metadata while dropping mixed carriage-return trailing whitespace-only line variants after repeated internal blank-line segments", async () => {
    const { owner, request, admin } = await seedReportReadyRequest({
      status: "PAYMENT_SETTLED",
      reportPaymentRequired: true,
    });
    const cookie = await issueSessionCookie(owner.id);

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r \r\t\r\r\n\t \r\n",
        createdAt: new Date("2026-03-10T08:10:00.000Z"),
      },
    });

    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: {
        sourcingRequestId: request.id,
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent(
        "2026-03-10T08:10:00.000Z",
      )}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });

  it("normalizes settlementNote redirect metadata while dropping carriage-return-only trailing whitespace tails without a terminal newline", async () => {
    const { owner, request, admin } = await seedReportReadyRequest({
      status: "PAYMENT_SETTLED",
      reportPaymentRequired: true,
    });
    const cookie = await issueSessionCookie(owner.id);

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r \r\t\r\r",
        createdAt: new Date("2026-03-10T08:15:00.000Z"),
      },
    });

    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: {
        sourcingRequestId: request.id,
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent(
        "2026-03-10T08:15:00.000Z",
      )}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });

  it("normalizes settlementNote redirect metadata while dropping multi-line carriage-return-only trailing whitespace tails without a terminal newline", async () => {
    const { owner, request, admin } = await seedReportReadyRequest({
      status: "PAYMENT_SETTLED",
      reportPaymentRequired: true,
    });
    const cookie = await issueSessionCookie(owner.id);

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r \r\t\r\r\n\r\t \r\r\n\r \r\t\r\r",
        createdAt: new Date("2026-03-10T08:20:00.000Z"),
      },
    });

    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: {
        sourcingRequestId: request.id,
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent(
        "2026-03-10T08:20:00.000Z",
      )}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });

  it("normalizes settlementNote redirect metadata while dropping multi-line carriage-return-only terminal whitespace clusters without a terminal newline", async () => {
    const { owner, request, admin } = await seedReportReadyRequest({
      status: "PAYMENT_SETTLED",
      reportPaymentRequired: true,
    });
    const cookie = await issueSessionCookie(owner.id);

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r\r \r\t\r\r\r\n\r\r\t \r\r\r\n\r \r\t\r\r\r",
        createdAt: new Date("2026-03-10T08:25:00.000Z"),
      },
    });

    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: {
        sourcingRequestId: request.id,
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent(
        "2026-03-10T08:25:00.000Z",
      )}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });

  it("normalizes settlementNote redirect metadata while dropping terminal carriage-return whitespace clusters split by tab-only separator lines without a terminal newline", async () => {
    const { owner, request, admin } = await seedReportReadyRequest({
      status: "PAYMENT_SETTLED",
      reportPaymentRequired: true,
    });
    const cookie = await issueSessionCookie(owner.id);

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n\r\r\t \r\r\r\n\t\n\r \r\t\r\r\r",
        createdAt: new Date("2026-03-10T08:30:00.000Z"),
      },
    });

    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: {
        sourcingRequestId: request.id,
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent(
        "2026-03-10T08:30:00.000Z",
      )}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });

  it("normalizes settlementNote redirect metadata while dropping terminal carriage-return whitespace clusters split by tab-only separator lines interleaved with space-only separator lines without a terminal newline", async () => {
    const { owner, request, admin } = await seedReportReadyRequest({
      status: "PAYMENT_SETTLED",
      reportPaymentRequired: true,
    });
    const cookie = await issueSessionCookie(owner.id);

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n    \n\r \r\t\r\r\r",
        createdAt: new Date("2026-03-10T08:35:00.000Z"),
      },
    });

    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: {
        sourcingRequestId: request.id,
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent(
        "2026-03-10T08:35:00.000Z",
      )}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });

  it("normalizes settlementNote redirect metadata while dropping terminal carriage-return whitespace clusters split by tab-only separators interleaved with mixed-width space-only separators plus trailing tab-only separators without a terminal newline", async () => {
    const { owner, request, admin } = await seedReportReadyRequest({
      status: "PAYMENT_SETTLED",
      reportPaymentRequired: true,
    });
    const cookie = await issueSessionCookie(owner.id);

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t",
        createdAt: new Date("2026-03-10T08:40:00.000Z"),
      },
    });

    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: {
        sourcingRequestId: request.id,
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent(
        "2026-03-10T08:40:00.000Z",
      )}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });

  it("normalizes settlementNote redirect metadata while dropping terminal carriage-return whitespace clusters split by tab-only separators interleaved with mixed-width space-only separator lines and repeated trailing tab-only separator lines without a terminal newline", async () => {
    const { owner, request, admin } = await seedReportReadyRequest({
      status: "PAYMENT_SETTLED",
      reportPaymentRequired: true,
    });
    const cookie = await issueSessionCookie(owner.id);

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t",
        createdAt: new Date("2026-03-10T08:45:00.000Z"),
      },
    });

    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: {
        sourcingRequestId: request.id,
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent(
        "2026-03-10T08:45:00.000Z",
      )}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });

  it("normalizes settlementNote redirect metadata while dropping terminal carriage-return whitespace clusters split by tab-only separators interleaved with mixed-width space-only separator lines, repeated trailing tab-only separator lines, and trailing mixed-width space-only separator lines without a terminal newline", async () => {
    const { owner, request, admin } = await seedReportReadyRequest({
      status: "PAYMENT_SETTLED",
      reportPaymentRequired: true,
    });
    const cookie = await issueSessionCookie(owner.id);

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   ",
        createdAt: new Date("2026-03-10T08:50:00.000Z"),
      },
    });

    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: {
        sourcingRequestId: request.id,
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent(
        "2026-03-10T08:50:00.000Z",
      )}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });

  it("normalizes settlementNote redirect metadata while dropping terminal carriage-return whitespace clusters split by tab-only separators interleaved with mixed-width space-only separator lines, repeated trailing tab-only separator lines, trailing mixed-width space-only separator lines, and repeated trailing mixed-width space-only separator lines without a terminal newline", async () => {
    const { owner, request, admin } = await seedReportReadyRequest({
      status: "PAYMENT_SETTLED",
      reportPaymentRequired: true,
    });
    const cookie = await issueSessionCookie(owner.id);

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n \t  \n     ",
        createdAt: new Date("2026-03-10T08:55:00.000Z"),
      },
    });

    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: {
        sourcingRequestId: request.id,
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent(
        "2026-03-10T08:55:00.000Z",
      )}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });

  it("normalizes settlementNote redirect metadata while dropping terminal carriage-return whitespace clusters split by tab-only separators interleaved with mixed-width space-only separator lines, repeated trailing tab-only separator lines, and repeated trailing mixed-width space-only separator lines spanning three terminal lines without a terminal newline", async () => {
    const { owner, request, admin } = await seedReportReadyRequest({
      status: "PAYMENT_SETTLED",
      reportPaymentRequired: true,
    });
    const cookie = await issueSessionCookie(owner.id);

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       ",
        createdAt: new Date("2026-03-10T09:00:00.000Z"),
      },
    });

    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: {
        sourcingRequestId: request.id,
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent(
        "2026-03-10T09:00:00.000Z",
      )}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });

  it("is idempotent after first acknowledgment and does not duplicate audit/status events", async () => {
    const { owner, request } = await seedReportReadyRequest();
    const cookie = await issueSessionCookie(owner.id);

    const firstResponse = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie }
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    const secondResponse = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie }
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);

    const statusEvents = await prisma.sourcingStatusEvent.findMany({
      where: {
        sourcingRequestId: request.id,
        toStatus: "DELIVERED"
      }
    });
    expect(statusEvents).toHaveLength(1);

    const auditEvents = await prisma.auditEvent.findMany({
      where: {
        sourcingRequestId: request.id,
        action: "REPORT_DELIVERY_ACKNOWLEDGED"
      }
    });
    expect(auditEvents).toHaveLength(1);
  });
});

describe("POST /api/v1/sourcing-requests/:requestId/report/ack (AT-AUTO-BE-74)", () => {
  beforeEach(async () => {
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

  it("normalizes settlementNote redirect metadata for four-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-74@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-74@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      ",
        createdAt: new Date("2026-03-10T09:05:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T09:05:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("POST /api/v1/sourcing-requests/:requestId/report/ack (AT-AUTO-BE-75)", () => {
  beforeEach(async () => {
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

  it("normalizes settlementNote redirect metadata for five-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-75@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-75@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      ",
        createdAt: new Date("2026-03-10T09:25:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T09:25:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("POST /api/v1/sourcing-requests/:requestId/report/ack (AT-AUTO-BE-76)", () => {
  beforeEach(async () => {
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

  it("normalizes settlementNote redirect metadata for six-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-76@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-76@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       ",
        createdAt: new Date("2026-03-10T09:45:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T09:45:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("POST /api/v1/sourcing-requests/:requestId/report/ack (AT-AUTO-BE-77)", () => {
  beforeEach(async () => {
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

  it("normalizes settlementNote redirect metadata for seven-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-77@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-77@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         ",
        createdAt: new Date("2026-03-10T10:05:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T10:05:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("POST /api/v1/sourcing-requests/:requestId/report/ack (AT-AUTO-BE-78)", () => {
  beforeEach(async () => {
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

  it("normalizes settlementNote redirect metadata for eight-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-78@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-78@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           ",
        createdAt: new Date("2026-03-10T10:25:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T10:25:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("POST /api/v1/sourcing-requests/:requestId/report/ack (AT-AUTO-BE-79)", () => {
  beforeEach(async () => {
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

  it("normalizes settlementNote redirect metadata for nine-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-79@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-79@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n        \n",
        createdAt: new Date("2026-03-10T10:45:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T10:45:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("POST /api/v1/sourcing-requests/:requestId/report/ack (AT-AUTO-BE-80)", () => {
  beforeEach(async () => {
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

  it("normalizes settlementNote redirect metadata for ten-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-80@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-80@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n",
        createdAt: new Date("2026-03-10T10:55:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T10:55:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("POST /api/v1/sourcing-requests/:requestId/report/ack (AT-AUTO-BE-81)", () => {
  beforeEach(async () => {
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

  it("normalizes settlementNote redirect metadata for eleven-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-81@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-81@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n",
        createdAt: new Date("2026-03-10T11:05:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T11:05:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("POST /api/v1/sourcing-requests/:requestId/report/ack (AT-AUTO-BE-82)", () => {
  beforeEach(async () => {
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

  it("normalizes settlementNote redirect metadata for twelve-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-82@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-82@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n",
        createdAt: new Date("2026-03-10T11:15:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T11:15:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("POST /api/v1/sourcing-requests/:requestId/report/ack (AT-AUTO-BE-83)", () => {
  beforeEach(async () => {
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

  it("normalizes settlementNote redirect metadata for thirteen-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-83@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-83@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n",
        createdAt: new Date("2026-03-10T11:25:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T11:25:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("POST /api/v1/sourcing-requests/:requestId/report/ack (AT-AUTO-BE-84)", () => {
  beforeEach(async () => {
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

  it("normalizes settlementNote redirect metadata for fourteen-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-84@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-84@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n",
        createdAt: new Date("2026-03-10T11:35:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T11:35:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("POST /api/v1/sourcing-requests/:requestId/report/ack (AT-AUTO-BE-85)", () => {
  beforeEach(async () => {
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

  it("normalizes settlementNote redirect metadata for fifteen-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-85@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-85@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n",
        createdAt: new Date("2026-03-10T11:45:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T11:45:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("POST /api/v1/sourcing-requests/:requestId/report/ack (AT-AUTO-BE-86)", () => {
  beforeEach(async () => {
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

  it("normalizes settlementNote redirect metadata for sixteen-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-86@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-86@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n",
        createdAt: new Date("2026-03-10T11:55:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T11:55:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("POST /api/v1/sourcing-requests/:requestId/report/ack (AT-AUTO-BE-87)", () => {
  beforeEach(async () => {
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

  it("normalizes settlementNote redirect metadata for seventeen-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-87@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-87@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n",
        createdAt: new Date("2026-03-10T12:05:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T12:05:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("POST /api/v1/sourcing-requests/:requestId/report/ack (AT-AUTO-BE-88)", () => {
  beforeEach(async () => {
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

  it("normalizes settlementNote redirect metadata for eighteen-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-88@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-88@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n",
        createdAt: new Date("2026-03-10T12:10:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T12:10:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("POST /api/v1/sourcing-requests/:requestId/report/ack (AT-AUTO-BE-89)", () => {
  beforeEach(async () => {
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

  it("normalizes settlementNote redirect metadata for nineteen-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-89@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-89@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n  \n",
        createdAt: new Date("2026-03-10T12:15:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T12:15:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("POST /api/v1/sourcing-requests/:requestId/report/ack (AT-AUTO-BE-90)", () => {
  beforeEach(async () => {
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

  it("normalizes settlementNote redirect metadata for twenty-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-90@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-90@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n  \n \n",
        createdAt: new Date("2026-03-10T12:20:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T12:20:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("POST /api/v1/sourcing-requests/:requestId/report/ack (AT-AUTO-BE-91)", () => {
  beforeEach(async () => {
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

  it("normalizes settlementNote redirect metadata for twenty-one-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-91@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-91@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n  \n \n    \n",
        createdAt: new Date("2026-03-10T12:21:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T12:21:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("POST /api/v1/sourcing-requests/:requestId/report/ack (AT-AUTO-BE-92)", () => {
  beforeEach(async () => {
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

  it("normalizes settlementNote redirect metadata for twenty-two-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-92@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-92@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n  \n \n    \n   \n",
        createdAt: new Date("2026-03-10T12:22:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T12:22:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("POST /api/v1/sourcing-requests/:requestId/report/ack (AT-AUTO-BE-93)", () => {
  beforeEach(async () => {
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

  it("normalizes settlementNote redirect metadata for twenty-three-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-93@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-93@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n  \n \n    \n   \n  \n",
        createdAt: new Date("2026-03-10T12:23:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T12:23:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("POST /api/v1/sourcing-requests/:requestId/report/ack (AT-AUTO-BE-94)", () => {
  beforeEach(async () => {
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

  it("normalizes settlementNote redirect metadata for twenty-four-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-94@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-94@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n  \n \n    \n   \n  \n     \n",
        createdAt: new Date("2026-03-10T12:24:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T12:24:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("POST /api/v1/sourcing-requests/:requestId/report/ack (AT-AUTO-BE-95)", () => {
  beforeEach(async () => {
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

  it("normalizes settlementNote redirect metadata for twenty-five-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-95@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-95@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n  \n \n    \n   \n  \n     \n      \n",
        createdAt: new Date("2026-03-10T12:25:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T12:25:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("POST /api/v1/sourcing-requests/:requestId/report/ack (AT-AUTO-BE-96)", () => {
  beforeEach(async () => {
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

  it("normalizes settlementNote redirect metadata for twenty-six-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-96@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-96@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n  \n \n    \n   \n  \n     \n      \n       \n",
        createdAt: new Date("2026-03-10T12:26:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T12:26:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("POST /api/v1/sourcing-requests/:requestId/report/ack (AT-AUTO-BE-97)", () => {
  beforeEach(async () => {
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

  it("normalizes settlementNote redirect metadata for twenty-seven-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-97@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-97@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n  \n \n    \n   \n  \n     \n      \n       \n        \n",
        createdAt: new Date("2026-03-10T12:27:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T12:27:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("POST /api/v1/sourcing-requests/:requestId/report/ack (AT-AUTO-BE-98)", () => {
  beforeEach(async () => {
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

  it("normalizes settlementNote redirect metadata for twenty-eight-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-98@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-98@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n  \n \n    \n   \n  \n     \n      \n       \n        \n          \n",
        createdAt: new Date("2026-03-10T12:28:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T12:28:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("POST /api/v1/sourcing-requests/:requestId/report/ack (AT-AUTO-BE-99)", () => {
  beforeEach(async () => {
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

  it("normalizes settlementNote redirect metadata for twenty-nine-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-99@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-99@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n  \n \n    \n   \n  \n     \n      \n       \n        \n          \n            \n",
        createdAt: new Date("2026-03-10T12:29:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T12:29:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("POST /api/v1/sourcing-requests/:requestId/report/ack (AT-AUTO-BE-100)", () => {
  beforeEach(async () => {
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

  it("normalizes settlementNote redirect metadata for thirty-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-100@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-100@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n  \n \n    \n   \n  \n     \n      \n       \n        \n          \n            \n              \n",
        createdAt: new Date("2026-03-10T12:30:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T12:30:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("POST /api/v1/sourcing-requests/:requestId/report/ack (AT-AUTO-BE-101)", () => {
  beforeEach(async () => {
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

  it("normalizes settlementNote redirect metadata for thirty-one-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-101@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-101@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n  \n \n    \n   \n  \n     \n      \n       \n        \n          \n            \n              \n                \n",
        createdAt: new Date("2026-03-10T12:31:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T12:31:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("POST /api/v1/sourcing-requests/:requestId/report/ack (AT-AUTO-BE-102)", () => {
  beforeEach(async () => {
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

  it("normalizes settlementNote redirect metadata for thirty-two-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-102@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-102@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n  \n \n    \n   \n  \n     \n      \n       \n        \n          \n            \n              \n                \n                  \n",
        createdAt: new Date("2026-03-10T12:32:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T12:32:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("POST /api/v1/sourcing-requests/:requestId/report/ack (AT-AUTO-BE-103)", () => {
  beforeEach(async () => {
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

  it("normalizes settlementNote redirect metadata for thirty-three-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-103@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-103@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n  \n \n    \n   \n  \n     \n      \n       \n        \n          \n            \n              \n                \n                  \n                    \n",
        createdAt: new Date("2026-03-10T12:33:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T12:33:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("POST /api/v1/sourcing-requests/:requestId/report/ack (AT-AUTO-BE-104)", () => {
  beforeEach(async () => {
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

  it("normalizes settlementNote redirect metadata for thirty-four-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-104@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-104@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n  \n \n    \n   \n  \n     \n      \n       \n        \n          \n            \n              \n                \n                  \n                    \n                      \n",
        createdAt: new Date("2026-03-10T12:34:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T12:34:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("POST /api/v1/sourcing-requests/:requestId/report/ack (AT-AUTO-BE-105)", () => {
  beforeEach(async () => {
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

  it("normalizes settlementNote redirect metadata for thirty-five-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-105@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-105@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n  \n \n    \n   \n  \n     \n      \n       \n        \n          \n            \n              \n                \n                  \n                    \n                      \n                        \n",
        createdAt: new Date("2026-03-10T12:35:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T12:35:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("POST /api/v1/sourcing-requests/:requestId/report/ack (AT-AUTO-BE-106)", () => {
  beforeEach(async () => {
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

  it("normalizes settlementNote redirect metadata for thirty-six-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-106@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-106@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n  \n \n    \n   \n  \n     \n      \n       \n        \n          \n            \n              \n                \n                  \n                    \n                      \n                        \n                          \n",
        createdAt: new Date("2026-03-10T12:36:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T12:36:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("POST /api/v1/sourcing-requests/:requestId/report/ack (AT-AUTO-BE-108)", () => {
  beforeEach(async () => {
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

  it("normalizes settlementNote redirect metadata for thirty-eight-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-108@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-107@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n  \n \n    \n   \n  \n     \n      \n       \n        \n          \n            \n              \n                \n                  \n                    \n                      \n                        \n                          \n                            \n                              \n",
        createdAt: new Date("2026-03-10T12:38:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T12:38:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("POST /api/v1/sourcing-requests/:requestId/report/ack (AT-AUTO-BE-107)", () => {
  beforeEach(async () => {
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

  it("normalizes settlementNote redirect metadata for thirty-seven-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-107@example.com", passwordHash: "hash", role: "USER" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n  \n \n    \n   \n  \n     \n      \n       \n        \n          \n            \n              \n                \n                  \n                    \n                      \n                        \n                          \n                            \n",
        createdAt: new Date("2026-03-10T12:37:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T12:37:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
  });
});

describe("POST /api/v1/sourcing-requests/:requestId/report/ack (AT-AUTO-BE-109)", () => {
  beforeEach(async () => {
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

  it("normalizes settlementNote redirect metadata for thirty-nine-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-109@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-109@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n  \n \n    \n   \n  \n     \n      \n       \n        \n          \n            \n              \n                \n                  \n                    \n                      \n                        \n                          \n                            \n                              \n                                \n",
        createdAt: new Date("2026-03-10T12:39:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T12:39:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("POST /api/v1/sourcing-requests/:requestId/report/ack (AT-AUTO-BE-110)", () => {
  beforeEach(async () => {
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

  it("normalizes settlementNote redirect metadata for forty-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-110@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-110@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n  \n \n    \n   \n  \n     \n      \n       \n        \n          \n            \n              \n                \n                  \n                    \n                      \n                        \n                          \n                            \n                              \n                                \n                                  \n",
        createdAt: new Date("2026-03-10T12:40:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T12:40:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("POST /api/v1/sourcing-requests/:requestId/report/ack (AT-AUTO-BE-112)", () => {
  beforeEach(async () => {
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

  it("normalizes settlementNote redirect metadata for forty-two-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-112@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-112@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note: "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.\n\r\r \r\t\r\r\r\n\t\t\t\n   \n\r\r\t \r\r\r\n\t\n        \n\r \r\t\r\r\r\n\t\t\n\t\t\t\n\t\t\t\t\n\t\t\n    \n      \n   \n     \n       \n      \n        \n      \n    \n  \n      \n  \n    \n       \n    \n      \n         \n           \n          \n        \n      \n    \n   \n \n\t \n  \n      \n    \n  \n \n    \n   \n  \n     \n      \n       \n        \n          \n            \n              \n                \n                  \n                    \n                      \n                        \n                          \n                            \n                              \n                                \n                                  \n                                    \n",
        createdAt: new Date("2026-03-10T12:42:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T12:42:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("POST /api/v1/sourcing-requests/:requestId/report/ack (AT-AUTO-BE-113)", () => {
  beforeEach(async () => {
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

  it("normalizes settlementNote redirect metadata for forty-three-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-113@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-113@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 43 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T12:43:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T12:43:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("POST /api/v1/sourcing-requests/:requestId/report/ack (AT-AUTO-BE-114)", () => {
  beforeEach(async () => {
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

  it("normalizes settlementNote redirect metadata for forty-four-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-114@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-114@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 44 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T12:44:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T12:44:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("POST /api/v1/sourcing-requests/:requestId/report/ack (AT-AUTO-BE-115)", () => {
  beforeEach(async () => {
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

  it("normalizes settlementNote redirect metadata for forty-five-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-115@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-115@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 45 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T12:45:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T12:45:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("POST /api/v1/sourcing-requests/:requestId/report/ack (AT-AUTO-BE-116)", () => {
  beforeEach(async () => {
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

  it("normalizes settlementNote redirect metadata for forty-six-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-116@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-116@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 46 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T12:46:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T12:46:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("POST /api/v1/sourcing-requests/:requestId/report/ack (AT-AUTO-BE-116)", () => {
  beforeEach(async () => {
    await prisma.reportArtifact.deleteMany();
    await prisma.sourcingStatusEvent.deleteMany();
    await prisma.sourcingRequest.deleteMany();
    await prisma.prescription.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });

  function makeCookie(token: string) {
    return `${SESSION_COOKIE_NAME}=${token}`;
  }

  it("normalizes settlementNote redirect metadata for forty-six-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-116@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-116@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 46 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T12:46:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T12:46:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("POST /api/v1/sourcing-requests/:requestId/report/ack (AT-AUTO-BE-116)", () => {
  beforeEach(async () => {
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

  it("normalizes settlementNote redirect metadata for forty-six-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-116@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-116@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 46 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T12:46:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T12:46:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("POST /api/v1/sourcing-requests/:requestId/report/ack (AT-AUTO-BE-117)", () => {
  beforeEach(async () => {
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

  it("normalizes settlementNote redirect metadata for forty-seven-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-117@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-117@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 47 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T12:47:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T12:47:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });

  it("normalizes settlementNote redirect metadata for forty-eight-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-118@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-118@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 48 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T12:48:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T12:48:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });

  it("normalizes settlementNote redirect metadata for forty-nine-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-119@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-119@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 49 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T12:49:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T12:49:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });

  it("normalizes settlementNote redirect metadata for fifty-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-120@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-120@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 50 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T12:50:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T12:50:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });

  it("normalizes settlementNote redirect metadata for fifty-one-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-121@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-121@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 51 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T12:51:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T12:51:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-122)", () => {
  it("normalizes settlementNote redirect metadata for fifty-two-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-122x@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-122x@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 52 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T12:52:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T12:52:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-123)", () => {
  it("normalizes settlementNote redirect metadata for fifty-three-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-123x@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-123x@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 53 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T12:53:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T12:53:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-124)", () => {
  it("normalizes settlementNote redirect metadata for fifty-four-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-124x@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-124x@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 54 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T12:54:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T12:54:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-125)", () => {
  it("normalizes settlementNote redirect metadata for fifty-five-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-125x@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-125x@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 55 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T12:55:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T12:55:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-126)", () => {
  it("normalizes settlementNote redirect metadata for fifty-six-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-126x@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-126x@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 56 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T12:56:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T12:56:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-127)", () => {
  it("normalizes settlementNote redirect metadata for fifty-seven-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-127x@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-127x@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 57 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T12:57:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T12:57:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-128)", () => {
  it("normalizes settlementNote redirect metadata for fifty-eight-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-128@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-128@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 58 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T12:58:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T12:58:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-129)", () => {
  it("normalizes settlementNote redirect metadata for fifty-nine-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-129@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-129@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 59 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T12:59:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T12:59:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-130)", () => {
  it("normalizes settlementNote redirect metadata for sixty-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-130@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-130@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 60 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T13:00:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T13:00:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-131)", () => {
  it("normalizes settlementNote redirect metadata for sixty-one-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-131@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-131@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 61 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T13:01:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T13:01:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-132)", () => {
  it("normalizes settlementNote redirect metadata for sixty-two-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-132@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-132@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 62 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T13:02:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T13:02:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-133)", () => {
  it("normalizes settlementNote redirect metadata for sixty-three-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-133@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-133@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 63 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T13:03:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T13:03:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-134)", () => {
  it("normalizes settlementNote redirect metadata for sixty-four-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-134@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-134@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 64 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T13:04:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T13:04:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-135)", () => {
  it("normalizes settlementNote redirect metadata for sixty-five-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-135@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-135@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 65 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T13:05:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T13:05:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-136)", () => {
  it("normalizes settlementNote redirect metadata for sixty-six-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-136@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-136@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 66 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T13:06:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T13:06:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-137)", () => {
  it("normalizes settlementNote redirect metadata for sixty-seven-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-137@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-137@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 67 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T13:07:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T13:07:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-135)", () => {
  it("normalizes settlementNote redirect metadata for sixty-five-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-135@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-135@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 65 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T13:05:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T13:05:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-136)", () => {
  it("normalizes settlementNote redirect metadata for sixty-six-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-136@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-136@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 66 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T13:06:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T13:06:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-136)", () => {
  it("normalizes settlementNote redirect metadata for sixty-six-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-136@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-136@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 66 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T13:05:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T13:05:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-138)", () => {
  it("normalizes settlementNote redirect metadata for sixty-eight-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-138@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-138@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 68 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T13:08:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T13:08:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-139)", () => {
  it("normalizes settlementNote redirect metadata for sixty-nine-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-139@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-139@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 69 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T13:09:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T13:09:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-140)", () => {
  it("normalizes settlementNote redirect metadata for seventy-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-140@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-140@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 70 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T13:10:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T13:10:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-141)", () => {
  it("normalizes settlementNote redirect metadata for seventy-one-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-141@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-141@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 71 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T13:11:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T13:11:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-142)", () => {
  it("normalizes settlementNote redirect metadata for seventy-two-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-142@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-142@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 72 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T13:12:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T13:12:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-143)", () => {
  it("normalizes settlementNote redirect metadata for seventy-three-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-143@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-143@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 73 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T13:13:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T13:13:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-144)", () => {
  it("normalizes settlementNote redirect metadata for seventy-four-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-144@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-144@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 74 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T13:14:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T13:14:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-145)", () => {
  it("normalizes settlementNote redirect metadata for seventy-five-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-145@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-145@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 75 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T13:15:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T13:15:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-146)", () => {
  it("normalizes settlementNote redirect metadata for seventy-six-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-146@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-146@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 76 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T13:16:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T13:16:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-147)", () => {
  it("normalizes settlementNote redirect metadata for seventy-seven-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-147@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-147@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 77 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T13:17:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T13:17:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});


describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-148)", () => {
  it("normalizes settlementNote redirect metadata for seventy-eight-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-148@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-148@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 78 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T13:18:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T13:18:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-149)", () => {
  it("normalizes settlementNote redirect metadata for seventy-nine-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-149@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-149@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 79 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T13:19:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T13:19:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-150)", () => {
  it("normalizes settlementNote redirect metadata for eighty-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-150@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-150@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 80 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T13:20:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T13:20:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-151)", () => {
  it("normalizes settlementNote redirect metadata for eighty-one-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-151@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-151@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 81 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T13:21:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T13:21:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-153)", () => {
  it("normalizes settlementNote redirect metadata for eighty-three-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-153@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-153@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 83 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T13:22:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T13:22:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-154)", () => {
  it("normalizes settlementNote redirect metadata for eighty-four-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-154@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-154@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 84 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T13:23:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T13:23:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-155)", () => {
  it("normalizes settlementNote redirect metadata for eighty-five-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-155@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-155@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 85 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T13:24:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T13:24:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-156)", () => {
  it("normalizes settlementNote redirect metadata for eighty-six-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-156@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-156@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 86 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T13:25:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T13:25:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-157)", () => {
  it("normalizes settlementNote redirect metadata for eighty-seven-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-157@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-157@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 87 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T13:22:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T13:22:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-155)", () => {
  it("normalizes settlementNote redirect metadata for eighty-five-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-155@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-155@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 85 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T13:24:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T13:24:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-156)", () => {
  it("normalizes settlementNote redirect metadata for eighty-six-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-156@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-156@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 86 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T13:23:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T13:23:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-157)", () => {
  it("normalizes settlementNote redirect metadata for eighty-seven-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-157@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-157@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 87 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T13:26:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T13:26:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-158)", () => {
  it("normalizes settlementNote redirect metadata for eighty-eight-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-158@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-158@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 88 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T13:29:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T13:29:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-158)", () => {
  it("normalizes settlementNote redirect metadata for eighty-eight-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-158@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-158@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 88 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T13:28:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T13:28:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-159)", () => {
  it("normalizes settlementNote redirect metadata for eighty-nine-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-159@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-159@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 89 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T13:30:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T13:30:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-160)", () => {
  it("normalizes settlementNote redirect metadata for ninety-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-160@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-160@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 90 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T13:32:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T13:32:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-159)", () => {
  it("normalizes settlementNote redirect metadata for eighty-nine-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-159@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-159@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 89 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T13:30:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T13:30:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-160)", () => {
  it("normalizes settlementNote redirect metadata for ninety-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-160@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-160@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 90 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T13:32:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T13:32:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-161)", () => {
  it("normalizes settlementNote redirect metadata for ninety-one-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-161@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-161@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 91 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T13:33:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T13:33:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});

describe("report ack route trailing mixed-width settlement note (AT-AUTO-BE-162)", () => {
  it("normalizes settlementNote redirect metadata for ninety-two-line trailing mixed-width separators", async () => {
    const owner = await prisma.user.create({ data: { email: "owner-ack-162@example.com", passwordHash: "hash", role: "USER" } });
    const admin = await prisma.user.create({ data: { email: "admin-ack-162@example.com", passwordHash: "hash", role: "ADMIN" } });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "NL",
        payload: { countryCode: "NL", leftEye: { sphere: -1.0 }, rightEye: { sphere: -1.25 }, pupillaryDistance: 62 },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        currency: "EUR",
      },
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/report-ready.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email",
      },
    });

    const trailingSeparators = Array.from({ length: 92 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: owner.id,
        note:
          "\n\t  Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T13:34:00.000Z"),
      },
    });

    const cookie = await issueSessionCookie(owner.id);
    const latestSettlementEvent = await prisma.sourcingStatusEvent.findFirst({
      where: { sourcingRequestId: request.id, toStatus: "PAYMENT_SETTLED", actorUserId: owner.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const formData = new URLSearchParams();
    formData.set("redirectTo", `/timeline?requestId=${request.id}&ack=1`);

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/sourcing-requests/${request.id}/report/ack`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }),
      { params: Promise.resolve({ requestId: request.id }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost/timeline?requestId=${request.id}&ack=1&settledByRole=USER&settledAt=${encodeURIComponent("2026-03-10T13:34:00.000Z")}&settledByUserId=${encodeURIComponent(owner.id)}&settledByUserEmail=${encodeURIComponent(owner.email)}&settlementEventId=${encodeURIComponent(latestSettlementEvent?.id ?? "")}&settlementNote=${encodeURIComponent("Latest owner settlement note line one.\n\nLatest owner settlement note line two.\n\nLatest owner settlement note line three.")}`,
    );
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.id));
    expect(response.headers.get("location")).not.toContain(encodeURIComponent(admin.email));
  });
});
