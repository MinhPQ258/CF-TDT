import Link from "next/link";
import type { ReactNode } from "react";
import type { Me } from "@/lib/types";
import { NavLinks, type NavItem } from "@/components/nav-links";
import { logoutAction } from "@/features/auth/actions";

export const MEMBER_NAV: NavItem[] = [
  { href: "/", label: "Pha", icon: "cup" },
  { href: "/me", label: "Số dư", icon: "wallet" },
  { href: "/purchases", label: "Phiếu mua", icon: "receipt" },
];

export const ADMIN_NAV: NavItem[] = [
  { href: "/admin/votes", label: "Đợt pha", icon: "cup" },
  { href: "/admin/dashboard", label: "Tổng quan", icon: "chart" },
  { href: "/admin/purchases", label: "Mua đồ", icon: "receipt" },
  { href: "/admin/fund", label: "Sổ quỹ", icon: "wallet" },
  { href: "/admin/memberships", label: "Thành viên quỹ", icon: "users" },
  { href: "/admin/users", label: "Tài khoản", icon: "user" },
  { href: "/admin/reports", label: "Báo cáo", icon: "table" },
  { href: "/admin/import-export", label: "Excel", icon: "file" },
  { href: "/admin/health", label: "Sức khỏe sổ", icon: "pulse" },
];

/**
 * Desktop (≥ lg): thanh điều hướng bên. Mobile: thanh trên gọn + bottom nav (≤ 4 mục),
 * admin có menu "Thêm" dạng <details> cho các mục còn lại.
 */
export function AppShell({ me, nav, children, area }: { me: Me; nav: NavItem[]; children: ReactNode; area: "member" | "admin" }) {
  const primary = nav.slice(0, 3);
  const secondary = nav.slice(3);
  return (
    <div className="lg:flex">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-surface lg:flex">
        <div className="border-b border-line p-4">
          <Link href="/" className="text-lg font-bold text-brand">Coffee TDT</Link>
          <p className="mt-1 truncate text-sm text-muted">{me.display_name}</p>
        </div>
        <nav className="flex-1 overflow-y-auto p-2" aria-label="Điều hướng chính">
          <NavLinks items={nav} variant="side" />
          {me.role === "ADMIN" && (
            <div className="mt-4 border-t border-line pt-2">
              <p className="px-3 py-1 text-xs font-semibold uppercase text-muted">{area === "admin" ? "Thành viên" : "Quản trị"}</p>
              <NavLinks items={area === "admin" ? MEMBER_NAV : ADMIN_NAV.slice(0, 1)} variant="side" />
            </div>
          )}
        </nav>
        <div className="border-t border-line p-2">
          <NavLinks items={[{ href: "/change-password", label: "Đổi mật khẩu", icon: "key" }]} variant="side" />
          <form action={logoutAction}>
            <button className="flex min-h-11 w-full items-center rounded-lg px-3 text-left hover:bg-brand-soft">Đăng xuất</button>
          </form>
        </div>
      </aside>

      <header className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-line bg-surface/95 px-4 py-2 backdrop-blur lg:hidden">
        <Link href="/" className="font-bold text-brand">Coffee TDT</Link>
        <details className="relative">
          <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-lg px-3 hover:bg-brand-soft" aria-label="Mở menu">
            <span className="max-w-[10rem] truncate text-sm">{me.display_name}</span> <span aria-hidden className="ml-1">☰</span>
          </summary>
          <div className="absolute right-0 mt-1 w-64 rounded-xl border border-line bg-surface p-2 shadow-lg">
            {secondary.length > 0 && <NavLinks items={secondary} variant="side" />}
            {me.role === "ADMIN" && (
              <>
                <p className="px-3 pt-2 text-xs font-semibold uppercase text-muted">{area === "admin" ? "Thành viên" : "Quản trị"}</p>
                <NavLinks items={area === "admin" ? MEMBER_NAV : [ADMIN_NAV[0]]} variant="side" />
              </>
            )}
            <div className="mt-2 border-t border-line pt-2">
              <NavLinks items={[{ href: "/change-password", label: "Đổi mật khẩu", icon: "key" }]} variant="side" />
              <form action={logoutAction}>
                <button className="flex min-h-11 w-full items-center rounded-lg px-3 text-left hover:bg-brand-soft">Đăng xuất</button>
              </form>
            </div>
          </div>
        </details>
      </header>

      <main className="pb-safe mx-auto w-full max-w-6xl flex-1 px-4 py-4 sm:px-6 lg:py-6 lg:pb-8">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="Điều hướng nhanh">
        <NavLinks items={primary} variant="bottom" />
      </nav>
    </div>
  );
}
