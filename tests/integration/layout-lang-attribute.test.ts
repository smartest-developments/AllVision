import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RootLayout from "../../app/layout";

// Helper to render the layout with arbitrary children
async function renderLayoutWith(child: React.ReactNode) {
  // `RootLayout` is an async server component
  return renderToStaticMarkup(await RootLayout({ children: child } as any));
}

describe("RootLayout html lang attribute", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("sets html lang to 'it' when Accept-Language prefers Italian and no cookie is set", async () => {
    vi.doMock("next/headers", () => ({
      cookies: () => ({ get: (_: string) => undefined }),
      headers: () => ({ get: (k: string) => (k.toLowerCase() === "accept-language" ? "it-IT,it;q=0.9,en;q=0.8" : null) }),
    }));

    const Layout = (await import("../../app/layout")).default;
    const html = renderToStaticMarkup(await Layout({ children: null } as any));
    expect(html).toContain('<html lang="it">');
  });

  it("defaults to 'en' when neither cookie nor Italian preference exist", async () => {
    vi.doMock("next/headers", () => ({
      cookies: () => ({ get: (_: string) => undefined }),
      headers: () => ({ get: (k: string) => (k.toLowerCase() === "accept-language" ? "en-US,en;q=0.9" : null) }),
    }));

    const Layout = (await import("../../app/layout")).default;
    const html = renderToStaticMarkup(await Layout({ children: null } as any));
    expect(html).toContain('<html lang="en">');
  });
});

