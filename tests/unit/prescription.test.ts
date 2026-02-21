import { describe, expect, it } from "vitest";
import { prescriptionSchema } from "@/types/prescription";

describe("prescription schema", () => {
  it("accepts a valid prescription payload", () => {
    const result = prescriptionSchema.safeParse({
      leftEye: { sphere: -1.25, cylinder: -0.5, axis: 90 },
      rightEye: { sphere: -1.0, cylinder: -0.25, axis: 80 },
      pupillaryDistance: 63
    });

    expect(result.success).toBe(true);
  });
});
