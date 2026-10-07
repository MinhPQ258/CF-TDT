import { formatVnd } from "@/lib/money";
import type { FundSummary } from "@/lib/types";
import { cx } from "@/components/ui";

const Up = () => <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 19V5M5 12l7-7 7 7" /></svg>;
const Down = () => <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 5v14M5 12l7 7 7-7" /></svg>;

/** Tổng quan quỹ: Quỹ đang có · Tổng thu · Tổng chi (thu − chi = đang có) */
export function FundOverview({ s }: { s: FundSummary }) {
  const thu = s.deposits_vnd + s.gifts_vnd;
  return (
    <>
      {/* mobile: một thẻ lớn */}
      <section aria-label="Tổng quan quỹ" className="space-y-4 rounded-[20px] bg-brand p-5 text-brand-ink lg:hidden">
        <div className="space-y-1">
          <p className="text-sm opacity-85">Quỹ đang có</p>
          <p className={cx("num text-[34px] font-bold leading-tight tracking-tight", s.cash_balance_vnd < 0 && "text-[#ffd2c8]")}>{formatVnd(s.cash_balance_vnd)}</p>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <div className="space-y-1 rounded-2xl bg-white/12 p-3">
            <p className="flex items-center gap-1.5 text-[13px] opacity-85"><Up />Tổng thu</p>
            <p className="num text-lg font-bold">{formatVnd(thu)}</p>
          </div>
          <div className="space-y-1 rounded-2xl bg-white/12 p-3">
            <p className="flex items-center gap-1.5 text-[13px] opacity-85"><Down />Tổng chi</p>
            <p className="num text-lg font-bold">{formatVnd(s.spent_vnd)}</p>
          </div>
        </div>
      </section>

      {/* web: ba thẻ */}
      <section aria-label="Tổng quan quỹ" className="hidden grid-cols-3 gap-4 lg:grid">
        <div className="space-y-1.5 rounded-[20px] bg-brand px-6 py-5 text-brand-ink">
          <p className="text-[15px] opacity-85">Quỹ đang có</p>
          <p className="num text-4xl font-bold tracking-tight">{formatVnd(s.cash_balance_vnd)}</p>
        </div>
        <div className="space-y-1.5 rounded-[20px] border border-line bg-surface px-6 py-5">
          <p className="flex items-center gap-1.5 text-[15px] text-muted"><span className="text-ok"><Up /></span>Tổng thu</p>
          <p className="num text-[32px] font-bold text-ok">{formatVnd(thu)}</p>
        </div>
        <div className="space-y-1.5 rounded-[20px] border border-line bg-surface px-6 py-5">
          <p className="flex items-center gap-1.5 text-[15px] text-muted"><span className="text-brand"><Down /></span>Tổng chi</p>
          <p className="num text-[32px] font-bold">{formatVnd(s.spent_vnd)}</p>
        </div>
      </section>
      {s.gifts_vnd > 0 && <p className="-mt-2 text-xs text-muted">Tổng thu gồm {formatVnd(s.gifts_vnd)} tiền cho thêm.</p>}
    </>
  );
}
