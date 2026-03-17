import { describe, it, expect } from "vitest";
import { getLocaleFromAcceptLanguage } from "@/i18n";

describe("i18n locale resolution", () => {
  it("returns 'it' when Accept-Language prefers Italian", () => {
    expect(getLocaleFromAcceptLanguage("it-IT,it;q=0.9,en;q=0.8")).toBe("it");
  });

  it("falls back to 'en' when header missing", () => {
    expect(getLocaleFromAcceptLanguage(null)).toBe("en");
    expect(getLocaleFromAcceptLanguage(undefined)).toBe("en");
  });

  it("falls back to 'en' when Italian is not present", () => {
    expect(getLocaleFromAcceptLanguage("en-US,en;q=0.9")).toBe("en");
  });
});

