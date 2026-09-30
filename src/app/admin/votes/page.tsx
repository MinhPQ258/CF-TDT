import Link from "next/link";
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { loadRpc } from "@/lib/rpc";
import { addDays, formatTime, vnToday } from "@/lib/dates";
import type { VoteSession, VoteSessionDetail } from "@/lib/types";
import { Card, EmptyState, LinkButton, PageHeader, Stat, cx } from "@/components/ui";
import { VoteStateBadge } from "@/components/vote-bits";
import { Countdown } from "@/components/vote-controls";
import { VoteHome, withQuery } from "@/components/vote-home";
import { CreateSessionForm } from "@/components/create-session-form";
import { CopyBrewList, SessionMoreMenu } from "./[id]/session-admin";
import { SessionSelect } from "@/components/session-select";
import { SessionList } from "@/components/session-list";

export const metadata: Metadata = { title: "Đợt pha & vote" };

type Tab = "overview" | "vote";

/** Đợt pha (admin, web trước): tab Tổng quan (ai vote gì) và tab Vote (admin tự vote). */
export default async function AdminVotesPage({ searchParams }: { searchParams: Promise<{ tab?: string; s?: string; edit?: string }> }) {
  const me = await requireAdmin();
  const sp = await searchParams;
  const tab: Tab = sp.tab === "vote" ? "vote" : "overview";

  return (
    <>
      <PageHeader title="Đợt pha & vote" />
      <nav aria-label="Đợt pha" className="mb-4 inline-grid grid-cols-2 gap-1 rounded-xl border border-line bg-surface p-1">
        {([["overview", "Tổng quan"], ["vote", "Vote"]] as const).map(([key, label]) => (
          <Link key={key} href={key === "overview" ? "/admin/votes" : "/admin/votes?tab=vote"} aria-current={tab === key ? "page" : undefined}
            className={cx("flex min-h-11 min-w-32 items-center justify-center rounded-lg px-5 font-medium",
              tab === key ? "bg-brand text-brand-ink" : "text-muted hover:bg-bg")}>
            {label}
          </Link>
        ))}
      </nav>
      {tab === "vote"
        ? <VoteHome me={me} base="/admin/votes?tab=vote" selected={sp.s} edit={sp.edit} othersHref="/admin/votes" />
        : <Overview selected={sp.s} />}
    </>
  );
}

function summary(v: VoteSessionDetail["votes"][number]) {
  return [v.addon_labels.join(", "), v.cups && v.cups > 1 ? `${v.cups} cốc` : null].filter(Boolean).join(" · ");
}

async function Overview({ selected }: { selected?: string }) {
  const today = vnToday();
  const sessions = await loadRpc<VoteSession[]>("list_vote_sessions", { p_from: addDays(today, -30), p_to: addDays(today, 30) });
  const live = sessions.filter((s) => s.state === "OPEN" || s.state === "UPCOMING").sort((a, b) => a.cutoff_at.localeCompare(b.cutoff_at));
  const current = live.find((s) => s.id === selected) ?? live[0] ?? null;
  const d = current ? await loadRpc<VoteSessionDetail>("vote_session_detail", { p_session_id: current.id }) : null;
  const yes = d?.votes.filter((v) => v.choice === "YES") ?? [];
  const no = d?.votes.filter((v) => v.choice === "NO") ?? [];
  const notVoted = d?.not_voted ?? [];

  return (
    <div className="space-y-4">
      {live.length > 1 && current && (
        <div className="lg:hidden">
          <SessionSelect value={current.id}
            options={live.map((s) => ({ id: s.id, href: withQuery("/admin/votes", { s: s.id }), label: `${s.name} · ${s.yes_count} người` }))} />
        </div>
      )}
      {live.length > 1 && (
        <nav aria-label="Chọn đợt" className="hidden flex-wrap gap-2 lg:flex">
          {live.map((s) => (
            <Link key={s.id} href={withQuery("/admin/votes", { s: s.id })} aria-current={s.id === current?.id ? "page" : undefined}
              className={cx("flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm",
                s.id === current?.id ? "border-brand bg-brand-soft font-semibold text-brand" : "border-line bg-surface")}>
              {s.name} <span className="text-muted">{s.yes_count} người</span>
            </Link>
          ))}
        </nav>
      )}

      {d ? (
        <>
          <div className="flex items-start justify-between gap-3 lg:flex-wrap lg:items-end">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold">{d.name}</h2>
                <VoteStateBadge state={d.state} />
              </div>
              <p className="text-sm text-muted">
                Chốt {formatTime(d.closed_at)}{d.state === "OPEN" && <> (<Countdown to={d.closed_at} />)</>}
                {d.planned_brew_at && <> · pha {formatTime(d.planned_brew_at)}</>}
              </p>
            </div>
            <div className="-mr-2 shrink-0 lg:hidden"><SessionMoreMenu s={d} /></div>
            <div className="hidden flex-wrap gap-2 lg:flex">
              <LinkButton href={`/admin/votes?tab=vote&s=${d.id}`}>Tôi vote</LinkButton>
              <LinkButton href={`/admin/votes/${d.id}/edit`}>Chỉnh sửa</LinkButton>
              <CopyBrewList s={d} />
            </div>
          </div>

          <dl className="grid grid-cols-4 overflow-hidden rounded-xl border border-line bg-surface text-center lg:hidden">
            {([["Uống", d.yes_count, false], ["Cốc", d.cups_total, false], ["Không", d.no_count, false], ["Chưa vote", notVoted.length, true]] as const).map(([k, v, warn]) => (
              <div key={k} className={cx("px-1 py-2", warn ? "bg-warn-soft" : "border-r border-line")}>
                <dt className={cx("text-xs", warn ? "text-warn" : "text-muted")}>{k}</dt>
                <dd className="text-lg font-bold leading-tight">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="hidden grid-cols-4 gap-3 lg:grid">
            <Stat label="Người uống" value={d.yes_count} />
            <Stat label="Tổng cốc" value={d.cups_total} />
            <Stat label="Không uống" value={d.no_count} />
            <div className="rounded-xl border border-warn/25 bg-warn-soft p-4">
              <p className="text-sm text-warn">Chưa vote</p>
              <p className="mt-1 text-2xl font-bold">{notVoted.length}</p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <Card title="Ai vote gì — theo kiểu pha">
              {d.by_style.length === 0 ? <p className="text-muted">Chưa có ai vote uống.</p> : (
                <div className="grid gap-3 md:grid-cols-2">
                  {d.by_style.map((st) => (
                    <section key={st.label} className="rounded-lg border border-line p-3">
                      <h3 className="flex items-baseline justify-between gap-2 font-semibold">
                        <span>{st.label}</span><span className="text-sm font-normal text-muted">{st.cups} cốc · {st.people} người</span>
                      </h3>
                      <ul className="mt-2 space-y-1.5 text-sm">
                        {yes.filter((v) => v.style_label === st.label).map((v, i) => (
                          <li key={i} className="flex justify-between gap-2">
                            <span className="min-w-0 truncate font-medium">{v.display_name}{v.is_me && " (bạn)"}{v.voted_by_name && <span className="block text-xs font-normal text-muted">đặt hộ bởi {v.voted_by_name}</span>}</span>
                            <span className="shrink-0 text-right text-muted">{summary(v) || "—"}</span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              )}
            </Card>

            <div className="space-y-4">
              <Card title="Đồ đi kèm">
                {d.by_addon.length === 0 ? <p className="text-muted">Chưa ai chọn.</p> : (
                  <ul className="space-y-2 text-sm">
                    {d.by_addon.map((a) => (
                      <li key={a.label}>
                        <p className="flex justify-between"><strong>{a.label}</strong><span>{a.people} người</span></p>
                        <p className="text-muted">{yes.filter((v) => v.addon_labels.includes(a.label)).map((v) => v.display_name).join(", ")}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              {no.length > 0 && (
                <Card title={`Không uống (${no.length})`}>
                  <p className="text-sm">{no.map((v) => v.display_name).join(" · ")}</p>
                </Card>
              )}
              <section className="rounded-xl border border-warn/25 bg-warn-soft p-4">
                <h2 className="mb-1 font-semibold text-warn">Chưa vote ({notVoted.length})</h2>
                <p className="text-sm">{notVoted.length ? notVoted.map((x) => x.display_name).join(" · ") : "Mọi người đã vote."}</p>
              </section>
            </div>
          </div>
        </>
      ) : (
        <EmptyState title="Không có đợt pha nào đang mở">Tạo đợt mới bên dưới.</EmptyState>
      )}

      <details open={!d} className="rounded-xl border border-line bg-surface">
        <summary className="flex min-h-12 cursor-pointer items-center px-4 font-semibold">+ Tạo đợt pha mới</summary>
        <div className="border-t border-line p-4"><CreateSessionForm doneBase="/admin/votes" /></div>
      </details>

      <SessionList base="/admin/votes" detailBase="/admin/votes" excludeId={current?.id} />
    </div>
  );
}
