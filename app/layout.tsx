import type { Metadata, Viewport } from "next";
import "./globals.css";
import "@/server/env";
import { getRequestLocale } from "@/i18n";

export const metadata: Metadata = {
  title: "AllVision",
  description: "Informational lens sourcing reports for EU + Switzerland"
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover'
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getRequestLocale();
  return (
    <html lang={locale}>
      <body>{children}</body>
    </html>
  );
}
