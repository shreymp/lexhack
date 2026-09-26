import type { Metadata } from "next";
import { APP_NAME, APP_TAGLINE } from "@/lib/config";
import "./globals.css";

// No next/font here on purpose: the build environment cannot reach Google Fonts.
// We rely on a system font stack defined in globals.css instead.

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_TAGLINE,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
