import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { callRpc } from "@/lib/rpc";
import { formatDate, formatDateTime, formatTime } from "@/lib/dates";
import type { VoteSessionDetail } from "@/lib/types";
import { Alert, PageHeader } from "@/components/ui";
import { VoteStateBadge } from "@/components/vote-bits";
import { VoteResult } from "@/components/vote-result";

export const metadata: Metadata = { title: "Kết quả đợt pha" };

export default async function VoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const r = await callRpc<VoteSessionDetail>("vote_session_detail", { p_session_id: id });
  if (!r.ok) notFound();
  const s = r.data;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={s.name}
        subtitle={`${formatDate(s.service_date)} · chốt ${formatTime(s.closed_at)}${s.planned_brew_at ? ` · pha ${formatTime(s.planned_brew_at)}` : ""}`}
        back="/votes" backLabel="Quay lại các đợt pha"
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <VoteStateBadge state={s.state} />
        {s.closed_early_at && <span className="text-sm text-muted">Chốt sớm lúc {formatDateTime(s.closed_early_at)}</span>}
      </div>
      {s.state === "CANCELLED" && <div className="mb-3"><Alert tone="warn" title="Đợt đã hủy">{s.cancel_reason}</Alert></div>}
      <VoteResult s={s} editHref={s.state === "OPEN" ? `/?s=${s.id}&edit=1` : undefined} />
    </div>
  );
}
