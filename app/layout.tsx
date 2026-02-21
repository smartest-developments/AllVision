import type { Metadata } from "next";
import "./globals.css";
import "@/server/env";

export const metadata: Metadata = {
  title: "AllVision",
  description: "Informational lens sourcing reports for EU + Switzerland"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
