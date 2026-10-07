import Link from "next/link";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { loadRpc } from "@/lib/rpc";
import { formatDate } from "@/lib/dates";
import { formatVnd } from "@/lib/money";
import { can } from "@/lib/permissions";
import { ENTRY_TYPE_LABEL, EVENT_KIND_LABEL } from "@/lib/labels";
import type { AdminUser, FundEvent, FundSummary, LedgerRow, MyBalance, Paged } from "@/lib/types";
import { Badge, Money, PageHeader, cx } from "@/components/ui";
import { FundOverview } from "@/components/fund/fund-overview";
import { FundActivity } from "@/components/fund/fund-activity";
import { DepositForm } from "@/components/fund/deposit-form";
import { PurchaseForm } from "@/components/fund/purchase-form";

export const metadata: Metadata = { title: "Quỹ" };

type SP = { dir?: string; n?: string; ghi?: string };
const STEP = 20;

/**
 * Màn Quỹ (thiết kế 07/10): tổng quan → 2 thao tác (Ghi tiền vào / Ghi mua sắm, theo quyền) → Gần đây.
 * Mobile: thao tác mở màn riêng /fund/in, /fund/buy. Màn rộng: form nằm ngay cạnh danh sách.
 */
export default async function FundPage({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const dir = sp.dir === "in" || sp.dir === "out" ? sp.dir : "";
  const limit = Math.min(200, Math.max(STEP, Number(sp.n) || STEP));
  const canIn = can(me, "fund.manage");
  const canBuy = can(me, "purchases.manage");
  const ghi: "in" | "buy" = sp.ghi === "buy" && canBuy ? "buy" : canIn ? "in" : "buy";

  const [fund, activity, bal, ledger, users] = await Promise.all([
    loadRpc<FundSummary>("fund_summary"),
    loadRpc<Paged<FundEvent>>("fund_activity", { p_dir: dir ? dir.toUpperCase() : null, p_limit: limit, p_offset: 0 }),
    loadRpc<MyBalance>("my_balance"),
    loadRpc<Paged<LedgerRow>>("my_ledger", { p_limit: 30, p_offset: 0 }),
    canIn ? loadRpc<AdminUser[]>("admin_list_users") : Promise.resolve([] as AdminUser[]),
  ]);
  const people = users.map((u) => ({ id: u.id, name: u.display_name, disabled: u.status === "DISABLED" }));
  const href = (p: Partial<SP>) => {
    const s = new URLSearchParams({ ...(dir && { dir }), ...(sp.ghi && { ghi: sp.ghi }), ...Object.fromEntries(Object.entries(p).filter(([, v]) => v)) as Record<string, string> });
    const q = s.toString();
    return `/me${q ? `?${q}` : ""}`;
  };
  const filters = [{ key: "", label: "Tất cả" }, { key: "in", label: "Thu" }, { key: "out", label: "Chi" }];
  const b = bal.balance_vnd;

  return (
    <div className="mx-auto max-w-6xl space-y-4 lg:space-y-6">
      <PageHeader title="Quỹ" subtitle={`Cập nhật ${formatDate(fund.as_of)}`}
        actions={can(me, "reports.view") ? <Link href="/admin/dashboard" className="inline-flex min-h-11 items-center text-sm text-brand underline">Báo cáo quỹ →</Link> : undefined} />

      <FundOverview s={fund} />

      {(canIn || canBuy) && (
        <nav aria-label="Thao tác quỹ" className="grid grid-cols-2 gap-2.5 lg:hidden">
          {canIn && <ActionCard href="/fund/in" title="Ghi tiền vào" sub="Mọi người nộp quỹ" tone="in" />}
          {canBuy && <ActionCard href="/fund/buy" title="Ghi mua sắm" sub="Chi tiền quỹ đi mua" tone="out" />}
        </nav>
      )}

      <div className="flex flex-wrap items-start gap-6">
        {(canIn || canBuy) && (
          <section aria-labelledby="ghi" className="hidden min-w-0 flex-[1_1_22rem] space-y-4 rounded-[20px] border border-line bg-surface p-5 lg:block">
            <h2 id="ghi" className="text-lg font-semibold">Ghi giao dịch</h2>
            {canIn && canBuy && (
              <nav aria-label="Loại giao dịch" className="grid grid-cols-2 gap-1 rounded-[14px] bg-bg p-1">
                {(["in", "buy"] as const).map((k) => (
                  <Link key={k} href={href({ ghi: k })} aria-current={ghi === k ? "page" : undefined} scroll={false}
                    className={cx("flex min-h-11 items-center justify-center rounded-[10px]", ghi === k ? "bg-brand font-bold text-brand-ink" : "text-muted hover:bg-surface")}>
                    {k === "in" ? "Tiền vào" : "Mua sắm"}
                  </Link>
                ))}
              </nav>
            )}
            {ghi === "in" ? <DepositForm people={people} variant="panel" /> : <PurchaseForm cashBalance={fund.cash_balance_vnd} variant="panel" />}
          </section>
        )}

        <section aria-labelledby="gan-day" className="min-w-0 flex-[999_1_26rem] rounded-[20px] border border-line bg-surface px-4 pb-2 pt-1 lg:px-5">
          <div className="flex flex-wrap items-center justify-between gap-2 py-2.5">
            <h2 id="gan-day" className="text-base font-semibold lg:text-lg">Gần đây</h2>
            <nav aria-label="Lọc" className="flex gap-1 rounded-full bg-bg p-1">
              {filters.map((f) => (
                <Link key={f.key} href={href({ dir: f.key, n: "" })} aria-current={dir === f.key ? "page" : undefined} scroll={false}
                  className={cx("flex min-h-9 items-center rounded-full px-3.5 text-sm", dir === f.key ? "bg-surface font-semibold shadow-sm" : "text-muted")}>
                  {f.label}
                </Link>
              ))}
            </nav>
          </div>
          <FundActivity rows={activity.rows} linkable={canIn || canBuy} />
          {activity.total > activity.rows.length && (
            <Link href={href({ n: String(limit + STEP) })} scroll={false} className="flex min-h-11 items-center justify-center text-sm font-medium text-brand">
              Xem thêm ({activity.total - activity.rows.length})
            </Link>
          )}
        </section>
      </div>

      <details className="rounded-[20px] border border-line bg-surface px-4">
        <summary className="flex min-h-12 cursor-pointer items-center font-semibold">Tiền đóng của mỗi người ({fund.people.length})</summary>
        <ul className="divide-y divide-line/70 pb-2">
          {fund.people.map((p) => (
            <li key={p.user_id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 truncate">{p.display_name}{p.is_me && <span className="text-muted"> (bạn)</span>}</span>
              <span className={cx("num shrink-0 font-semibold", p.deposited_vnd === 0 && "font-normal text-muted")}>{formatVnd(p.deposited_vnd)}</span>
            </li>
          ))}
        </ul>
      </details>

      <details className="rounded-[20px] border border-line bg-surface px-4">
        <summary className="flex min-h-12 cursor-pointer items-center justify-between gap-2 font-semibold">
          <span>Số dư của tôi</span>
          <span className={cx("num", b < 0 ? "text-danger" : "text-ok")}>{b < 0 ? `cần nộp ${formatVnd(-b)}` : b > 0 ? `dư ${formatVnd(b)}` : "cân bằng"}</span>
        </summary>
        {ledger.rows.length === 0 ? <p className="pb-4 text-sm text-muted">Chưa có giao dịch.</p> : (
          <ul className="divide-y divide-line/70 pb-2">
            {ledger.rows.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="font-medium">{ENTRY_TYPE_LABEL[r.entry_type]}{r.is_reversal && <> <Badge tone="warn">Đảo</Badge></>}</p>
                  <p className="text-sm text-muted">{formatDate(r.occurred_on)} · {EVENT_KIND_LABEL[r.event_kind]}{r.share_count ? ` · chia ${r.share_count} người` : ""}</p>
                </div>
                <Money value={r.amount_vnd} sign className="font-semibold" />
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}

function ActionCard({ href, title, sub, tone }: { href: string; title: string; sub: string; tone: "in" | "out" }) {
  return (
    <Link href={href} className="flex min-h-[92px] flex-col justify-between gap-2.5 rounded-2xl border border-line bg-surface p-3.5 hover:border-brand">
      <span aria-hidden className={cx("flex size-9 items-center justify-center rounded-xl", tone === "in" ? "bg-ok-soft text-ok" : "bg-brand-soft text-brand")}>
        {tone === "in"
          ? <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          : <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 6h15l-1.5 9h-12z" /><path d="M6 6 5 3H2" /><circle cx="9" cy="20" r="1.4" /><circle cx="18" cy="20" r="1.4" /></svg>}
      </span>
      <span>
        <span className="block font-semibold">{title}</span>
        <span className="block text-xs text-muted">{sub}</span>
      </span>
    </Link>
  );
}
