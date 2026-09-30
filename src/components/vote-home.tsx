import Link from "next/link";
import { loadRpc } from "@/lib/rpc";
import { formatDateTime, formatTime } from "@/lib/dates";
import type { HomeData, Me, VotePerson, VoteSessionDetail } from "@/lib/types";
import { EmptyState, LinkButton, cx } from "@/components/ui";
import { VoteStateBadge } from "@/components/vote-bits";
import { Countdown } from "@/components/vote-controls";
import { VoteResult } from "@/components/vote-result";
import { VoteForm } from "@/components/vote-form";
import { SessionSelect } from "@/components/session-select";
import { SessionList } from "@/components/session-list";

/** Thêm/ghi đè query vào một đường dẫn gốc ("/" hoặc "/admin/votes?tab=vote") */
export function withQuery(base: string, params: Record<string, string | undefined>): string {
  const u = new URL(base, "http://x");
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) u.searchParams.delete(k);
    else u.searchParams.set(k, v);
  }
  return u.pathname + (u.search || "");
}

/**
 * Luồng vote dùng chung: Home thành viên ("/") và tab Vote của admin ("/admin/votes?tab=vote").
 * Đợt đang mở → tích chọn → Gửi → kết quả; đã vote thì vào thẳng kết quả; ?edit=1 để sửa.
 */
export async function VoteHome({ me, base, selected, edit, othersHref }: {
  me: Me; base: string; selected?: string; edit?: string; othersHref: string;
}) {
  const home = await loadRpc<HomeData>("home");
  // Chi tiết đợt (tương lai / đã qua): admin xem trang quản trị, thành viên xem trang kết quả
  const detailBase = base.startsWith("/admin") ? "/admin/votes" : "/votes";

  if (home.sessions.length === 0) {
    return (
      <div className="space-y-4">
        <EmptyState title="Chưa có đợt pha nào đang mở"
          action={me.role === "ADMIN" ? <LinkButton href="/admin/votes" variant="primary">Tạo đợt pha</LinkButton> : undefined}>
          {home.next ? <>Đợt kế tiếp: <strong>{home.next.name}</strong>, mở lúc {formatDateTime(home.next.opens_at)}.</> : "Quản trị sẽ mở đợt khi có kế hoạch pha."}
        </EmptyState>
        <SessionList base={base} detailBase={detailBase} />
      </div>
    );
  }

  const current = home.sessions.find((x) => x.id === selected) ?? home.sessions.find((x) => x.state === "OPEN") ?? home.sessions[0];
  const showResult = Boolean(current.my_vote) && edit !== "1";
  const detail = showResult ? await loadRpc<VoteSessionDetail>("vote_session_detail", { p_session_id: current.id }) : null;
  const people = !showResult && current.state === "OPEN" ? await loadRpc<VotePerson[]>("vote_people", { p_session_id: current.id }) : [];
  const resultHref = withQuery(base, { s: current.id, edit: undefined });
  const editHref = withQuery(base, { s: current.id, edit: "1" });

  return (
    <div className={cx("mx-auto max-w-2xl space-y-4", !detail && current.state !== "UPCOMING" && "pb-28 lg:pb-0")}>
      {home.sessions.length > 1 && (
        <div className="lg:hidden">
          <SessionSelect value={current.id}
            options={home.sessions.map((x) => ({ id: x.id, href: withQuery(base, { s: x.id, edit: undefined }), label: `${x.name}${x.my_vote ? " ✓ đã vote" : ""}` }))} />
        </div>
      )}
      {home.sessions.length > 1 && (
        <nav aria-label="Chọn đợt pha" className="hidden gap-2 pb-1 lg:flex lg:flex-wrap">
          {home.sessions.map((x) => (
            <Link key={x.id} href={withQuery(base, { s: x.id, edit: undefined })} aria-current={x.id === current.id ? "page" : undefined}
              className={cx("flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm",
                x.id === current.id ? "border-brand bg-brand-soft font-semibold text-brand" : "border-line bg-surface")}>
              {x.name}{x.my_vote && <span aria-label="đã vote">✓</span>}
            </Link>
          ))}
        </nav>
      )}

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-[22px] font-bold">{current.name}</h2>
          <p className="text-sm text-muted">
            {current.state === "UPCOMING" ? <>Mở lúc {formatTime(current.opens_at)} · </> : null}
            Chốt {formatTime(current.closed_at)}
            {current.planned_brew_at && <> · pha {formatTime(current.planned_brew_at)}</>}
            {current.state === "OPEN" && <> · <Countdown to={current.closed_at} /></>}
          </p>
          <p className="mt-1 text-sm">
            <strong>{current.yes_count + current.no_count}</strong> người đã vote
            <span className="text-muted"> · {current.yes_count} uống · {current.cups_total} cốc{current.no_count ? ` · ${current.no_count} không uống` : ""}</span>
          </p>
        </div>
        <VoteStateBadge state={current.state} />
      </div>

      {current.state === "UPCOMING" ? (
        <EmptyState title={`Đợt mở lúc ${formatTime(current.opens_at)}`}>
          Kiểu pha: {current.options.styles.map((x) => x.label).join(", ")}
          {current.options.addons.length > 0 && <> · Đồ đi kèm: {current.options.addons.map((x) => x.label).join(", ")}</>}
        </EmptyState>
      ) : detail ? (
        <VoteResult s={detail} editHref={editHref} othersHref={othersHref} />
      ) : (
        <>
          {current.my_vote_by && <p className="rounded-lg bg-brand-soft px-3 py-2 text-sm">{current.my_vote_by} đã đặt hộ bạn. Sửa và gửi lại nếu muốn đổi.</p>}
          <VoteForm key={current.id} session={current} initial={current.my_vote ?? current.prefill} doneHref={resultHref} loginNext={editHref} people={people} />
        </>
      )}

      <SessionList base={base} detailBase={detailBase} excludeId={current.id} />
    </div>
  );
}
