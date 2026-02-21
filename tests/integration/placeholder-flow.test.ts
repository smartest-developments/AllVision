import { beforeEach, describe, expect, it } from "vitest";
import { createPrescription } from "@/server/prescriptions";
import { prisma } from "@/server/db";

describe("prescription intake", () => {
  beforeEach(async () => {
    await prisma.auditEvent.deleteMany();
    await prisma.reportArtifact.deleteMany();
    await prisma.sourcingStatusEvent.deleteMany();
    await prisma.sourcingRequest.deleteMany();
    await prisma.prescription.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });

  it("persists a valid prescription payload", async () => {
    const user = await prisma.user.create({
      data: {
        email: "intake@example.com",
        passwordHash: "hash",
        role: "USER"
      }
    });

    const record = await createPrescription({
      userId: user.id,
      payload: {
        countryCode: "NL",
        leftEye: { sphere: -2.0 },
        rightEye: { sphere: -1.75 },
        pupillaryDistance: 62,
        notes: "Prefers lightweight lenses"
      }
    });

    const stored = await prisma.prescription.findUnique({
      where: { id: record.id }
    });

    expect(stored?.countryCode).toBe("NL");
    expect((stored?.payload as { pupillaryDistance?: number })?.pupillaryDistance).toBe(62);
  });

  it("rejects invalid prescriptions deterministically", async () => {
    const user = await prisma.user.create({
      data: {
        email: "invalid@example.com",
        passwordHash: "hash",
        role: "USER"
      }
    });

    await expect(
      createPrescription({
        userId: user.id,
        payload: {
          countryCode: "US",
          leftEye: { sphere: -2.0 },
          rightEye: { sphere: -1.75 },
          pupillaryDistance: 62
        }
      })
    ).rejects.toMatchObject({ code: "INVALID_PRESCRIPTION" });

    const count = await prisma.prescription.count();
    expect(count).toBe(0);
  });
});
