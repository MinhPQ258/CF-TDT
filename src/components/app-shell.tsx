import Link from "next/link";
import type { ReactNode } from "react";
import type { Me } from "@/lib/types";
import { BottomTabs, NavLinks, type NavItem, type TabItem } from "@/components/nav-links";
import { logoutAction } from "@/features/auth/actions";
import { Avatar } from "@/components/avatar";

export const MEMBER_NAV: NavItem[] = [
  { href: "/", label: "Pha", icon: "cup" },
  { href: "/votes/new", label: "Tạo đợt pha", icon: "plus" },
  { href: "/me", label: "Quỹ", icon: "wallet" },
  { href: "/purchases", label: "Phiếu mua", icon: "receipt" },
];

export const ADMIN_NAV: NavItem[] = [
  { href: "/admin/votes", label: "Đợt pha", icon: "cup" },
  { href: "/admin/dashboard", label: "Tổng quan quỹ", icon: "chart" },
  { href: "/admin/purchases", label: "Mua đồ", icon: "receipt" },
  { href: "/admin/fund", label: "Sổ quỹ", icon: "wallet" },
  { href: "/admin/users", label: "Quản trị người dùng", icon: "user" },
  { href: "/admin/reports", label: "Báo cáo", icon: "table" },
  { href: "/admin/import-export", label: "Excel", icon: "file" },
  { href: "/admin/health", label: "Sức khỏe sổ", icon: "pulse" },
];

/** Thanh tab dưới (mobile) theo vai trò: Vote · Quỹ · ＋ · Mua đồ · Cài đặt */
export function bottomTabs(me: Me): TabItem[] {
  const admin = me.role === "ADMIN";
  return [
    admin
      ? { href: "/admin/votes", label: "Vote", icon: "cup", match: ["/admin/votes", "/votes", "/"] }
      : { href: "/", label: "Vote", icon: "cup", match: ["/", "/votes"] },
    admin
      ? { href: "/me", label: "Quỹ", icon: "wallet", match: ["/me", "/admin/dashboard", "/admin/fund"] }
      : { href: "/me", label: "Quỹ", icon: "wallet" },
    { href: "/votes/new", label: "Tạo đợt vote", icon: "plus", primary: true, match: ["/votes/new"] },
    admin
      ? { href: "/admin/purchases", label: "Mua đồ", icon: "receipt", match: ["/admin/purchases", "/purchases"] }
      : { href: "/purchases", label: "Mua đồ", icon: "receipt" },
    { href: "/settings", label: "Cài đặt", icon: "gear",
      match: ["/settings", "/change-password", "/admin/users", "/admin/reports", "/admin/import-export", "/admin/health"] },
  ];
}

/**
 * Desktop (≥ lg): thanh điều hướng bên. Mobile: thanh trên gọn + 5 tab dưới (Cài đặt thay cho menu ☰ cũ).
 */
export function AppShell({ me, nav, children, area }: { me: Me; nav: NavItem[]; children: ReactNode; area: "member" | "admin" }) {
  return (
    <div className="lg:flex">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-surface lg:flex">
        <div className="border-b border-line p-4">
          <Link href="/" className="flex items-center gap-2 text-lg font-bold text-brand">
            {/* eslint-disable-next-line @next/next/no-img-element -- logo tĩnh */}
            <img src="/logo.webp" alt="" width={40} height={40} className="size-10 rounded-full" />
            The 12A Coffee
          </Link>
          <Link href="/settings" className="mt-2 flex items-center gap-2 rounded-lg text-sm text-muted hover:text-ink">
            <Avatar name={me.display_name} src={me.avatar} size={28} />
            <span className="truncate">{me.display_name}</span>
          </Link>
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

      <header className="sticky top-0 z-20 flex min-h-14 items-center justify-between gap-2 border-b border-line bg-surface/95 px-4 py-2 backdrop-blur lg:hidden">
        <Link href="/" className="flex items-center gap-2 font-bold text-brand">
          {/* eslint-disable-next-line @next/next/no-img-element -- logo tĩnh */}
          <img src="/logo.webp" alt="" width={36} height={36} className="size-9 rounded-full" />
          The 12A Coffee
        </Link>
        <Link href="/settings" className="flex min-h-11 max-w-[12rem] items-center gap-2 rounded-lg px-2 text-sm hover:bg-brand-soft" aria-label="Cài đặt tài khoản">
          <span className="truncate">{me.display_name}</span>
          <Avatar name={me.display_name} src={me.avatar} size={32} />
        </Link>
      </header>

      <main className="pb-safe mx-auto w-full max-w-6xl flex-1 px-4 py-4 sm:px-6 lg:py-6 lg:pb-8">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="Điều hướng nhanh">
        <BottomTabs items={bottomTabs(me)} />
      </nav>
    </div>
  );
}
