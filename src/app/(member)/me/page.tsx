import Link from "next/link";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { loadRpc } from "@/lib/rpc";
import { formatDate } from "@/lib/dates";
import { formatVnd } from "@/lib/money";
import { ENTRY_TYPE_LABEL, ENTRY_TYPE_ORDER, EVENT_KIND_LABEL } from "@/lib/labels";
import type { LedgerRow, MyBalance, Paged } from "@/lib/types";
import { Badge, Card, EmptyState, Money, PageHeader, Pagination, cx } from "@/components/ui";

export const metadata: Metadata = { title: "Số dư của tôi" };
const PAGE_SIZE = 30;

/**
 * Trả lời 3 câu theo thứ tự (DEV plan v2 §7):
 *   1. Tôi cần nộp bao nhiêu?  2. Vì sao? (nhóm theo loại)  3. Chi tiết từng dòng
 */
export default async function MyBalancePage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const me = await requireUser();
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const [bal, ledger, fund] = await Promise.all([
    loadRpc<MyBalance>("my_balance"),
    loadRpc<Paged<LedgerRow>>("my_ledger", { p_limit: PAGE_SIZE, p_offset: (page - 1) * PAGE_SIZE }),
    loadRpc<{ cash_balance_vnd: number }>("fund_summary"),
  ]);
  const b = bal.balance_vnd;

  return (
    <>
      <PageHeader title={`Chào ${me.display_name}`} subtitle={`Số liệu tính đến ${formatDate(bal.as_of)}`} />

      <section aria-labelledby="need" className={cx("rounded-xl border p-5", b < 0 ? "border-danger/40 bg-danger-soft" : "border-ok/30 bg-ok-soft")}>
        <h2 id="need" className="text-base font-semibold">
          {b < 0 ? "Cần nộp thêm" : b > 0 ? "Đang dư (đã ứng/nộp trước)" : "Đã cân bằng"}
        </h2>
        <p className={cx("num mt-1 text-4xl font-bold", b < 0 ? "text-danger" : "text-ok")}>{formatVnd(Math.abs(b))}</p>
        <p className="mt-2 text-sm">
          {b < 0
            ? "Chi phí mua đồ chung được chia cho bạn nhiều hơn số bạn đã nộp. Nộp khoản này cho quản trị quỹ."
            : b > 0
              ? "Bạn đã nộp hoặc mua hộ nhiều hơn phần chi phí được chia. Khoản dư sẽ trừ dần vào các lần mua sau."
              : "Bạn không nợ và không dư."}
          {!bal.is_member_today && " Bạn hiện không còn là thành viên quỹ."}
        </p>
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Vì sao?" className="lg:col-span-2">
          <dl className="divide-y divide-line">
            {ENTRY_TYPE_ORDER.map((t) => (
              <div key={t} className="flex items-center justify-between gap-3 py-2">
                <dt>{ENTRY_TYPE_LABEL[t]}</dt>
                <dd><Money value={bal.breakdown[t]} sign /></dd>
              </div>
            ))}
            <div className="flex items-center justify-between gap-3 py-2 font-semibold">
              <dt>Số dư</dt>
              <dd><Money value={b} sign /></dd>
            </div>
          </dl>
          <p className="mt-3 text-sm text-muted">
            Mỗi phiếu mua và khoản tiền cho thêm được chia đều cho mọi thành viên quỹ tại ngày phát sinh, kể cả người không vote hay không uống.
            Chia nguyên đồng; phần dư 1–(N−1) đồng lần lượt cộng cho người có mã nhân viên nhỏ hơn.
          </p>
        </Card>
        <Card title="Quỹ chung">
          <p className="text-sm text-muted">Tiền quỹ thực đang giữ</p>
          <p className="mt-1 text-2xl font-bold"><Money value={fund.cash_balance_vnd} /></p>
          <Link href="/purchases" className="mt-3 inline-flex min-h-11 items-center text-brand underline">Xem các phiếu mua →</Link>
        </Card>
      </div>

      <Card title="Chi tiết từng dòng" className="mt-4">
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
      </Card>
    </>
  );
}
