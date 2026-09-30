import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { callRpc } from "@/lib/rpc";
import { formatDate, formatDateTime } from "@/lib/dates";
import { ENTRY_TYPE_LABEL, EVENT_KIND_LABEL } from "@/lib/labels";
import type { FundEventDetail } from "@/lib/types";
import { Alert, Badge, Card, Money, PageHeader } from "@/components/ui";
import { ReverseForm } from "./reverse-form";

export const metadata: Metadata = { title: "Chi tiết giao dịch" };

export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const r = await callRpc<FundEventDetail>("admin_event_detail", { p_event_id: id });
  if (!r.ok) notFound();
  const e = r.data;
  const memberSum = e.member_entries.reduce((s, m) => s + m.amount_vnd, 0);
  const cashSum = e.cash_entries.reduce((s, c) => s + c.amount_vnd, 0);

  return (
    <>
      <PageHeader
        title={`${EVENT_KIND_LABEL[e.kind]}${e.reverses_kind ? ` — ${EVENT_KIND_LABEL[e.reverses_kind]}` : ""}`}
        subtitle={`${formatDate(e.occurred_on)} · ghi bởi ${e.actor ?? "—"} lúc ${formatDateTime(e.created_at, true)}`}
        back="/admin/fund" backLabel="Quay lại Sổ quỹ"
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {e.status === "REVERSED" ? <Badge tone="warn">Đã đảo</Badge> : <Badge tone="ok">Đã ghi</Badge>}
        {e.external_ref && <Badge>Mã {e.external_ref}</Badge>}
        {e.import_job_id && <Badge tone="brand">Từ import Excel</Badge>}
        {memberSum === cashSum ? <Badge tone="ok">Cân: Σ member = Σ cash</Badge> : <Badge tone="danger">LỆCH</Badge>}
      </div>
      {e.reverses_event_id && (
        <div className="mb-4"><Alert tone="warn" title="Đây là giao dịch đảo">Lý do: {e.reason}. <Link className="underline" href={`/admin/fund/${e.reverses_event_id}`}>Xem giao dịch gốc</Link></Alert></div>
      )}
      {e.reversed_by_event_id && (
        <div className="mb-4"><Alert tone="warn" title="Giao dịch đã bị đảo"><Link className="underline" href={`/admin/fund/${e.reversed_by_event_id}`}>Xem giao dịch đảo</Link></Alert></div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">
          <Card title="Số tiền">
            <p className="text-3xl font-bold"><Money value={e.amount_vnd} tone={false} /></p>
            {e.subject && <p className="mt-1">Người liên quan: {e.subject}</p>}
            {e.note && <p className="mt-1 text-muted">Ghi chú: {e.note}</p>}
            {e.purchase_id && <Link className="mt-2 inline-flex min-h-11 items-center text-brand underline" href={`/purchases/${e.purchase_id}`}>Xem phiếu mua →</Link>}
          </Card>
          <Card title="Dòng sổ quỹ (cash)">
            {e.cash_entries.length === 0 ? <p className="text-muted">Không có (mua hộ không đi qua quỹ).</p> : (
              <ul>{e.cash_entries.map((c) => <li key={c.id} className="flex justify-between py-1"><span>{c.entry_type}</span><Money value={c.amount_vnd} sign /></li>)}</ul>
            )}
          </Card>
          <Card title={`Dòng sổ thành viên (${e.member_entries.length})`}>
            <ul className="divide-y divide-line">
              {e.member_entries.map((m) => (
                <li key={m.id} className="flex justify-between gap-3 py-2">
                  <span className="min-w-0 truncate">{m.employee_code} · {m.display_name} <span className="text-sm text-muted">({ENTRY_TYPE_LABEL[m.entry_type]})</span></span>
                  <Money value={m.amount_vnd} sign />
                </li>
              ))}
              <li className="flex justify-between py-2 font-semibold"><span>Tổng</span><Money value={memberSum} sign /></li>
            </ul>
          </Card>
        </div>
        <Card title="Đảo giao dịch">
          {e.status === "REVERSED" ? (
            <p className="text-muted">Giao dịch đã được đảo; mỗi giao dịch chỉ đảo được một lần.</p>
          ) : (
            <ReverseForm eventId={e.id} isReversal={e.kind === "REVERSAL"} />
          )}
        </Card>
      </div>
    </>
  );
}
