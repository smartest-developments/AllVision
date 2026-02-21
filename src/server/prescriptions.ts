import { prescriptionSchema } from "@/types/prescription";
import { prisma } from "@/server/db";

export class PrescriptionIntakeError extends Error {
  code: string;
  issues?: { path: string; message: string }[];

  constructor(message: string, issues?: { path: string; message: string }[]) {
    super(message);
    this.code = "INVALID_PRESCRIPTION";
    this.issues = issues;
  }
}

type UnknownRecord = Record<string, unknown>;

export async function createPrescription(input: { userId: string; payload: unknown }) {
  const candidate =
    typeof input.payload === "object" && input.payload !== null
      ? (input.payload as UnknownRecord)
      : null;

  const parsed = prescriptionSchema.safeParse(candidate ?? input.payload);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message
    }));
    throw new PrescriptionIntakeError("Prescription payload invalid.", issues);
  }

  const consentVersion =
    candidate?.consentVersion === null || typeof candidate?.consentVersion === "string"
      ? (candidate.consentVersion as string | null)
      : undefined;

  return prisma.prescription.create({
    data: {
      userId: input.userId,
      countryCode: parsed.data.countryCode,
      payload: parsed.data,
      consentVersion: consentVersion ?? null
    }
  });
}
