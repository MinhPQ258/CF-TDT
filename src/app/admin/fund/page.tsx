import Link from "next/link";
import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { loadRpc } from "@/lib/rpc";
import { formatDate, isIsoDate } from "@/lib/dates";
import { EVENT_KIND_LABEL } from "@/lib/labels";
import { can } from "@/lib/permissions";
import type { AdminUser, EventKind, FundEvent, Paged } from "@/lib/types";
import { Badge, Card, EmptyState, Money, PageHeader, Pagination, Select, Table, cx } from "@/components/ui";
import { PeriodFilter } from "@/components/period-filter";
import { DepositForm } from "./deposit-form";
import { PurchaseQuickForm } from "./purchase-quick-form";

export const metadata: Metadata = { title: "Sổ quỹ" };
const PAGE_SIZE = 30;

type Tab = "in" | "buy" | "log";
type SP = { tab?: string; from?: string; to?: string; kind?: string; page?: string };

/** Sổ quỹ: Tiền vào (nộp quỹ) · Mua sắm (quỹ trả) · Log (các giao dịch) */
export default async function FundPage({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await requirePermission("fund.manage", "purchases.manage");
  const sp = await searchParams;
  const tabs = [
    can(me, "fund.manage") && { key: "in" as const, label: "Tiền vào" },
    can(me, "purchases.manage") && { key: "buy" as const, label: "Mua sắm" },
    { key: "log" as const, label: "Log" },
  ].filter((x): x is { key: Tab; label: string } => Boolean(x));
  const tab: Tab = tabs.find((t) => t.key === sp.tab)?.key ?? tabs[0].key;

  return (
    <>
      <PageHeader back="/settings" backLabel="Quay lại Cài đặt" backMobileOnly title="Sổ quỹ"
        subtitle="Chỉ ghi khi tiền thực đã nhận/chi. Ghi nhầm thì đảo giao dịch ở tab Log." />
      <nav aria-label="Sổ quỹ" className={cx("mb-4 grid max-w-md gap-1 rounded-xl border border-line bg-surface p-1", tabs.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
        {tabs.map((t) => (
          <Link key={t.key} href={`/admin/fund?tab=${t.key}`} aria-current={t.key === tab ? "page" : undefined}
            className={cx("flex min-h-11 items-center justify-center rounded-lg text-sm", t.key === tab ? "bg-brand font-semibold text-brand-ink" : "text-muted hover:bg-bg")}>
            {t.label}
          </Link>
        ))}
      </nav>
      {tab === "in" ? <InTab /> : tab === "buy" ? <BuyTab /> : <LogTab sp={sp} />}
    </>
  );
}

async function InTab() {
  const users = await loadRpc<AdminUser[]>("admin_list_users");
  const people = users.map((u) => ({ id: u.id, label: `${u.display_name}${u.status === "DISABLED" ? " (khóa)" : ""}`, disabled: u.status === "DISABLED" }));
  return <Card className="max-w-xl"><DepositForm people={people} /></Card>;
}

function BuyTab() {
  return <Card className="max-w-xl"><PurchaseQuickForm /></Card>;
}

async function LogTab({ sp }: { sp: SP }) {
  const from = isIsoDate(sp.from) ? sp.from : "";
  const to = isIsoDate(sp.to) ? sp.to : "";
  const kind = sp.kind && sp.kind in EVENT_KIND_LABEL ? (sp.kind as EventKind) : "";
  const page = Math.max(1, Number(sp.page) || 1);
  const events = await loadRpc<Paged<FundEvent>>("admin_list_events", {
    p_from: from || null, p_to: to || null, p_kind: kind || null, p_limit: PAGE_SIZE, p_offset: (page - 1) * PAGE_SIZE,
  });
  const qs = (p: number) => {
    const s = new URLSearchParams({ tab: "log", ...(from && { from }), ...(to && { to }), ...(kind && { kind }), page: String(p) });
    return `/admin/fund?${s}`;
  };

  return (
    <div className="min-w-0">
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <PeriodFilter from={from} to={to} action="/admin/fund" extra={
          <>
            <input type="hidden" name="tab" value="log" />
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
        <EmptyState title="Chưa có giao dịch">Ghi tiền vào hoặc mua sắm ở các tab bên cạnh.</EmptyState>
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
                    <p className="text-sm text-muted">{[formatDate(e.occurred_on), e.subject, e.note].filter(Boolean).join(" · ")}</p>
                    {e.status === "REVERSED" && <Badge tone="warn">Đã đảo</Badge>}
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
          <Table className="hidden md:block">
            <thead><tr><th>Ngày</th><th>Loại</th><th>Người / nội dung</th><th className="text-right">Số tiền</th><th className="text-right">Quỹ ±</th><th>Trạng thái</th></tr></thead>
            <tbody>
              {events.rows.map((e) => (
                <tr key={e.id}>
                  <td>{formatDate(e.occurred_on)}</td>
                  <td><Link className="text-brand underline" href={`/admin/fund/${e.id}`}>{EVENT_KIND_LABEL[e.kind]}</Link>{e.reverses_kind && <span className="text-muted"> ({EVENT_KIND_LABEL[e.reverses_kind]})</span>}</td>
                  <td className="max-w-56 truncate">{[e.subject, e.note].filter(Boolean).join(" · ") || (e.share_count ? `Chia ${e.share_count} người` : "—")}</td>
                  <td className="text-right"><Money value={e.amount_vnd} tone={false} /></td>
                  <td className="text-right"><Money value={e.cash_delta_vnd} sign /></td>
                  <td>{e.status === "REVERSED" ? <Badge tone="warn">Đã đảo</Badge> : <Badge tone="ok">Đã ghi</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={page} total={events.total} pageSize={PAGE_SIZE} hrefFor={qs} />
        </>
      )}
    </div>
  );
}
