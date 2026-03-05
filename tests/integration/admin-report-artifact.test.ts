import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { createReportArtifactAndMarkReady } from "@/server/report-artifacts";

describe("admin report artifact upload", () => {
  beforeEach(async () => {
    await prisma.auditEvent.deleteMany();
    await prisma.reportArtifact.deleteMany();
    await prisma.sourcingStatusEvent.deleteMany();
    await prisma.sourcingRequest.deleteMany();
    await prisma.prescription.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });

  it("creates a report artifact and marks the request ready", async () => {
    const admin = await prisma.user.create({
      data: {
        email: "admin@example.com",
        passwordHash: "hash",
        role: "ADMIN"
      }
    });

    const user = await prisma.user.create({
      data: {
        email: "user@example.com",
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
        status: "IN_REVIEW",
        reportPaymentRequired: false,
        reportFeeCents: null,
        currency: "EUR"
      }
    });

    const existingRequest = await prisma.sourcingRequest.findUnique({
      where: { id: request.id }
    });
    expect(existingRequest).not.toBeNull();

    const result = await createReportArtifactAndMarkReady({
      requestId: request.id,
      adminUserId: admin.id,
      data: {
        storageKey: "reports/request-1.pdf",
        checksumSha256: "abc123",
        deliveryChannel: "email"
      }
    });

    expect(result.request.status).toBe("REPORT_READY");
    expect(result.artifact.storageKey).toBe("reports/request-1.pdf");
    expect(result.artifact.createdByAdminId).toBe(admin.id);

    const storedRequest = await prisma.sourcingRequest.findUnique({
      where: { id: request.id },
      include: { reportArtifacts: true }
    });

    expect(storedRequest?.status).toBe("REPORT_READY");
    expect(storedRequest?.reportArtifacts).toHaveLength(1);

    const statusEvents = await prisma.sourcingStatusEvent.findMany({
      where: { sourcingRequestId: request.id },
      orderBy: { createdAt: "asc" }
    });
    expect(statusEvents).toHaveLength(1);
    expect(statusEvents[0]).toMatchObject({
      fromStatus: "IN_REVIEW",
      toStatus: "REPORT_READY",
      actorUserId: admin.id
    });

    const emailAudit = await prisma.auditEvent.findFirst({
      where: {
        sourcingRequestId: request.id,
        action: "REPORT_READY_EMAIL_ENQUEUED"
      }
    });
    expect(emailAudit).not.toBeNull();
    expect(emailAudit?.actorUserId).toBe(admin.id);
  });
});
