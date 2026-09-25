import Link from "next/link";
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { loadRpc } from "@/lib/rpc";
import { addDays, vnToday } from "@/lib/dates";
import type { VoteSession } from "@/lib/types";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { VoteStateBadge, VoteWhen } from "@/components/vote-bits";
import { CreateSessionForm, SessionActions } from "./session-forms";

export const metadata: Metadata = { title: "Đợt vote" };

export default async function AdminVotesPage() {
  await requireAdmin();
  const today = vnToday();
  const sessions = await loadRpc<VoteSession[]>("list_vote_sessions", { p_from: addDays(today, -30), p_to: addDays(today, 30) });
  return (
    <>
      <PageHeader title="Đợt vote" subtitle="Một ngày có thể có nhiều đợt. Trạng thái mở/chốt tính theo giờ." />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card title="30 ngày gần đây" className="order-2 lg:order-1">
          {sessions.length === 0 ? <EmptyState title="Chưa có đợt vote" /> : (
            <ul className="divide-y divide-line">
              {sessions.map((s) => (
                <li key={s.id} className="py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link href={`/votes/${s.id}`} className="font-medium text-brand underline">{s.name}</Link>
                      <p className="text-sm text-muted"><VoteWhen s={s} /></p>
                      <p className="text-sm">{s.yes_count} người · {s.cups_total} cốc · {s.no_count} không</p>
                    </div>
                    <VoteStateBadge state={s.state} />
                  </div>
                  <SessionActions session={s} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Tạo đợt vote" className="order-1 lg:order-2"><CreateSessionForm today={today} /></Card>
      </div>
    </>
  );
}
