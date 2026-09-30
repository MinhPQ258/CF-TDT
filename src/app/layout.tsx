import type { Metadata, Viewport } from "next";
import "@fontsource/be-vietnam-pro/400.css";
import "@fontsource/be-vietnam-pro/500.css";
import "@fontsource/be-vietnam-pro/600.css";
import "@fontsource/be-vietnam-pro/700.css";
import "./globals.css";
import { Suspense } from "react";
import { GlobalLoading } from "@/components/global-loading";

export const metadata: Metadata = {
  title: { default: "The 12A Coffee", template: "%s · The 12A Coffee" },
  description: "Vote pha cà phê chung và quỹ cà phê nội bộ",
  robots: { index: false, follow: false },
  // Tên + icon khi "Thêm vào MH chính" trên iOS (icon: src/app/apple-icon.png)
  applicationName: "12A Coffee",
  appleWebApp: { capable: true, title: "12A Coffee", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#6f4428",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body className="min-h-dvh antialiased">
        {children}
        <Suspense fallback={null}><GlobalLoading /></Suspense>
      </body>
    </html>
  );
}
