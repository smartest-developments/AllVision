import { z } from "zod";

const EU_CH_COUNTRY_CODES = [
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
  "CH"
] as const;

const countryCodeSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toUpperCase() : value),
  z.enum(EU_CH_COUNTRY_CODES, {
    errorMap: () => ({ message: "Country must be in EU or Switzerland" })
  })
);

const eyeSchema = z
  .object({
    sphere: z.number().min(-20).max(20),
    cylinder: z.number().min(-10).max(10).optional(),
    axis: z.number().int().min(0).max(180).optional(),
    add: z.number().min(0).max(4).optional(),
    prism: z.number().min(0).max(10).optional()
  })
  .superRefine((value, ctx) => {
    if (value.cylinder !== undefined && value.axis === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Axis is required when cylinder is provided",
        path: ["axis"]
      });
    }

    if (value.axis !== undefined && value.cylinder === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Cylinder is required when axis is provided",
        path: ["cylinder"]
      });
    }
  });

export const prescriptionSchema = z.object({
  countryCode: countryCodeSchema,
  leftEye: eyeSchema,
  rightEye: eyeSchema,
  pupillaryDistance: z.number().min(40).max(80),
  notes: z.string().max(2000).optional()
});

export type PrescriptionInput = z.infer<typeof prescriptionSchema>;
