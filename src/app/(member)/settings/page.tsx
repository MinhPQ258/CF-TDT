import Link from "next/link";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { logoutAction } from "@/features/auth/actions";
import { Badge, Card, PageHeader } from "@/components/ui";
import { ADMIN_NAV } from "@/components/app-shell";
import { AvatarUploader } from "@/components/avatar-uploader";

export const metadata: Metadata = { title: "Cài đặt" };

/** Tab Cài đặt (thay cho menu ☰ cũ): tài khoản, đổi mật khẩu, đăng xuất; admin thêm các màn quản trị còn lại. */
export default async function SettingsPage() {
  const me = await requireUser();
  const admin = me.role === "ADMIN";
  // Các mục đã có tab riêng (Vote, Quỹ, Mua đồ) không lặp lại ở đây
  const inTabs = new Set(["/admin/votes", "/admin/dashboard", "/admin/purchases"]);
  const adminItems = ADMIN_NAV.filter((x) => !inTabs.has(x.href));
  const row = "flex min-h-12 items-center justify-between gap-3 px-4 hover:bg-bg";

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageHeader title="Cài đặt" />
      <Card>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-semibold">{me.display_name}</p>
            <p className="text-sm text-muted">@{me.username} · {me.employee_code}</p>
          </div>
          {admin && <Badge tone="brand">Quản trị</Badge>}
        </div>
        <div className="mt-3 border-t border-line pt-3">
          <AvatarUploader name={me.display_name} avatar={me.avatar ?? null} />
        </div>
      </Card>

      {admin && (
        <section className="overflow-hidden rounded-xl border border-line bg-surface">
          <h2 className="px-4 pb-1 pt-3 text-xs font-semibold uppercase text-muted">Quản trị</h2>
          <ul className="divide-y divide-line">
            {adminItems.map((x) => (
              <li key={x.href}><Link href={x.href} className={row}><span>{x.label}</span><span aria-hidden className="text-muted">›</span></Link></li>
            ))}
          </ul>
        </section>
      )}

      <section className="overflow-hidden rounded-xl border border-line bg-surface">
        <h2 className="px-4 pb-1 pt-3 text-xs font-semibold uppercase text-muted">{admin ? "Của tôi" : "Khác"}</h2>
        <ul className="divide-y divide-line">
          {admin && (
            <>
              <li><Link href="/me" className={row}><span>Số dư của tôi</span><span aria-hidden className="text-muted">›</span></Link></li>
              <li><Link href="/votes" className={row}><span>Các đợt pha</span><span aria-hidden className="text-muted">›</span></Link></li>
            </>
          )}
          {!admin && <li><Link href="/votes" className={row}><span>Các đợt pha</span><span aria-hidden className="text-muted">›</span></Link></li>}
          <li><Link href="/change-password" className={row}><span>Đổi mật khẩu</span><span aria-hidden className="text-muted">›</span></Link></li>
        </ul>
      </section>

      <form action={logoutAction}>
        <button className="min-h-12 w-full rounded-xl border border-line bg-surface font-medium text-danger hover:bg-danger-soft">Đăng xuất</button>
      </form>
    </div>
  );
}
