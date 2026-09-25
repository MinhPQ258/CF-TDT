import Link from "next/link";
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { loadRpc } from "@/lib/rpc";
import { firstOfMonth, formatDate, formatDateTime, isIsoDate, vnToday } from "@/lib/dates";
import type { MemberBalanceRow, Overview } from "@/lib/types";
import { Alert, Badge, Card, EmptyState, LinkButton, Money, PageHeader, Stat, Table } from "@/components/ui";
import { PeriodFilter } from "@/components/period-filter";

export const metadata: Metadata = { title: "Tổng quan" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const today = vnToday();
  const from = isIsoDate(sp.from) ? sp.from : firstOfMonth(today);
  const to = isIsoDate(sp.to) ? sp.to : today;
  const [ov, members] = await Promise.all([
    loadRpc<Overview>("admin_overview", { p_from: from, p_to: to }),
    loadRpc<MemberBalanceRow[]>("admin_member_balances", {}),
  ]);
  const invariantBad = ov.invariant.diff_vnd !== 0 || (ov.last_reconciliation && ov.last_reconciliation.diff !== 0);

  return (
    <>
      <PageHeader
        title="Tổng quan quỹ"
        subtitle={`Kỳ ${formatDate(ov.period.from)} – ${formatDate(ov.period.to)}`}
        actions={<><LinkButton href="/admin/purchases/new" variant="primary">+ Phiếu mua</LinkButton><LinkButton href="/admin/fund?form=DEPOSIT">+ Tiền nộp</LinkButton></>}
      />
      {(invariantBad || ov.cash_balance_vnd < 0) && (
        <div className="mb-4">
          <Alert tone="danger" title="Sổ quỹ cần kiểm tra">
            {invariantBad && <p>Σ số dư thành viên lệch Σ quỹ {ov.invariant.diff_vnd} ₫. Không tự sửa — xem giao dịch nghi vấn.</p>}
            {ov.cash_balance_vnd < 0 && <p>Tiền quỹ thực đang âm.</p>}
            <Link href="/admin/health" className="underline">Mở trang Sức khỏe sổ →</Link>
          </Alert>
        </div>
      )}
      <div className="mb-4"><PeriodFilter from={from} to={to} action="/admin/dashboard" /></div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Tiền quỹ thực còn" value={<Money value={ov.cash_balance_vnd} />} hint={`${ov.active_members} thành viên quỹ hôm nay`} tone={ov.cash_balance_vnd < 0 ? "danger" : undefined} />
        <Stat label="Chi phí phát sinh (kỳ)" value={<Money value={ov.costs_incurred_vnd} tone={false} />} hint="Mọi phiếu mua: quỹ trả + mua hộ" />
        <Stat label="Quỹ đã chi (kỳ)" value={<Money value={ov.fund_spent_vnd} tone={false} />} hint="Phiếu quỹ trả + hoàn tiền" />
        <Stat label="Cần nộp thêm" value={<Money value={ov.owing.total_vnd} tone={false} />} hint={`${ov.owing.people} người đang âm`} />
        <Stat label="Tiền nộp (kỳ)" value={<Money value={ov.deposits_vnd} tone={false} />} />
        <Stat label="Tiền cho thêm (kỳ)" value={<Money value={ov.gifts_vnd} tone={false} />} />
        <Stat label="Quỹ đầu kỳ → cuối kỳ" value={<span className="text-lg"><Money value={ov.cash_opening_vnd} /> → <Money value={ov.cash_closing_vnd} /></span>} />
        <Stat label="Đối soát gần nhất" value={<span className="text-lg">{ov.last_reconciliation ? (ov.last_reconciliation.diff === 0 ? "Khớp" : "LỆCH") : "Chưa chạy"}</span>}
          hint={ov.last_reconciliation ? formatDateTime(ov.last_reconciliation.ran_at, true) : "Cron chạy hằng đêm"} />
      </div>

      {ov.left_unsettled.length > 0 && (
        <div className="mt-4">
          <Alert tone="warn" title={`${ov.left_unsettled.length} người đã rời quỹ nhưng chưa tất toán`}>
            <ul className="mt-1 space-y-1">
              {ov.left_unsettled.map((u) => (
                <li key={u.user_id} className="flex flex-wrap justify-between gap-2">
                  <span>{u.employee_code} · {u.display_name}</span>
                  <span><Money value={u.balance_vnd} sign /> — {u.balance_vnd < 0 ? "ghi tiền nộp để tất toán" : "ghi hoàn tiền để tất toán"}</span>
                </li>
              ))}
            </ul>
          </Alert>
        </div>
      )}

      <Card title="Số dư từng người" className="mt-4" actions={<Link className="text-brand underline" href="/admin/reports">Báo cáo theo kỳ →</Link>}>
        {members.length === 0 ? (
          <EmptyState title="Quỹ chưa có thành viên" action={<LinkButton href="/admin/memberships" variant="primary">Thêm thành viên quỹ</LinkButton>} />
        ) : (
          <>
            <ul className="divide-y divide-line md:hidden">
              {members.map((m) => (
                <li key={m.user_id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{m.display_name}</span>
                    <span className="text-sm text-muted">{m.employee_code}{!m.is_member_today && " · đã rời quỹ"}</span>
                  </span>
                  <span className="text-right">
                    <Money value={m.balance_now_vnd} sign className="font-semibold" />
                    <span className="block text-xs text-muted">{m.balance_now_vnd < 0 ? "cần nộp" : m.balance_now_vnd > 0 ? "đang dư" : ""}</span>
                  </span>
                </li>
              ))}
            </ul>
            <Table className="hidden md:block">
              <thead><tr><th>Mã NV</th><th>Tên</th><th>Trạng thái</th><th className="text-right">Đã nộp</th><th className="text-right">Mua hộ</th><th className="text-right">Được chia quà</th><th className="text-right">Chi phí chia</th><th className="text-right">Đã hoàn</th><th className="text-right">Số dư</th></tr></thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.user_id}>
                    <td>{m.employee_code}</td>
                    <td className="max-w-48 truncate">{m.display_name}</td>
                    <td>{m.left_unsettled ? <Badge tone="warn">Rời, chưa tất toán</Badge> : m.is_member_today ? <Badge tone="ok">Thành viên</Badge> : <Badge>Đã rời</Badge>}</td>
                    <td className="text-right"><Money value={m.movement.DEPOSIT_CREDIT} tone={false} /></td>
                    <td className="text-right"><Money value={m.movement.PURCHASE_CREDIT} tone={false} /></td>
                    <td className="text-right"><Money value={m.movement.GIFT_SHARE} tone={false} /></td>
                    <td className="text-right"><Money value={m.movement.PURCHASE_SHARE} tone={false} /></td>
                    <td className="text-right"><Money value={m.movement.REIMBURSEMENT_DEBIT} tone={false} /></td>
                    <td className="text-right font-semibold"><Money value={m.balance_now_vnd} sign /></td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </>
        )}
      </Card>
    </>
  );
}
