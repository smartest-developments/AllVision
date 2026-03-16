import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  i18n: {
    locales: ["en", "it"],
    defaultLocale: "en",
  },
};

export default nextConfig;
