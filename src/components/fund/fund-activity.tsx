import Link from "next/link";
import { formatDate } from "@/lib/dates";
import { formatVnd } from "@/lib/money";
import { EVENT_KIND_LABEL } from "@/lib/labels";
import type { FundEvent } from "@/lib/types";
import { cx } from "@/components/ui";

/** Một dòng "Gần đây": tiêu đề dễ hiểu, dòng phụ, số tiền có dấu (+ vào quỹ, − ra khỏi quỹ) */
export function describeEvent(e: FundEvent) {
  const reversal = e.kind === "REVERSAL";
  const base = reversal ? e.reverses_kind ?? "REVERSAL" : e.kind;
  const title =
    base === "DEPOSIT" ? `${e.subject ?? "Ai đó"} nộp quỹ`
      : base === "PURCHASE_FUND" ? e.note || "Mua sắm"
        : base === "PURCHASE_MEMBER" ? `${e.subject ?? "Ai đó"} mua hộ${e.note ? `: ${e.note}` : ""}`
          : base === "REIMBURSEMENT" ? `Hoàn tiền cho ${e.subject ?? "ai đó"}`
            : base === "GIFT" ? "Tiền cho thêm" : EVENT_KIND_LABEL[base];
  const kindLabel = base === "DEPOSIT" ? "Tiền vào" : base.startsWith("PURCHASE") ? "Mua sắm" : EVENT_KIND_LABEL[base];
  const sub = [reversal ? "Đảo" : kindLabel, base === "DEPOSIT" ? e.note : null, formatDate(e.occurred_on).slice(0, 5)].filter(Boolean).join(" · ");
  // tiền thực vào/ra quỹ; mua hộ không đụng quỹ → hiện là chi phí
  const delta = e.cash_delta_vnd !== 0 ? e.cash_delta_vnd : -e.amount_vnd;
  return { title: reversal ? `Đảo: ${title}` : title, sub, delta, isIn: delta > 0, reversed: e.status === "REVERSED" };
}

const Arrow = ({ up }: { up: boolean }) => (
  <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {up ? <path d="M12 19V5M5 12l7-7 7 7" /> : <path d="M12 5v14M5 12l7 7 7-7" />}
  </svg>
);

export function FundActivity({ rows, linkable }: { rows: FundEvent[]; linkable: boolean }) {
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-muted">Chưa có giao dịch.</p>;
  return (
    <ul className="divide-y divide-line/70">
      {rows.map((e) => {
        const d = describeEvent(e);
        const body = (
          <>
            <span aria-hidden className={cx("flex size-[34px] shrink-0 items-center justify-center rounded-full", d.isIn ? "bg-ok-soft text-ok" : "bg-brand-soft text-brand")}>
              <Arrow up={d.isIn} />
            </span>
            <span className="min-w-0 flex-1">
              <span className={cx("block truncate font-medium", d.reversed && "text-muted line-through")}>{d.title}</span>
              <span className="block text-xs text-muted">{d.sub}{d.reversed ? " · đã đảo" : ""}</span>
            </span>
            <span className={cx("num shrink-0 font-semibold", d.isIn ? "text-ok" : "text-ink", d.reversed && "text-muted line-through")}>
              {d.delta > 0 ? "+" : "−"}{formatVnd(Math.abs(d.delta))}
            </span>
          </>
        );
        return (
          <li key={e.id}>
            {linkable
              ? <Link href={`/admin/fund/${e.id}`} className="flex min-h-14 items-center gap-3 py-2.5 hover:bg-bg">{body}</Link>
              : <div className="flex min-h-14 items-center gap-3 py-2.5">{body}</div>}
          </li>
        );
      })}
    </ul>
  );
}
