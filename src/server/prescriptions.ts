import { prescriptionSchema } from "@/types/prescription";
import { prisma } from "@/server/db";
import type { UserRole } from "@/server/auth";

export class PrescriptionIntakeError extends Error {
  code: string;
  issues?: { path: string; message: string }[];

  constructor(message: string, issues?: { path: string; message: string }[]) {
    super(message);
    this.code = "INVALID_PRESCRIPTION";
    this.issues = issues;
  }
}

export class PrescriptionAccessError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
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

export async function getPrescriptionForViewer(input: {
  prescriptionId: string;
  viewerUserId: string;
  viewerRole: UserRole;
}) {
  const prescription = await prisma.prescription.findUnique({
    where: { id: input.prescriptionId }
  });

  if (!prescription) {
    throw new PrescriptionAccessError("NOT_FOUND", "Prescription not found.", 404);
  }

  const isOwner = prescription.userId === input.viewerUserId;
  const isAdmin = input.viewerRole === "ADMIN";
  if (!isOwner && !isAdmin) {
    throw new PrescriptionAccessError("FORBIDDEN", "Access denied.", 403);
  }

  return prescription;
}
