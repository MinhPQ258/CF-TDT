import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { callRpc } from "@/lib/rpc";
import { vnToday } from "@/lib/dates";
import type { VoteSessionDetail } from "@/lib/types";
import { Alert, PageHeader } from "@/components/ui";
import { CreateSessionForm } from "@/components/create-session-form";
import { SessionActions } from "../session-admin";

export const metadata: Metadata = { title: "Chỉnh sửa đợt pha" };

const vnHHmm = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" });

/** Chỉnh sửa đợt: cùng giao diện với màn Tạo đợt; bên dưới là Chốt sớm / Hủy đợt */
export default async function EditVoteSessionPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const r = await callRpc<VoteSessionDetail>("vote_session_detail", { p_session_id: id });
  if (!r.ok) notFound();
  const s = r.data;
  const live = s.state === "OPEN" || s.state === "UPCOMING" || s.state === "DRAFT";
  const back = `/admin/votes?s=${s.id}`;

  return (
    <>
      <PageHeader back={back} backLabel="Quay lại Đợt pha" title="Chỉnh sửa đợt" subtitle={s.name} />
      {!live ? (
        <Alert tone="warn" title="Không sửa được">Đợt đã chốt hoặc đã hủy.</Alert>
      ) : (
        <div className="space-y-4">
          {s.yes_count + s.no_count > 0 && (
            <p className="rounded-lg bg-brand-soft px-3 py-2 text-sm">
              Đã có {s.yes_count + s.no_count} phiếu. Bỏ một lựa chọn đã có người chọn thì lựa chọn đó chỉ bị ẩn, phiếu cũ giữ nguyên.
            </p>
          )}
          <CreateSessionForm today={vnToday()} doneBase="/admin/votes" doneHref={back} editing={{
            id: s.id, name: s.name, service_date: s.service_date, opens: vnHHmm(s.opens_at), cutoff: vnHHmm(s.cutoff_at),
            styles: s.options.styles.map((x) => x.label), addons: s.options.addons.map((x) => x.label), allow_cups: s.allow_cups,
          }} />
          <div className="max-w-md"><SessionActions session={s} /></div>
        </div>
      )}
    </>
  );
}
