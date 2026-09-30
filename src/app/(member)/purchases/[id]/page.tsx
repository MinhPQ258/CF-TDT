import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { callRpc } from "@/lib/rpc";
import { formatDate } from "@/lib/dates";
import { ENTRY_TYPE_LABEL } from "@/lib/labels";
import type { PurchaseDetail } from "@/lib/types";
import { Alert, Card, Money, PageHeader } from "@/components/ui";
import { PurchaseLines, SplitExplanation } from "@/components/purchase-bits";

export const metadata: Metadata = { title: "Chi tiết phiếu mua" };

export default async function PurchaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const r = await callRpc<PurchaseDetail>("purchase_detail", { p_purchase_id: id });
  if (!r.ok) notFound();
  const p = r.data;

  return (
    <>
      <PageHeader
        title={p.shop ?? "Phiếu mua"}
        subtitle={`${formatDate(p.purchased_on)} · ${p.paid_by === "FUND" ? "Quỹ trả" : `${p.payer} mua hộ`}${p.external_ref ? ` · Mã ${p.external_ref}` : ""}`}
        back={me.role === "ADMIN" ? "/admin/purchases" : "/purchases"} backLabel="Quay lại danh sách phiếu"
      />
      {p.reversal && (
        <div className="mb-4">
          <Alert tone="warn" title={`Phiếu đã được đảo ngày ${formatDate(p.reversal.occurred_on)}`}>Lý do: {p.reversal.reason}. Phần chia của phiếu này đã được hoàn lại.</Alert>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card title="Các dòng">
          <PurchaseLines lines={p.lines} total={p.total_vnd} />
          {p.notes && <p className="mt-3 text-sm text-muted">Ghi chú: {p.notes}</p>}
        </Card>
        <Card title="Phần của bạn">
          <p className="text-3xl font-bold"><Money value={p.my_share_vnd} /></p>
          {p.my_credit_vnd > 0 && <p className="mt-1">Được ghi có mua hộ: <Money value={p.my_credit_vnd} sign /></p>}
          {p.my_share_vnd === 0 && p.my_credit_vnd === 0 && <p className="mt-1 text-sm text-muted">Bạn không thuộc quỹ tại ngày phiếu nên không bị chia.</p>}
          <div className="mt-3"><SplitExplanation total={p.total_vnd} split={p.split} /></div>
        </Card>
      </div>
      {p.allocations && (
        <Card title="Bảng phân bổ (quản trị)" className="mt-4">
          <ul className="divide-y divide-line">
            {p.allocations.map((a, i) => (
              <li key={i} className="flex justify-between gap-3 py-2">
                <span className="min-w-0 truncate">{a.employee_code} · {a.display_name} <span className="text-sm text-muted">({ENTRY_TYPE_LABEL[a.entry_type]})</span></span>
                <Money value={a.amount_vnd} sign />
              </li>
            ))}
          </ul>
          <Link href={`/admin/fund/${p.fund_event_id}`} className="mt-3 inline-flex min-h-11 items-center text-brand underline">Mở giao dịch trong sổ quỹ →</Link>
        </Card>
      )}
    </>
  );
}
