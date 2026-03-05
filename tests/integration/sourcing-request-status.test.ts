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
});
