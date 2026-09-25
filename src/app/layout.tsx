import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Coffee TDT", template: "%s · Coffee TDT" },
  description: "Vote pha cà phê chung và quỹ cà phê nội bộ",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#6f4428",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
