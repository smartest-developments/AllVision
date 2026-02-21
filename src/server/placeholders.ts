import { prescriptionSchema, type PrescriptionInput } from "@/types/prescription";

export function validatePrescription(input: PrescriptionInput): PrescriptionInput {
  return prescriptionSchema.parse(input);
}

export function notImplementedYet(): never {
  throw new Error("Not implemented yet");
}
