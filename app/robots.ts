import type { MetadataRoute } from "next";

// Robots policy: disallow indexing globally, explicitly allow the preview path.
// The preview page itself also sets meta robots noindex for belt-and-suspenders safety.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        disallow: "/",
        allow: ["/public-preview"],
      },
    ],
  };
}

