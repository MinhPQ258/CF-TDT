import Link from "next/link";
import { loadRpc } from "@/lib/rpc";
import { addDays, formatDate, formatTime, vnToday } from "@/lib/dates";
import type { VoteSession } from "@/lib/types";
import { VoteStateBadge } from "@/components/vote-bits";

/**
 * Danh sách các đợt pha (±30 ngày) dưới đợt đang mở ở tab Vote: Sắp tới / Đã qua.
 * Bấm để xem chi tiết; đợt đang mở thì về màn vote của đợt đó.
 */
export async function SessionList({ base, detailBase, excludeId }: {
  /** màn vote ("/" hoặc "/admin/votes?tab=vote") — cho đợt đang mở */
  base: string;
  /** trang chi tiết: "/votes" (thành viên) hoặc "/admin/votes" (admin) */
  detailBase: string;
  /** đợt đang hiển thị ở trên, không lặp lại */
  excludeId?: string;
}) {
  const today = vnToday();
  const all = await loadRpc<VoteSession[]>("list_vote_sessions", { p_from: addDays(today, -30), p_to: addDays(today, 30) });
  const rest = all.filter((s) => s.id !== excludeId);
  const upcoming = rest.filter((s) => s.state === "OPEN" || s.state === "UPCOMING" || s.state === "DRAFT")
    .sort((a, b) => a.opens_at.localeCompare(b.opens_at));
  const past = rest.filter((s) => s.state === "CLOSED" || s.state === "CANCELLED"); // mới nhất trước (RPC đã sắp)

  const href = (s: VoteSession) => (s.state === "OPEN"
    ? `${base}${base.includes("?") ? "&" : "?"}s=${s.id}`
    : `${detailBase}/${s.id}`);

  const row = (s: VoteSession) => (
    <li key={s.id}>
      <Link href={href(s)} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-bg">
        <span className="min-w-0">
          <span className="block truncate font-medium">{s.name}</span>
          <span className="block text-sm text-muted">
            {formatDate(s.service_date).slice(0, 5)} · {s.state === "UPCOMING" ? `mở ${formatTime(s.opens_at)}` : `chốt ${formatTime(s.closed_at)}`}
            {" · "}{s.yes_count + s.no_count} người vote{s.cups_total ? ` · ${s.cups_total} cốc` : ""}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {s.my_vote && <span className="text-sm text-ok" aria-label="Bạn đã vote">✓</span>}
          <VoteStateBadge state={s.state} />
          <span aria-hidden className="text-muted">›</span>
        </span>
      </Link>
    </li>
  );

  return (
    <section aria-labelledby="session-list" className="overflow-hidden rounded-xl border border-line bg-surface">
      <h2 id="session-list" className="px-4 pb-1 pt-3 text-[17px] font-semibold">Các đợt pha</h2>
      {upcoming.length === 0 && past.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted">Chưa có đợt nào khác trong 30 ngày.</p>
      ) : (
        <>
          {upcoming.length > 0 && (
            <>
              <h3 className="px-4 pb-1 pt-2 text-xs font-semibold uppercase text-muted">Đang mở / sắp tới</h3>
              <ul className="divide-y divide-line border-t border-line">{upcoming.map(row)}</ul>
            </>
          )}
          {past.length > 0 && (
            <>
              <h3 className="px-4 pb-1 pt-3 text-xs font-semibold uppercase text-muted">Đã qua</h3>
              <ul className="divide-y divide-line border-t border-line">{past.map(row)}</ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
