import Link from "next/link";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { loadRpc } from "@/lib/rpc";
import { formatDate } from "@/lib/dates";
import { formatVnd } from "@/lib/money";
import { ENTRY_TYPE_LABEL, EVENT_KIND_LABEL } from "@/lib/labels";
import type { FundSummary, LedgerRow, MyBalance, Paged } from "@/lib/types";
import { can } from "@/lib/permissions";
import { Badge, Card, EmptyState, Money, PageHeader, Pagination, cx } from "@/components/ui";

export const metadata: Metadata = { title: "Quỹ" };
const PAGE_SIZE = 30;

/** Quỹ: tổng đã đóng / đã chi / còn lại → số tiền đóng của từng người → giao dịch của tôi */
export default async function FundPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const me = await requireUser();
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const [fund, bal, ledger] = await Promise.all([
    loadRpc<FundSummary>("fund_summary"),
    loadRpc<MyBalance>("my_balance"),
    loadRpc<Paged<LedgerRow>>("my_ledger", { p_limit: PAGE_SIZE, p_offset: (page - 1) * PAGE_SIZE }),
  ]);
  const b = bal.balance_vnd;
  const maxDeposit = Math.max(1, ...fund.people.map((p) => p.deposited_vnd));

  return (
    <>
      <PageHeader title="Quỹ" subtitle={`Số liệu tính đến ${formatDate(fund.as_of)}`}
        actions={can(me, "reports.view") ? <Link href="/admin/dashboard" className="inline-flex min-h-11 items-center text-sm text-brand underline">Quản trị quỹ →</Link> : undefined} />

      <dl className="grid grid-cols-3 overflow-hidden rounded-xl border border-line bg-surface text-center">
        <div className="border-r border-line px-2 py-3">
          <dt className="text-sm text-muted">Đã đóng</dt>
          <dd className="num mt-0.5 text-lg font-bold lg:text-2xl">{formatVnd(fund.deposits_vnd + fund.gifts_vnd)}</dd>
        </div>
        <div className="border-r border-line px-2 py-3">
          <dt className="text-sm text-muted">Đã chi</dt>
          <dd className="num mt-0.5 text-lg font-bold lg:text-2xl">{formatVnd(fund.spent_vnd)}</dd>
        </div>
        <div className="px-2 py-3">
          <dt className="text-sm text-muted">Quỹ còn</dt>
          <dd className={cx("num mt-0.5 text-lg font-bold lg:text-2xl", fund.cash_balance_vnd < 0 && "text-danger")}>{formatVnd(fund.cash_balance_vnd)}</dd>
        </div>
      </dl>
      {fund.gifts_vnd > 0 && <p className="mt-1 text-xs text-muted">Đã đóng gồm {formatVnd(fund.gifts_vnd)} tiền cho thêm.</p>}

      <p className={cx("mt-3 rounded-lg px-3 py-2 text-sm", b < 0 ? "bg-danger-soft" : "bg-ok-soft")}>
        {b < 0 ? <>Bạn cần nộp thêm <strong className="num text-danger">{formatVnd(-b)}</strong></>
          : b > 0 ? <>Bạn đang dư <strong className="num text-ok">{formatVnd(b)}</strong>, trừ dần vào các lần mua sau</>
          : "Bạn đã cân bằng, không nợ không dư"}
      </p>

      <Card title={`Tiền đóng của mỗi người (${fund.people.length})`} className="mt-4">
        {fund.people.length === 0 ? <p className="text-muted">Chưa có ai.</p> : (
          <ul className="divide-y divide-line">
            {fund.people.map((p) => (
              <li key={p.user_id} className="py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate">
                    <span className={cx(p.is_me && "font-semibold")}>{p.display_name}</span>
                    {p.is_me && <span className="text-muted"> (bạn)</span>}
                  </span>
                  <span className={cx("num shrink-0 font-semibold", p.deposited_vnd === 0 && "font-normal text-muted")}>{formatVnd(p.deposited_vnd)}</span>
                </div>
                <span className="mt-1 block h-1.5 rounded bg-bg" aria-hidden>
                  <span className="block h-1.5 rounded bg-brand" style={{ width: `${Math.max(0, (p.deposited_vnd / maxDeposit) * 100)}%` }} />
                </span>
              </li>
            ))}
          </ul>
        )}
        <Link href="/purchases" className="mt-2 inline-flex min-h-11 items-center text-sm text-brand underline">Xem các phiếu mua →</Link>
      </Card>

      <details className="mt-4 rounded-xl border border-line bg-surface px-4">
        <summary className="flex min-h-12 cursor-pointer items-center font-semibold">Giao dịch của tôi ({ledger.total})</summary>
        {ledger.total === 0 ? (
          <EmptyState title="Chưa có giao dịch">Khi quản trị ghi tiền nộp hoặc phiếu mua, các dòng sẽ hiện ở đây.</EmptyState>
        ) : (
          <>
            <ul className="divide-y divide-line">
              {ledger.rows.map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {ENTRY_TYPE_LABEL[r.entry_type]}
                      {r.is_reversal && <> <Badge tone="warn">Đảo</Badge></>}
                      {r.event_status === "REVERSED" && !r.is_reversal && <> <Badge>Đã đảo</Badge></>}
                    </p>
                    <p className="text-sm text-muted">
                      {formatDate(r.occurred_on)} · {EVENT_KIND_LABEL[r.event_kind]}
                      {r.share_count ? ` · chia ${r.share_count} người` : ""}
                      {r.shop ? ` · ${r.shop}` : ""}
                    </p>
                    {(r.reason || r.note) && <p className="text-sm text-muted">{r.reason ?? r.note}</p>}
                    {r.purchase_id && (
                      <Link href={`/purchases/${r.purchase_id}`} className="inline-flex min-h-11 items-center text-sm text-brand underline">Xem phiếu</Link>
                    )}
                  </div>
                  <Money value={r.amount_vnd} sign className="font-semibold" />
                </li>
              ))}
            </ul>
            <Pagination page={page} total={ledger.total} pageSize={PAGE_SIZE} hrefFor={(p) => `/me?page=${p}`} />
          </>
        )}
      </details>
    </>
  );
}
