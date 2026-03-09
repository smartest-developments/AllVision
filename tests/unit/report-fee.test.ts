import { describe, expect, it } from "vitest";

import { formatReportFeeSummary } from "@/lib/report-fee";

describe("formatReportFeeSummary", () => {
  it("formats report fee amount when cents are provided", () => {
    expect(formatReportFeeSummary({ currency: "EUR", feeCents: 1990 })).toBe("EUR 19.90");
  });

  it("returns deterministic pending-pricing copy when fee cents are unavailable", () => {
    expect(formatReportFeeSummary({ currency: "EUR", feeCents: null })).toBe("EUR pending pricing");
  });
});
