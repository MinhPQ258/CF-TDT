import Link from "next/link";
import { formatTime } from "@/lib/dates";
import type { VoteSessionDetail } from "@/lib/types";
import { Card, LinkButton } from "@/components/ui";
import { WithdrawButton } from "@/components/withdraw-button";

/** Kết quả đợt pha cho thành viên (Home sau khi gửi, và /votes/[id]) */
export function VoteResult({ s, editHref, othersHref = "/votes" }: { s: VoteSessionDetail; editHref?: string; othersHref?: string }) {
  const mine = s.my_vote;
  const open = s.state === "OPEN";
  const maxCups = Math.max(1, ...s.by_style.map((x) => x.cups));
  const mySummary = mine
    ? mine.choice === "YES"
      ? [mine.style_label, mine.addon_labels.join(", "), mine.cups ? `${mine.cups} cốc` : null].filter(Boolean).join(" · ")
      : "Không uống"
    : null;

  return (
    <div className="space-y-3">
      {mine && (
        <div role="status" className="flex items-start gap-2.5 rounded-xl border border-ok/30 bg-ok-soft p-3">
          <svg viewBox="0 0 24 24" className="mt-0.5 size-5 shrink-0 text-ok" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12.5l4.5 4.5L19 7" /></svg>
          <div className="min-w-0">
            <p className="font-semibold text-ok">Đã ghi vote {s.name}</p>
            <p className="text-sm">{mySummary}.{open ? ` Sửa được đến ${formatTime(s.closed_at)}.` : ""}</p>
          </div>
        </div>
      )}
      {mine && open && editHref && (
        <div className="grid grid-cols-2 gap-2">
          <LinkButton href={editHref}>Sửa lựa chọn</LinkButton>
          <WithdrawButton sessionId={s.id} afterHref={editHref} />
        </div>
      )}
      {!mine && open && editHref && <LinkButton href={editHref} variant="primary" className="w-full">Vote đợt này</LinkButton>}

      <Card>
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 className="text-[17px] font-semibold">{open ? "Kết quả hiện tại" : "Kết quả"}</h2>
          <span className="text-sm text-muted">{s.yes_count} người · {s.cups_total} cốc{s.no_count ? ` · ${s.no_count} không uống` : ""}</span>
        </div>
        {s.by_style.length === 0 ? (
          <p className="text-muted">Chưa có ai vote uống.</p>
        ) : (
          <>
            <h3 className="mb-1.5 text-sm font-semibold text-muted">Kiểu pha (số cốc)</h3>
            <ul className="space-y-1.5">
              {s.by_style.map((x) => (
                <li key={x.label} className="grid grid-cols-[6rem_minmax(0,1fr)_2rem] items-center gap-2 text-sm">
                  <span className="truncate font-medium">{x.label}</span>
                  <span className="h-3.5 rounded bg-bg" aria-hidden><span className="block h-3.5 rounded bg-brand" style={{ width: `${(x.cups / maxCups) * 100}%` }} /></span>
                  <span className="num text-right font-semibold">{x.cups}</span>
                </li>
              ))}
            </ul>
            {s.by_addon.length > 0 && (
              <>
                <h3 className="mb-1.5 mt-3 text-sm font-semibold text-muted">Đồ đi kèm (số người)</h3>
                <ul className="flex flex-wrap gap-1.5 text-sm">
                  {s.by_addon.map((x) => <li key={x.label} className="rounded-full bg-brand-soft px-2.5 py-1">{x.label} <strong>{x.people}</strong></li>)}
                </ul>
              </>
            )}
          </>
        )}
      </Card>

      <details className="rounded-xl border border-line bg-surface px-4">
        <summary className="flex min-h-12 cursor-pointer items-center font-semibold">Xem ai đã vote ({s.votes.length})</summary>
        <ul className="divide-y divide-line pb-2">
          {s.votes.map((v, i) => (
            <li key={i} className="flex items-start justify-between gap-3 py-2 text-sm">
              <span className="min-w-0 truncate font-medium">{v.display_name}{v.is_me && " (bạn)"}</span>
              <span className="shrink-0 text-right text-muted">
                {v.choice === "YES" ? [v.style_label, v.addon_labels.join(", "), v.cups ? `${v.cups} cốc` : null].filter(Boolean).join(" · ") : "Không uống"}
              </span>
            </li>
          ))}
        </ul>
      </details>
      <p className="text-center text-sm"><Link href={othersHref} className="inline-flex min-h-11 items-center text-brand underline">Các đợt khác</Link></p>
    </div>
  );
}
