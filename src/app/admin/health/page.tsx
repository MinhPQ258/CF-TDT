import Link from "next/link";
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { loadRpc } from "@/lib/rpc";
import { formatDateTime } from "@/lib/dates";
import type { Health } from "@/lib/types";
import { Alert, Card, Money, PageHeader, Stat, Table } from "@/components/ui";
import { ReconcileButton } from "./reconcile-button";

export const metadata: Metadata = { title: "Sức khỏe sổ" };

export default async function HealthPage() {
  await requireAdmin();
  const h = await loadRpc<Health>("admin_health");
  const healthy = h.diff_vnd === 0 && h.bad_events.length === 0 && !h.cash_negative;

  return (
    <>
      <PageHeader title="Sức khỏe sổ" subtitle="Bất biến: Σ số dư thành viên = Σ tiền quỹ thực, cho từng giao dịch và toàn sổ." actions={<ReconcileButton />} />
      <div className="mb-4">
        {healthy
          ? <Alert tone="ok" title="Sổ khớp">Không có giao dịch lệch.</Alert>
          : <Alert tone="danger" title="Phát hiện bất thường">Không tự sửa số liệu. Kiểm tra các giao dịch dưới đây; sửa sai bằng giao dịch đảo.</Alert>}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Σ quỹ (cash)" value={<Money value={h.cash_vnd} />} tone={h.cash_negative ? "danger" : undefined} />
        <Stat label="Σ thành viên" value={<Money value={h.member_vnd} />} />
        <Stat label="Chênh lệch" value={<Money value={h.diff_vnd} />} tone={h.diff_vnd !== 0 ? "danger" : undefined} />
        <Stat label="Số giao dịch" value={h.event_count} />
      </div>

      {h.bad_events.length > 0 && (
        <Card title="Giao dịch lệch" className="mt-4">
          <ul className="divide-y divide-line">
            {h.bad_events.map((e) => (
              <li key={e.event_id} className="flex flex-wrap justify-between gap-2 py-2">
                <Link className="text-brand underline" href={`/admin/fund/${e.event_id}`}>{e.event_id.slice(0, 8)}…</Link>
                <span>member <Money value={e.member_vnd} /> · cash <Money value={e.cash_vnd} /></span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Các lần đối soát" className="mt-4">
        {h.last_runs.length === 0 ? <p className="text-muted">Chưa chạy lần nào. Cron Vercel chạy lúc 00:00 hằng ngày.</p> : (
          <Table>
            <thead><tr><th>Thời điểm</th><th>Nguồn</th><th className="text-right">Σ cash</th><th className="text-right">Σ member</th><th className="text-right">Lệch</th></tr></thead>
            <tbody>
              {h.last_runs.map((r) => (
                <tr key={r.id}>
                  <td>{formatDateTime(r.ran_at, true)}</td><td>{r.source}</td>
                  <td className="text-right"><Money value={r.cash_total} /></td>
                  <td className="text-right"><Money value={r.member_total} /></td>
                  <td className="text-right font-semibold"><Money value={r.diff} /></td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card title="Nhật ký thao tác gần đây" className="mt-4">
        <ul className="divide-y divide-line text-sm">
          {h.recent_audit.map((a, i) => (
            <li key={i} className="flex flex-wrap justify-between gap-2 py-2">
              <span><strong>{a.action}</strong> · {a.actor ?? "hệ thống"}{a.reason ? ` · ${a.reason}` : ""}</span>
              <span className="text-muted">{formatDateTime(a.occurred_at, true)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
