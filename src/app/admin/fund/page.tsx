import Link from "next/link";
import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { loadRpc } from "@/lib/rpc";
import { formatDate, isIsoDate } from "@/lib/dates";
import { EVENT_KIND_LABEL } from "@/lib/labels";
import type { AdminUser, EventKind, FundEvent, Paged } from "@/lib/types";
import { Badge, Card, EmptyState, Money, PageHeader, Pagination, Select, Table, cx } from "@/components/ui";
import { PeriodFilter } from "@/components/period-filter";
import { PersonMoneyForm } from "./person-money-form";
import { GiftForm } from "./gift-form";
import { DepositForm } from "./deposit-form";

export const metadata: Metadata = { title: "Sổ quỹ" };
const PAGE_SIZE = 30;
const FORMS = ["DEPOSIT", "GIFT", "REIMBURSEMENT"] as const;
type FormKind = (typeof FORMS)[number];
const FORM_LABEL: Record<FormKind, string> = { DEPOSIT: "Nộp quỹ", GIFT: "Tiền cho thêm", REIMBURSEMENT: "Hoàn tiền" };

export default async function FundPage({ searchParams }: {
  searchParams: Promise<{ form?: string; from?: string; to?: string; kind?: string; page?: string }>;
}) {
  await requirePermission("fund.manage");
  const sp = await searchParams;
  const form: FormKind = FORMS.includes(sp.form as FormKind) ? (sp.form as FormKind) : "DEPOSIT";
  const from = isIsoDate(sp.from) ? sp.from : "";
  const to = isIsoDate(sp.to) ? sp.to : "";
  const kind = sp.kind && sp.kind in EVENT_KIND_LABEL ? (sp.kind as EventKind) : "";
  const page = Math.max(1, Number(sp.page) || 1);
  const [events, users] = await Promise.all([
    loadRpc<Paged<FundEvent>>("admin_list_events", { p_from: from || null, p_to: to || null, p_kind: kind || null, p_limit: PAGE_SIZE, p_offset: (page - 1) * PAGE_SIZE }),
    loadRpc<AdminUser[]>("admin_list_users"),
  ]);
  const people = users.map((u) => ({ id: u.id, label: `${u.employee_code} · ${u.display_name}${u.status === "DISABLED" ? " (khóa)" : ""}`, balance: u.balance_vnd }));
  const qs = (p: Record<string, string | number>) => {
    const s = new URLSearchParams({ form, ...(from && { from }), ...(to && { to }), ...(kind && { kind }), ...Object.fromEntries(Object.entries(p).map(([k, v]) => [k, String(v)])) });
    return `/admin/fund?${s}`;
  };

  return (
    <>
      <PageHeader back="/settings" backLabel="Quay lại Cài đặt" backMobileOnly title="Sổ quỹ" subtitle="Chỉ ghi sau khi tiền thực đã nhận/trả. Sửa sai bằng giao dịch đảo, không sửa/xóa." />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="order-2 min-w-0 lg:order-1">
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <PeriodFilter from={from} to={to} action="/admin/fund" extra={
              <>
                <input type="hidden" name="form" value={form} />
                <label className="flex flex-col text-sm">Loại
                  <Select name="kind" defaultValue={kind} className="w-48">
                    <option value="">Tất cả</option>
                    {Object.entries(EVENT_KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </label>
              </>
            } />
          </div>
          {events.total === 0 ? (
            <EmptyState title="Chưa có giao dịch">Ghi tiền nộp đầu tiên ở khung bên cạnh.</EmptyState>
          ) : (
            <>
              <ul className="space-y-2 md:hidden">
                {events.rows.map((e) => (
                  <li key={e.id}>
                    <Link href={`/admin/fund/${e.id}`}>
                      <Card className="hover:border-brand">
                        <div className="flex justify-between gap-2">
                          <span className="font-medium">{EVENT_KIND_LABEL[e.kind]}{e.reverses_kind ? `: ${EVENT_KIND_LABEL[e.reverses_kind]}` : ""}</span>
                          <Money value={e.amount_vnd} tone={false} className="font-semibold" />
                        </div>
                        <p className="text-sm text-muted">{formatDate(e.occurred_on)}{e.subject ? ` · ${e.subject}` : ""}{e.external_ref ? ` · ${e.external_ref}` : ""}</p>
                        {e.status === "REVERSED" && <Badge tone="warn">Đã đảo</Badge>}
                      </Card>
                    </Link>
                  </li>
                ))}
              </ul>
              <Table className="hidden md:block">
                <thead><tr><th>Ngày</th><th>Loại</th><th>Người</th><th>Mã CT</th><th className="text-right">Số tiền</th><th className="text-right">Quỹ ±</th><th>Trạng thái</th></tr></thead>
                <tbody>
                  {events.rows.map((e) => (
                    <tr key={e.id}>
                      <td>{formatDate(e.occurred_on)}</td>
                      <td><Link className="text-brand underline" href={`/admin/fund/${e.id}`}>{EVENT_KIND_LABEL[e.kind]}</Link>{e.reverses_kind && <span className="text-muted"> ({EVENT_KIND_LABEL[e.reverses_kind]})</span>}</td>
                      <td className="max-w-40 truncate">{e.subject ?? (e.share_count ? `Chia ${e.share_count} người` : "—")}</td>
                      <td>{e.external_ref ?? "—"}</td>
                      <td className="text-right"><Money value={e.amount_vnd} tone={false} /></td>
                      <td className="text-right"><Money value={e.cash_delta_vnd} sign /></td>
                      <td>{e.status === "REVERSED" ? <Badge tone="warn">Đã đảo</Badge> : <Badge tone="ok">Đã ghi</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <Pagination page={page} total={events.total} pageSize={PAGE_SIZE} hrefFor={(p) => qs({ page: p })} />
            </>
          )}
        </div>
        <Card className="order-1 lg:order-2">
          <nav className="mb-4 grid grid-cols-3 gap-1 rounded-lg bg-bg p-1" aria-label="Loại giao dịch">
            {FORMS.map((f) => (
              <Link key={f} href={qs({ form: f })} aria-current={f === form ? "page" : undefined}
                className={cx("flex min-h-11 items-center justify-center rounded-md px-1 text-center text-sm", f === form ? "bg-surface font-semibold text-brand shadow-sm" : "text-muted")}>
                {FORM_LABEL[f]}
              </Link>
            ))}
          </nav>
          {form === "GIFT" ? <GiftForm />
            : form === "DEPOSIT" ? <DepositForm people={users.map((u) => ({ id: u.id, label: `${u.employee_code} · ${u.display_name}${u.status === "DISABLED" ? " (khóa)" : ""}`, balance: u.balance_vnd, disabled: u.status === "DISABLED" }))} />
            : <PersonMoneyForm key={form} kind={form} people={people} />}
        </Card>
      </div>
    </>
  );
}
