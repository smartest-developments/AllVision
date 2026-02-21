import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { getReportArtifactForOwner, ReportRetrievalError } from "@/server/report-retrieval";

describe("report retrieval", () => {
  beforeEach(async () => {
    await prisma.auditEvent.deleteMany();
    await prisma.reportArtifact.deleteMany();
    await prisma.sourcingStatusEvent.deleteMany();
    await prisma.sourcingRequest.deleteMany();
    await prisma.prescription.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });

  it("returns report metadata for the request owner", async () => {
    const user = await prisma.user.create({
      data: {
        email: "owner@example.com",
        passwordHash: "hash",
        role: "USER"
      }
    });

    const prescription = await prisma.prescription.create({
      data: {
        userId: user.id,
        countryCode: "NL",
        payload: {
          countryCode: "NL",
          leftEye: { sphere: -1.5 },
          rightEye: { sphere: -1.25 },
          pupillaryDistance: 62
        },
        consentVersion: null
      }
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: user.id,
        prescriptionId: prescription.id,
        status: "REPORT_READY",
        reportPaymentRequired: false,
        reportFeeCents: null,
        currency: "EUR"
      }
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/owner-report.pdf",
        checksumSha256: "checksum",
        deliveryChannel: "email"
      }
    });

    const result = await getReportArtifactForOwner({
      requestId: request.id,
      userId: user.id
    });

    expect(result.artifact.storageKey).toBe("reports/owner-report.pdf");
    expect(result.request.status).toBe("REPORT_READY");
  });

  it("rejects access for non-owners", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "owner2@example.com",
        passwordHash: "hash",
        role: "USER"
      }
    });

    const otherUser = await prisma.user.create({
      data: {
        email: "intruder@example.com",
        passwordHash: "hash",
        role: "USER"
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
        },
        consentVersion: null
      }
    });

    const request = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "REPORT_READY",
        reportPaymentRequired: false,
        reportFeeCents: null,
        currency: "EUR"
      }
    });

    await prisma.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: null,
        storageKey: "reports/owner2-report.pdf",
        checksumSha256: null,
        deliveryChannel: "email"
      }
    });

    await expect(
      getReportArtifactForOwner({
        requestId: request.id,
        userId: otherUser.id
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
