import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { loadRpc } from "@/lib/rpc";
import { firstOfMonth, formatDate, isIsoDate, vnToday } from "@/lib/dates";
import type { MemberBalanceRow, Overview } from "@/lib/types";
import { Card, Money, PageHeader, Stat, Table, buttonClass } from "@/components/ui";
import { PeriodFilter } from "@/components/period-filter";

export const metadata: Metadata = { title: "Báo cáo" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const today = vnToday();
  const from = isIsoDate(sp.from) ? sp.from : firstOfMonth(today);
  const to = isIsoDate(sp.to) ? sp.to : today;
  const [ov, rows] = await Promise.all([
    loadRpc<Overview>("admin_overview", { p_from: from, p_to: to }),
    loadRpc<MemberBalanceRow[]>("admin_member_balances", { p_from: from, p_to: to }),
  ]);
  const sum = (f: (r: MemberBalanceRow) => number) => rows.reduce((s, r) => s + f(r), 0);

  return (
    <>
      <PageHeader title="Báo cáo theo kỳ" subtitle={`${formatDate(from)} – ${formatDate(to)}: số dư đầu kỳ, biến động theo loại, số dư cuối kỳ`}
        actions={<a className={buttonClass("primary")} href={`/api/admin/export?from=${from}&to=${to}`}>Xuất Excel kỳ này</a>} />
      <div className="mb-4"><PeriodFilter from={from} to={to} action="/admin/reports" /></div>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Quỹ đầu kỳ" value={<Money value={ov.cash_opening_vnd} />} />
        <Stat label="Quỹ cuối kỳ" value={<Money value={ov.cash_closing_vnd} />} />
        <Stat label="Σ số dư cuối kỳ thành viên" value={<Money value={sum((r) => r.closing_vnd)} />}
          hint={sum((r) => r.closing_vnd) === ov.cash_closing_vnd ? "Khớp quỹ cuối kỳ" : "LỆCH quỹ — kiểm tra Sức khỏe sổ"} />
      </div>
      <Card title="Theo người">
        <Table>
          <thead>
            <tr><th>Mã NV</th><th>Tên</th><th className="text-right">Đầu kỳ</th><th className="text-right">Đã nộp</th><th className="text-right">Mua hộ</th><th className="text-right">Quà</th><th className="text-right">Chi phí</th><th className="text-right">Hoàn</th><th className="text-right">Cuối kỳ</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.user_id}>
                <td>{r.employee_code}</td><td className="max-w-48 truncate">{r.display_name}</td>
                <td className="text-right"><Money value={r.opening_vnd} /></td>
                <td className="text-right"><Money value={r.movement.DEPOSIT_CREDIT} tone={false} /></td>
                <td className="text-right"><Money value={r.movement.PURCHASE_CREDIT} tone={false} /></td>
                <td className="text-right"><Money value={r.movement.GIFT_SHARE} tone={false} /></td>
                <td className="text-right"><Money value={r.movement.PURCHASE_SHARE} tone={false} /></td>
                <td className="text-right"><Money value={r.movement.REIMBURSEMENT_DEBIT} tone={false} /></td>
                <td className="text-right font-semibold"><Money value={r.closing_vnd} sign /></td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td colSpan={2}>Tổng</td>
              <td className="text-right"><Money value={sum((r) => r.opening_vnd)} /></td>
              <td className="text-right"><Money value={sum((r) => r.movement.DEPOSIT_CREDIT)} tone={false} /></td>
              <td className="text-right"><Money value={sum((r) => r.movement.PURCHASE_CREDIT)} tone={false} /></td>
              <td className="text-right"><Money value={sum((r) => r.movement.GIFT_SHARE)} tone={false} /></td>
              <td className="text-right"><Money value={sum((r) => r.movement.PURCHASE_SHARE)} tone={false} /></td>
              <td className="text-right"><Money value={sum((r) => r.movement.REIMBURSEMENT_DEBIT)} tone={false} /></td>
              <td className="text-right"><Money value={sum((r) => r.closing_vnd)} sign /></td>
            </tr>
          </tbody>
        </Table>
      </Card>
    </>
  );
}
