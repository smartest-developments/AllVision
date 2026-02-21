import { describe, expect, it } from "vitest";
import { validatePrescription } from "@/server/placeholders";

describe("sourcing request intake placeholder flow", () => {
  it("validates and returns canonical payload", () => {
    const payload = validatePrescription({
      countryCode: "NL",
      leftEye: { sphere: -2.0 },
      rightEye: { sphere: -1.75 },
      pupillaryDistance: 62
    });

    expect(payload.pupillaryDistance).toBe(62);
    expect(payload.leftEye.sphere).toBe(-2.0);
  });
});
