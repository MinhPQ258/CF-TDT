import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { callRpc } from "@/lib/rpc";
import { formatDate, formatTime } from "@/lib/dates";
import type { VoteSessionDetail } from "@/lib/types";
import { Alert, Card, LinkButton, Stat, Table } from "@/components/ui";
import { VoteStateBadge } from "@/components/vote-bits";
import { Countdown } from "@/components/vote-controls";
import { BackButton } from "@/components/back-button";
import { CopyBrewList } from "./session-admin";

export const metadata: Metadata = { title: "Kết quả đợt pha" };

export default async function AdminVoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("votes.manage");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const r = await callRpc<VoteSessionDetail>("vote_session_detail", { p_session_id: id });
  if (!r.ok) notFound();
  const s = r.data;
  const live = s.state === "OPEN" || s.state === "UPCOMING" || s.state === "DRAFT";
  const notVoted = s.not_voted ?? [];

  return (
    <>
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 items-start gap-1">
        <BackButton fallback="/admin/votes" label="Quay lại Đợt pha" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold">{s.name} · {formatDate(s.service_date).slice(0, 5)}</h1>
            <VoteStateBadge state={s.state} />
          </div>
          <p className="mt-1 text-muted">
            Mở {formatTime(s.opens_at)} · chốt {formatTime(s.closed_at)}
            {s.state === "OPEN" && <> (<Countdown to={s.closed_at} />)</>}
            {s.planned_brew_at && <> · pha {formatTime(s.planned_brew_at)}</>}
          </p>
        </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {live && <LinkButton href={`/admin/votes/${s.id}/edit`}>Chỉnh sửa</LinkButton>}
          <LinkButton href="/admin/votes">+ Đợt pha mới</LinkButton>
          <CopyBrewList s={s} />
        </div>
      </header>
      {s.state === "CANCELLED" && <div className="mb-4"><Alert tone="warn" title="Đợt đã hủy">{s.cancel_reason}</Alert></div>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Người uống" value={s.yes_count} />
        <Stat label="Tổng cốc" value={s.cups_total} />
        <Stat label="Không uống" value={s.no_count} />
        <div className="rounded-xl border border-warn/25 bg-warn-soft p-4">
          <p className="text-sm text-warn">Chưa vote</p>
          <p className="mt-1 text-2xl font-bold">{notVoted.length}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card title="Cần pha">
            {s.by_style.length === 0 ? <p className="text-muted">Chưa có ai vote uống.</p> : (
              <ul className="divide-y divide-line">
                {s.by_style.map((x) => (
                  <li key={x.label} className="flex justify-between gap-2 py-1.5"><span>{x.label}</span><strong>{x.cups} cốc · {x.people} người</strong></li>
                ))}
              </ul>
            )}
          </Card>
          {s.by_addon.length > 0 && (
            <Card title="Đồ đi kèm">
              <ul className="flex flex-wrap gap-1.5 text-sm">
                {s.by_addon.map((x) => <li key={x.label} className="rounded-full bg-brand-soft px-2.5 py-1">{x.label} <strong>{x.people}</strong></li>)}
              </ul>
            </Card>
          )}
          {notVoted.length > 0 && (
            <section className="rounded-xl border border-warn/25 bg-warn-soft p-4">
              <h2 className="mb-1 font-semibold text-warn">Chưa vote ({notVoted.length})</h2>
              <p className="text-sm">{notVoted.map((x) => x.display_name).join(" · ")}</p>
            </section>
          )}
        </div>

        <Card title={`Chi tiết (${s.votes.length})`}>
          {s.votes.length === 0 ? <p className="text-muted">Chưa có phiếu.</p> : (
            <>
              <ul className="divide-y divide-line md:hidden">
                {s.votes.map((v, i) => (
                  <li key={i} className="py-2">
                    <p className="font-medium">{v.display_name}</p>
                    <p className="text-sm text-muted">{v.choice === "YES" ? [v.style_label, v.addon_labels.join(", "), v.cups ? `${v.cups} cốc` : null].filter(Boolean).join(" · ") : "Không uống"} · {formatTime(v.updated_at)}</p>
                  </li>
                ))}
              </ul>
              <Table className="hidden md:block">
                <thead><tr><th>Người</th><th>Uống</th><th>Kiểu pha</th><th>Đồ đi kèm</th><th className="text-right">Cốc</th><th className="text-right">Lúc</th></tr></thead>
                <tbody>
                  {s.votes.map((v, i) => (
                    <tr key={i} className={v.choice === "NO" ? "text-muted" : ""}>
                      <td>{v.display_name}</td>
                      <td>{v.choice === "YES" ? "Có" : "Không"}</td>
                      <td>{v.style_label ?? "—"}</td>
                      <td>{v.addon_labels.length ? v.addon_labels.join(", ") : "—"}</td>
                      <td className="text-right">{v.cups ?? (v.choice === "YES" ? 1 : "—")}</td>
                      <td className="text-right text-muted">{formatTime(v.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
