import Link from "next/link";
import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { loadRpc } from "@/lib/rpc";
import { backend } from "@/lib/backend";
import { serverEnv } from "@/lib/env";
import { formatDate, formatDateTime, isIsoDate } from "@/lib/dates";
import { PERMISSION_LABEL } from "@/lib/permissions";
import { AUDIT_ACTION_LABEL, AUDIT_GROUPS, describeAudit } from "@/lib/audit-labels";
import type { AdminUser, AuditRow, RbacRole } from "@/lib/types";
import { Badge, Card, EmptyState, Input, Money, PageHeader, Pagination, Select, cx } from "@/components/ui";
import { Avatar } from "@/components/avatar";
import { CreateUserForm } from "./create-user-form";
import { UserActions } from "./user-actions";
import { UserRoles } from "./user-roles";
import { RoleEditor } from "./role-editor";

export const metadata: Metadata = { title: "Quản trị người dùng" };

const TABS = [
  { key: "roles", label: "Vai trò" },
  { key: "users", label: "Người dùng" },
  { key: "log", label: "Log" },
] as const;
type Tab = (typeof TABS)[number]["key"];
const LOG_PAGE = 50;

type SP = { tab?: string; actor?: string; from?: string; to?: string; action?: string; page?: string };

export default async function UsersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await requirePermission("users.manage");
  const sp = await searchParams;
  const tab: Tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as Tab) : "users";

  return (
    <>
      <PageHeader back="/settings" backLabel="Quay lại Cài đặt" backMobileOnly title="Quản trị người dùng"
        subtitle="Phân quyền theo vai trò: tạo vai trò (nhóm quyền), rồi gán người dùng vào vai trò." />
      <nav aria-label="Quản trị người dùng" className="mb-4 grid max-w-md grid-cols-3 gap-1 rounded-xl border border-line bg-surface p-1">
        {TABS.map((t) => (
          <Link key={t.key} href={`/admin/users?tab=${t.key}`} aria-current={t.key === tab ? "page" : undefined}
            className={cx("flex min-h-11 items-center justify-center rounded-lg text-sm", t.key === tab ? "bg-brand font-semibold text-brand-ink" : "text-muted hover:bg-bg")}>
            {t.label}
          </Link>
        ))}
      </nav>
      {tab === "roles" ? <RolesTab /> : tab === "log" ? <LogTab sp={sp} /> : <UsersTab meId={me.id} />}
    </>
  );
}

async function RolesTab() {
  const roles = await loadRpc<RbacRole[]>("admin_list_roles");
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="order-2 space-y-3 lg:order-1">
        {roles.map((r) => (
          <Card key={r.id}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="font-semibold">{r.name} {r.is_system && <Badge tone="brand">Hệ thống</Badge>}</h2>
                {r.description && <p className="text-sm text-muted">{r.description}</p>}
              </div>
              <span className="text-sm text-muted">{r.users.length} người</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {r.permissions.length === 0 ? <span className="text-sm text-muted">Chưa có quyền</span>
                : r.permissions.map((p) => <span key={p} className="rounded-full bg-brand-soft px-2.5 py-0.5 text-sm">{PERMISSION_LABEL[p] ?? p}</span>)}
            </div>
            {r.users.length > 0 && <p className="mt-2 text-sm"><span className="text-muted">Thành viên:</span> {r.users.map((u) => u.display_name).join(" · ")}</p>}
            <details className="mt-2">
              <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-medium text-brand">Sửa vai trò</summary>
              <div className="mt-2 rounded-lg border border-line p-3"><RoleEditor role={r} /></div>
            </details>
          </Card>
        ))}
      </div>
      <Card title="Tạo vai trò" className="order-1 lg:order-2"><RoleEditor /></Card>
    </div>
  );
}

async function UsersTab({ meId }: { meId: string }) {
  const [users, roles, auth] = await Promise.all([
    loadRpc<AdminUser[]>("admin_list_users"),
    loadRpc<RbacRole[]>("admin_list_roles"),
    backend().then((b) => b.admin.listAuthUsers()),
  ]);
  const authById = new Map(auth.users.map((a) => [a.id, a]));
  const rolesOf = new Map<string, string[]>();
  for (const r of roles) for (const u of r.users) rolesOf.set(u.id, [...(rolesOf.get(u.id) ?? []), r.id]);
  const roleList = roles.map((r) => ({ id: r.id, name: r.name }));
  const pw = serverEnv.defaultPassword();

  return (
    <>
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
                    <div className="flex min-w-0 items-start gap-2.5">
                      <Avatar name={u.display_name} src={u.avatar} size={36} />
                      <div className="min-w-0">
                        <p className="font-medium">{u.display_name} <span className="text-sm text-muted">@{u.username} · {u.employee_code}</span></p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {u.status === "DISABLED" ? <Badge tone="danger">Đã khóa</Badge> : <Badge tone="ok">Hoạt động</Badge>}
                          {u.must_change_password && serverEnv.forcePasswordChange() && <Badge tone="warn">Chờ đổi MK</Badge>}
                          {!auth.error && !a && <Badge tone="danger">Không có tài khoản đăng nhập</Badge>}
                          {a && !a.confirmed && <Badge tone="danger">Chưa kích hoạt</Badge>}
                          {a?.banned && <Badge tone="danger">Bị chặn đăng nhập</Badge>}
                        </div>
                        {a?.last_sign_in_at && <p className="mt-1 text-xs text-muted">Đăng nhập lần cuối {formatDate(a.last_sign_in_at.slice(0, 10))}</p>}
                      </div>
                    </div>
                    <span className="text-right text-sm">Số dư<br /><Money value={u.balance_vnd} sign className="font-semibold" /></span>
                  </div>
                  <UserRoles userId={u.id} roles={roleList} selected={rolesOf.get(u.id) ?? []} />
                  {u.id !== meId && <UserActions user={u} defaultPassword={pw} />}
                </li>
              );
            })}
          </ul>
        </Card>
        <Card title="Tạo người dùng" className="order-1 lg:order-2"><CreateUserForm defaultPassword={pw} /></Card>
      </div>
    </>
  );
}

async function LogTab({ sp }: { sp: SP }) {
  const actor = sp.actor && /^[0-9a-f-]{36}$/i.test(sp.actor) ? sp.actor : "";
  const from = isIsoDate(sp.from) ? sp.from : "";
  const to = isIsoDate(sp.to) ? sp.to : "";
  const action = AUDIT_GROUPS.some((g) => g.prefix === sp.action) ? sp.action! : "";
  const page = Math.max(1, Number(sp.page) || 1);
  const [users, log] = await Promise.all([
    loadRpc<AdminUser[]>("admin_list_users"),
    loadRpc<{ total: number; rows: AuditRow[] }>("admin_list_audit", {
      p_actor: actor || null, p_from: from || null, p_to: to || null, p_action: action || null,
      p_limit: LOG_PAGE, p_offset: (page - 1) * LOG_PAGE,
    }),
  ]);
  const qs = (p: number) => {
    const s = new URLSearchParams({ tab: "log", ...(actor && { actor }), ...(from && { from }), ...(to && { to }), ...(action && { action }), page: String(p) });
    return `/admin/users?${s}`;
  };

  return (
    <div className="space-y-3">
      <form action="/admin/users" className="grid gap-2 rounded-xl border border-line bg-surface p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_9.5rem_9.5rem_auto] sm:items-end">
        <input type="hidden" name="tab" value="log" />
        <label className="text-sm">Người dùng
          <Select name="actor" defaultValue={actor} className="mt-1">
            <option value="">Tất cả</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.display_name} (@{u.username})</option>)}
          </Select>
        </label>
        <label className="text-sm">Loại hành động
          <Select name="action" defaultValue={action} className="mt-1">
            <option value="">Tất cả</option>
            {AUDIT_GROUPS.map((g) => <option key={g.prefix} value={g.prefix}>{g.label}</option>)}
          </Select>
        </label>
        <label className="text-sm">Từ ngày<Input type="date" name="from" defaultValue={from} className="mt-1" /></label>
        <label className="text-sm">Đến ngày<Input type="date" name="to" defaultValue={to} className="mt-1" /></label>
        <button className="min-h-11 rounded-lg bg-brand px-4 font-semibold text-brand-ink">Lọc</button>
      </form>

      <Card title={`${log.total.toLocaleString("vi-VN")} hành động`}>
        {log.rows.length === 0 ? <EmptyState title="Chưa có hành động nào" /> : (
          <>
            <ul className="divide-y divide-line">
              {log.rows.map((r) => {
                const detail = describeAudit(r);
                return (
                  <li key={r.id} className="flex items-start gap-3 py-2.5">
                    <time dateTime={r.occurred_at} className="w-24 shrink-0 text-sm tabular-nums text-muted">{formatDateTime(r.occurred_at, true)}</time>
                    <div className="min-w-0">
                      <p className="text-sm">
                        <strong>{r.actor ? r.actor.display_name : "Hệ thống"}</strong>
                        {r.actor && <span className="text-muted"> @{r.actor.username}</span>}
                        {" · "}<span className="font-medium text-brand">{AUDIT_ACTION_LABEL[r.action] ?? r.action}</span>
                      </p>
                      {detail && <p className="break-words text-sm text-muted">{detail}</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
            <Pagination page={page} total={log.total} pageSize={LOG_PAGE} hrefFor={qs} />
          </>
        )}
      </Card>
    </div>
  );
}
