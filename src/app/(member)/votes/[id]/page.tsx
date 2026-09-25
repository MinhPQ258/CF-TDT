import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { callRpc } from "@/lib/rpc";
import { formatDateTime } from "@/lib/dates";
import { COFFEE_TYPE_LABEL } from "@/lib/labels";
import type { CoffeeType, VoteSessionDetail } from "@/lib/types";
import { Alert, Card, EmptyState, LinkButton, PageHeader, Stat } from "@/components/ui";
import { VoteStateBadge, VoteWhen } from "@/components/vote-bits";
import { VoteForm } from "./vote-form";

export const metadata: Metadata = { title: "Đợt vote" };

export default async function VoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const r = await callRpc<VoteSessionDetail>("vote_session_detail", { p_session_id: id });
  if (!r.ok) notFound();
  const s = r.data;
  const types: CoffeeType[] = ["MACHINE", "PHIN", "UNDECIDED"];

  return (
    <>
      <PageHeader title={s.name} subtitle={<VoteWhen s={s} />} actions={<LinkButton href="/votes">← Danh sách</LinkButton>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <VoteStateBadge state={s.state} />
        {s.closed_early_at && <span className="text-sm text-muted">Chốt sớm lúc {formatDateTime(s.closed_early_at)}</span>}
      </div>
      {s.state === "CANCELLED" && <div className="mb-4"><Alert tone="warn" title="Đợt đã hủy">{s.cancel_reason}</Alert></div>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="order-2 space-y-4 lg:order-1">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Người uống" value={s.yes_count} />
            <Stat label="Tổng cốc" value={s.cups_total} />
            {types.slice(0, 2).map((t) => (
              <Stat key={t} label={COFFEE_TYPE_LABEL[t]} value={`${s.by_type?.[t]?.cups ?? 0} cốc`} hint={`${s.by_type?.[t]?.people ?? 0} người`} />
            ))}
          </div>
          <Card title="Kết quả theo người">
            {s.votes.length === 0 ? (
              <EmptyState title="Chưa có ai vote" />
            ) : (
              <ul className="divide-y divide-line">
                {s.votes.map((v, i) => (
                  <li key={i} className="flex items-start justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{v.display_name}{v.is_me && " (bạn)"}</p>
                      {v.note && <p className="text-sm text-muted">{v.note}</p>}
                    </div>
                    <p className="shrink-0 text-right text-sm">
                      {v.choice === "YES" ? <><strong>{v.cups} cốc</strong> · {COFFEE_TYPE_LABEL[v.coffee_type ?? "UNDECIDED"]}</> : <span className="text-muted">Không uống</span>}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="order-1 lg:order-2">
          <Card title="Phiếu của bạn">
            {s.state === "OPEN" ? (
              <VoteForm sessionId={s.id} myVote={s.my_vote} />
            ) : (
              <p className="text-muted">
                {s.state === "UPCOMING" ? "Đợt chưa mở." : "Đợt đã chốt, không nhận thay đổi."}{" "}
                {s.my_vote ? `Bạn đã chọn: ${s.my_vote.choice === "YES" ? `uống ${s.my_vote.cups} cốc` : "không uống"}.` : ""}
              </p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
