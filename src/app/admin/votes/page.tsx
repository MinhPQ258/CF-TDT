import Link from "next/link";
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { loadRpc } from "@/lib/rpc";
import { addDays, vnToday } from "@/lib/dates";
import type { VoteSession, VoteTemplate } from "@/lib/types";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui";
import { VoteStateBadge, VoteWhen } from "@/components/vote-bits";
import { CreateSessionForm } from "./create-session-form";

export const metadata: Metadata = { title: "Đợt pha & vote" };

export default async function AdminVotesPage() {
  await requireAdmin();
  const today = vnToday();
  const [sessions, templates] = await Promise.all([
    loadRpc<VoteSession[]>("list_vote_sessions", { p_from: addDays(today, -30), p_to: addDays(today, 30) }),
    loadRpc<VoteTemplate[]>("admin_vote_templates"),
  ]);
  const open = sessions.filter((s) => s.state === "OPEN");

  return (
    <>
      <PageHeader title="Đợt pha & vote" subtitle="Tạo đợt trong vài giây bằng cách dùng lại lựa chọn của đợt trước." />
      {open.length > 0 && (
        <div className="mb-4">
          <Alert tone="ok" title={`${open.length} đợt đang mở`}>
            <ul className="mt-1 space-y-1">
              {open.map((s) => (
                <li key={s.id}>
                  <Link className="font-medium text-brand underline" href={`/admin/votes/${s.id}`}>{s.name}</Link>
                  {" "}· {s.yes_count} người · {s.cups_total} cốc
                </li>
              ))}
            </ul>
          </Alert>
        </div>
      )}
      <CreateSessionForm today={today} templates={templates} />

      <Card title="30 ngày gần đây" className="mt-4">
        {sessions.length === 0 ? <EmptyState title="Chưa có đợt pha nào" /> : (
          <ul className="divide-y divide-line">
            {sessions.map((s) => (
              <li key={s.id}>
                <Link href={`/admin/votes/${s.id}`} className="flex flex-wrap items-center justify-between gap-2 py-3 hover:bg-bg">
                  <span className="min-w-0">
                    <span className="block font-medium text-brand">{s.name}</span>
                    <span className="text-sm text-muted"><VoteWhen s={s} /></span>
                  </span>
                  <span className="flex items-center gap-3 text-sm">
                    <span>{s.yes_count} người · {s.cups_total} cốc</span>
                    <VoteStateBadge state={s.state} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
