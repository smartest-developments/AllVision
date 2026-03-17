import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

describe("LanguageSwitcher", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("highlights current locale and localizes label", async () => {
    vi.doMock("next/headers", () => ({
      cookies: () => ({ get: (k: string) => (k === "locale" ? { value: "it" } : undefined) }),
      headers: () => ({ get: () => null }),
    }));

    const Switcher = (await import("@/components/LanguageSwitcher")).default;
    const html = renderToStaticMarkup(await Switcher());

    expect(html).toContain("Lingua:");
    // The Italiano link should be bolded via font-semibold
    expect(html).toContain('>Italiano</a>');
    expect(html).toContain('class="underline font-semibold"');
  });
});

