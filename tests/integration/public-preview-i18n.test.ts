import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import PublicPreviewPage from "../../app/public-preview/page";

describe("Public Preview i18n", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("renders Italian copy when locale cookie is 'it'", async () => {
    vi.doMock("next/headers", () => ({
      cookies: () => ({ get: (k: string) => (k === "locale" ? { value: "it" } : undefined) }),
      headers: () => ({ get: () => null }),
    }));

    const Page = (await import("../../app/public-preview/page")).default;
    const html = renderToStaticMarkup(await Page());

    // Italian subtitle fragment from src/i18n/it.ts
    expect(html).toContain("Demo in sola lettura");
  });
});

