import { describe, expect, it } from "vitest";
import { prescriptionSchema } from "@/types/prescription";

describe("prescription schema", () => {
  it("accepts a valid prescription payload", () => {
    const result = prescriptionSchema.safeParse({
      countryCode: "DE",
      leftEye: { sphere: -1.25, cylinder: -0.5, axis: 90 },
      rightEye: { sphere: -1.0, cylinder: -0.25, axis: 80 },
      pupillaryDistance: 63
    });

    expect(result.success).toBe(true);
  });

  it("rejects payloads outside EU + Switzerland scope", () => {
    const result = prescriptionSchema.safeParse({
      countryCode: "US",
      leftEye: { sphere: -1.25 },
      rightEye: { sphere: -1.0 },
      pupillaryDistance: 63
    });

    expect(result.success).toBe(false);
  });

  it("requires axis when cylinder is present", () => {
    const result = prescriptionSchema.safeParse({
      countryCode: "FR",
      leftEye: { sphere: -1.25, cylinder: -0.5 },
      rightEye: { sphere: -1.0 },
      pupillaryDistance: 63
    });

    expect(result.success).toBe(false);
  });

  it("requires cylinder when axis is present", () => {
    const result = prescriptionSchema.safeParse({
      countryCode: "IT",
      leftEye: { sphere: -1.25, axis: 120 },
      rightEye: { sphere: -1.0 },
      pupillaryDistance: 63
    });

    expect(result.success).toBe(false);
  });

  it("rejects out-of-range optical values", () => {
    const result = prescriptionSchema.safeParse({
      countryCode: "CH",
      leftEye: { sphere: -25 },
      rightEye: { sphere: -1.0 },
      pupillaryDistance: 30
    });

    expect(result.success).toBe(false);
  });
});
