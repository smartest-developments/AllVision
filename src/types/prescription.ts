import { z } from "zod";

const eyeSchema = z.object({
  sphere: z.number().min(-20).max(20),
  cylinder: z.number().min(-10).max(10).optional(),
  axis: z.number().int().min(0).max(180).optional(),
  add: z.number().min(0).max(4).optional(),
  prism: z.number().min(0).max(10).optional()
});

export const prescriptionSchema = z.object({
  leftEye: eyeSchema,
  rightEye: eyeSchema,
  pupillaryDistance: z.number().min(40).max(80),
  notes: z.string().max(2000).optional()
});

export type PrescriptionInput = z.infer<typeof prescriptionSchema>;
