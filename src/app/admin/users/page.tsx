import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { loadRpc } from "@/lib/rpc";
import { backend } from "@/lib/backend";
import { serverEnv } from "@/lib/env";
import { formatDate } from "@/lib/dates";
import type { AdminUser } from "@/lib/types";
import { Badge, Card, Money, PageHeader } from "@/components/ui";
import { CreateUserForm } from "./create-user-form";
import { UserActions } from "./user-actions";

export const metadata: Metadata = { title: "Quản trị người dùng" };

export default async function UsersPage() {
  const me = await requireAdmin();
  const [users, auth] = await Promise.all([
    loadRpc<AdminUser[]>("admin_list_users"),
    backend().then((b) => b.admin.listAuthUsers()),
  ]);
  const authById = new Map(auth.users.map((a) => [a.id, a]));
  return (
    <>
      <PageHeader back="/settings" backLabel="Quay lại Cài đặt" backMobileOnly title="Quản trị người dùng" subtitle={`Đăng nhập bằng username. Người dùng mới và người được cấp lại mật khẩu dùng mật khẩu mặc định ${serverEnv.defaultPassword()}.`} />
      {auth.error && (
        <p className="mb-4 rounded-lg bg-warn-soft p-3 text-sm">Không đọc được danh sách đăng nhập (mã {auth.error.code ?? auth.error.status ?? "?"}) — kiểm tra SUPABASE_SERVICE_ROLE_KEY.</p>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card title={`${users.length} người dùng`} className="order-2 lg:order-1">
          <ul className="divide-y divide-line">
            {users.map((u) => {
              const a = authById.get(u.id);
              return (
              <li key={u.id} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{u.display_name} <span className="text-sm text-muted">@{u.username} · {u.employee_code}</span></p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {u.role === "ADMIN" && <Badge tone="brand">Quản trị</Badge>}
                      {u.status === "DISABLED" ? <Badge tone="danger">Đã khóa</Badge> : <Badge tone="ok">Hoạt động</Badge>}
                      {u.must_change_password && serverEnv.forcePasswordChange() && <Badge tone="warn">Chờ đổi MK</Badge>}
                      {!auth.error && !a && <Badge tone="danger">Không có tài khoản đăng nhập</Badge>}
                      {a && !a.confirmed && <Badge tone="danger">Chưa kích hoạt</Badge>}
                      {a?.banned && <Badge tone="danger">Bị chặn đăng nhập</Badge>}
                    </div>
                    {a?.last_sign_in_at && <p className="mt-1 text-xs text-muted">Đăng nhập lần cuối {formatDate(a.last_sign_in_at.slice(0, 10))}</p>}
                  </div>
                  <span className="text-right text-sm">Số dư<br /><Money value={u.balance_vnd} sign className="font-semibold" /></span>
                </div>
                {u.id !== me.id && <UserActions user={u} defaultPassword={serverEnv.defaultPassword()} />}
              </li>
              );
            })}
          </ul>
        </Card>
        <Card title="Tạo người dùng" className="order-1 lg:order-2"><CreateUserForm defaultPassword={serverEnv.defaultPassword()} /></Card>
      </div>
    </>
  );
}
