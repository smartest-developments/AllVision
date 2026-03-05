import { describe, expect, it } from "vitest";
import { getLegalCopy, type LegalSurface } from "@/legal/disclaimers";

describe("legal disclaimers", () => {
  it.each<LegalSurface>(["intake", "request", "report_delivery"])(
    "returns standardized copy for %s",
    (surface) => {
      const legal = getLegalCopy(surface);

      expect(legal.title).toBe("Legal Notice");
      expect(legal.bullets).toHaveLength(3);
      expect(legal.surfaceNote.length).toBeGreaterThan(0);
    }
  );
});
