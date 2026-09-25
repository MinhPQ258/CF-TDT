import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { loadRpc } from "@/lib/rpc";
import { formatDate } from "@/lib/dates";
import type { AdminUser } from "@/lib/types";
import { Badge, Card, Money, PageHeader } from "@/components/ui";
import { CreateUserForm } from "./create-user-form";
import { UserActions } from "./user-actions";

export const metadata: Metadata = { title: "Tài khoản" };

export default async function UsersPage() {
  const me = await requireAdmin();
  const users = await loadRpc<AdminUser[]>("admin_list_users");
  return (
    <>
      <PageHeader title="Tài khoản" subtitle="Không có đăng ký công khai. Mật khẩu tạm hiển thị một lần, người dùng bắt buộc đổi khi đăng nhập." />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card title={`${users.length} tài khoản`} className="order-2 lg:order-1">
          <ul className="divide-y divide-line">
            {users.map((u) => (
              <li key={u.id} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{u.display_name} <span className="text-sm text-muted">@{u.username} · {u.employee_code}</span></p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {u.role === "ADMIN" && <Badge tone="brand">Quản trị</Badge>}
                      {u.status === "DISABLED" ? <Badge tone="danger">Đã khóa</Badge> : <Badge tone="ok">Hoạt động</Badge>}
                      {u.must_change_password && <Badge tone="warn">Chờ đổi MK</Badge>}
                      {u.current_membership ? <Badge>Quỹ từ {formatDate(u.current_membership.start_date)}</Badge> : <Badge>Không thuộc quỹ</Badge>}
                    </div>
                  </div>
                  <span className="text-right text-sm">Số dư<br /><Money value={u.balance_vnd} sign className="font-semibold" /></span>
                </div>
                {u.id !== me.id && <UserActions user={u} />}
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Tạo tài khoản" className="order-1 lg:order-2"><CreateUserForm /></Card>
      </div>
    </>
  );
}
