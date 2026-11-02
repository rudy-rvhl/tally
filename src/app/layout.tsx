import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "LedgerIQ", template: "%s · LedgerIQ" },
  description: "Understand your company's finances at a glance.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1d4ed8" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-CA">
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
