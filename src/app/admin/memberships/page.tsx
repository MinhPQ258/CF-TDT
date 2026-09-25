import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { loadRpc } from "@/lib/rpc";
import { formatDate } from "@/lib/dates";
import type { AdminUser, Membership } from "@/lib/types";
import { Badge, Card, EmptyState, PageHeader, Truncate } from "@/components/ui";
import { MembershipForm } from "./membership-form";

export const metadata: Metadata = { title: "Thành viên quỹ" };

export default async function MembershipsPage() {
  await requireAdmin();
  const [rows, users] = await Promise.all([
    loadRpc<Membership[]>("admin_list_memberships", {}),
    loadRpc<AdminUser[]>("admin_list_users"),
  ]);
  const options = users.map((u) => ({ id: u.id, label: `${u.employee_code} · ${u.display_name}` }));

  return (
    <>
      <PageHeader title="Thành viên quỹ" subtitle="Khoảng tham gia [ngày bắt đầu, ngày kết thúc): vào ngày D bị chia phiếu ngày D, rời ngày D thì không." />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <Card title="Lịch sử tham gia" className="order-2 lg:order-1">
          {rows.length === 0 ? (
            <EmptyState title="Quỹ chưa có thành viên">Thêm thành viên trước khi ghi phiếu mua hoặc tiền cho thêm.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((m) => (
                <li key={m.id} className="py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">{m.display_name} <span className="text-sm text-muted">{m.employee_code}</span></p>
                      <p className="text-sm">{formatDate(m.start_date)} → {m.end_date ? formatDate(m.end_date) : "nay"}</p>
                      <div className="text-sm text-muted"><Truncate text={`Lý do: ${m.reason}`} /></div>
                    </div>
                    {m.is_active_today ? <Badge tone="ok">Đang tham gia</Badge> : <Badge>Không hiệu lực hôm nay</Badge>}
                  </div>
                  <details className="mt-1">
                    <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm text-brand">Sửa / đóng membership…</summary>
                    <div className="mt-2 rounded-lg bg-bg p-3">
                      <MembershipForm membership={m} users={options} />
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Thêm vào quỹ" className="order-1 lg:order-2"><MembershipForm users={options} /></Card>
      </div>
    </>
  );
}
