import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { listSourcingRequestStatusesForUser } from "@/server/sourcing-request-status";

describe("sourcing request status listing", () => {
  beforeEach(async () => {
    await prisma.auditEvent.deleteMany();
    await prisma.reportArtifact.deleteMany();
    await prisma.sourcingStatusEvent.deleteMany();
    await prisma.sourcingRequest.deleteMany();
    await prisma.prescription.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });

  it("returns only user-owned request statuses with timeline", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "status-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });

    const otherUser = await prisma.user.create({
      data: {
        email: "status-other@example.com",
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

    const ownerRequest = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: ownerPrescription.id,
        status: "IN_REVIEW",
        reportPaymentRequired: false,
        currency: "EUR",
      },
    });

    await prisma.sourcingStatusEvent.createMany({
      data: [
        {
          sourcingRequestId: ownerRequest.id,
          fromStatus: "SUBMITTED",
          toStatus: "IN_REVIEW",
          note: "Admin started review",
        },
      ],
    });

    const otherPrescription = await prisma.prescription.create({
      data: {
        userId: otherUser.id,
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
        userId: otherUser.id,
        prescriptionId: otherPrescription.id,
        status: "SUBMITTED",
        reportPaymentRequired: false,
        currency: "EUR",
      },
    });

    const result = await listSourcingRequestStatusesForUser(owner.id);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      requestId: ownerRequest.id,
      status: "IN_REVIEW",
      reportFee: {
        required: false,
        feeCents: null,
        currency: "EUR",
        paymentState: "NOT_REQUIRED",
        pendingReason: null,
        checkoutInitiatedAt: null,
        settledAt: null,
        settledByRole: null,
        settledByUserId: null,
        settledByUserEmail: null,
        settlementEventId: null,
        settlementNote: null,
      },
      timeline: [
        {
          fromStatus: "SUBMITTED",
          toStatus: "IN_REVIEW",
          note: "Admin started review",
        },
      ],
    });
    expect(result[0].latestEventAt).toBeInstanceOf(Date);
  });

  it("exposes report-fee pending state when payment is required", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "status-owner-payment@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });

    const ownerPrescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "CH",
        payload: {
          countryCode: "CH",
          leftEye: { sphere: -1.25 },
          rightEye: { sphere: -1.5 },
          pupillaryDistance: 62,
        },
      },
    });

    await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: ownerPrescription.id,
        status: "REPORT_READY",
        reportPaymentRequired: true,
        reportFeeCents: 2490,
        currency: "CHF",
      },
    });

    const result = await listSourcingRequestStatusesForUser(owner.id);

    expect(result).toHaveLength(1);
    expect(result[0]?.reportFee).toEqual({
      required: true,
      feeCents: 2490,
      currency: "CHF",
      paymentState: "PENDING",
      pendingReason: null,
      checkoutInitiatedAt: null,
      settledAt: null,
      settledByRole: null,
      settledByUserId: null,
      settledByUserEmail: null,
      settlementEventId: null,
      settlementNote: null,
    });
  });

  it("exposes pending-pricing reason metadata when payment is pending without fee amount", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "status-owner-pending-pricing@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });

    const ownerPrescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "CH",
        payload: {
          countryCode: "CH",
          leftEye: { sphere: -1.25 },
          rightEye: { sphere: -1.5 },
          pupillaryDistance: 62,
        },
      },
    });

    await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: ownerPrescription.id,
        status: "REPORT_READY",
        reportPaymentRequired: true,
        reportFeeCents: null,
        currency: "CHF",
      },
    });

    const result = await listSourcingRequestStatusesForUser(owner.id);

    expect(result).toHaveLength(1);
    expect(result[0]?.reportFee).toEqual({
      required: true,
      feeCents: null,
      currency: "CHF",
      paymentState: "PENDING",
      pendingReason: "PRICING_IN_PROGRESS",
      checkoutInitiatedAt: null,
      settledAt: null,
      settledByRole: null,
      settledByUserId: null,
      settledByUserEmail: null,
      settlementEventId: null,
      settlementNote: null,
    });
  });

  it("exposes settlement audit metadata from PAYMENT_SETTLED status events", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "status-owner-settlement-audit@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "status-admin-settlement-audit@example.com",
        passwordHash: "hash",
        role: "ADMIN",
      },
    });

    const ownerPrescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "CH",
        payload: {
          countryCode: "CH",
          leftEye: { sphere: -1.25 },
          rightEye: { sphere: -1.5 },
          pupillaryDistance: 62,
        },
      },
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: ownerPrescription.id,
        status: "PAYMENT_SETTLED",
        reportPaymentRequired: true,
        reportFeeCents: 2490,
        currency: "CHF",
      },
    });

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note: "Payment settled by admin.",
        createdAt: new Date("2026-03-10T05:00:00.000Z"),
      },
    });

    const result = await listSourcingRequestStatusesForUser(owner.id);

    expect(result).toHaveLength(1);
    expect(result[0]?.reportFee).toMatchObject({
      paymentState: "SETTLED",
      settledAt: "2026-03-10T05:00:00.000Z",
      settledByRole: "ADMIN",
      settledByUserId: admin.id,
      settledByUserEmail: admin.email,
      settlementEventId: expect.any(String),
      settlementNote: "Payment settled by admin.",
    });
  });
});

describe("checkout initiation metadata", () => {
  it("exposes checkout initiation timestamp derived from PAYMENT_PENDING status events", async () => {
  const owner = await prisma.user.create({
    data: {
      email: "status-owner-checkout-init@example.com",
      passwordHash: "hash",
      role: "USER",
    },
  });

  const ownerPrescription = await prisma.prescription.create({
    data: {
      userId: owner.id,
      countryCode: "CH",
      payload: {
        countryCode: "CH",
        leftEye: { sphere: -1.25 },
        rightEye: { sphere: -1.5 },
        pupillaryDistance: 62,
      },
    },
  });

  const request = await prisma.sourcingRequest.create({
    data: {
      userId: owner.id,
      prescriptionId: ownerPrescription.id,
      status: "PAYMENT_PENDING",
      reportPaymentRequired: true,
      reportFeeCents: 2490,
      currency: "CHF",
    },
  });

  await prisma.sourcingStatusEvent.create({
    data: {
      sourcingRequestId: request.id,
      fromStatus: "REPORT_READY",
      toStatus: "PAYMENT_PENDING",
      note: "Owner initiated report-fee checkout.",
      createdAt: new Date("2026-03-10T04:30:00.000Z"),
    },
  });

  const result = await listSourcingRequestStatusesForUser(owner.id);

  expect(result).toHaveLength(1);
  expect(result[0]?.reportFee.checkoutInitiatedAt).toBe("2026-03-10T04:30:00.000Z");
});
});
