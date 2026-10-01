import Link from "next/link";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { loadRpc } from "@/lib/rpc";
import type { VoteSession } from "@/lib/types";
import { Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { can } from "@/lib/permissions";
import { VoteStateBadge, VoteWhen } from "@/components/vote-bits";

export const metadata: Metadata = { title: "Vote pha chung" };

export default async function VotesPage() {
  const me = await requireUser();
  const sessions = await loadRpc<VoteSession[]>("list_vote_sessions", {});
  const open = sessions.filter((s) => s.state === "OPEN" || s.state === "UPCOMING");
  const past = sessions.filter((s) => s.state !== "OPEN" && s.state !== "UPCOMING" && s.state !== "DRAFT");

  return (
    <>
      <PageHeader back="/" backLabel="Quay lại Home" title="Các đợt pha" subtitle="Vote là ý định uống, không phát sinh tiền." actions={<LinkButton href="/" variant="primary">Vote đợt đang mở</LinkButton>} />
      <h2 className="mb-2 text-lg font-semibold">Đang mở / sắp mở</h2>
      {open.length === 0 ? (
        <EmptyState title="Chưa có đợt vote nào đang mở">
          {can(me, "votes.manage") ? <Link className="text-brand underline" href="/admin/votes">Tạo đợt vote</Link> : "Quản trị sẽ mở đợt khi có kế hoạch pha."}
        </EmptyState>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">{open.map((s) => <SessionCard key={s.id} s={s} />)}</ul>
      )}
      <h2 className="mb-2 mt-6 text-lg font-semibold">7 ngày gần đây</h2>
      {past.length === 0 ? (
        <p className="text-muted">Chưa có đợt đã chốt.</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">{past.map((s) => <SessionCard key={s.id} s={s} />)}</ul>
      )}
    </>
  );
}

function SessionCard({ s }: { s: VoteSession }) {
  return (
    <li>
      <Link href={s.state === "OPEN" ? `/?s=${s.id}` : `/votes/${s.id}`} className="block rounded-xl focus-visible:outline-offset-4">
        <Card className="h-full hover:border-brand">
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 truncate font-semibold">{s.name}</p>
            <VoteStateBadge state={s.state} />
          </div>
          <p className="mt-1 text-sm text-muted"><VoteWhen s={s} /></p>
          <p className="mt-2 text-sm">
            <strong>{s.yes_count}</strong> người uống · <strong>{s.cups_total}</strong> cốc · {s.no_count} không
          </p>
          <p className="mt-1 text-sm">
            {s.my_vote
              ? <>Phiếu của bạn: <strong>{s.my_vote.choice === "YES" ? [s.my_vote.style_label, s.my_vote.cups ? `${s.my_vote.cups} cốc` : null].filter(Boolean).join(" · ") : "Không uống"}</strong></>
              : s.state === "OPEN" ? <span className="font-medium text-brand">Bạn chưa vote →</span> : <span className="text-muted">Bạn không vote</span>}
          </p>
        </Card>
      </Link>
    </li>
  );
}
