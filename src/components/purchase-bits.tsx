import { LINE_TYPE_LABEL } from "@/lib/labels";
import type { PurchaseLine, SplitInfo } from "@/lib/types";
import { Money, Table } from "@/components/ui";
import { formatVnd } from "@/lib/money";

export function PurchaseLines({ lines, total }: { lines: PurchaseLine[]; total: number }) {
  return (
    <>
      <ul className="divide-y divide-line md:hidden">
        {lines.map((l) => (
          <li key={l.line_no} className="flex items-start justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="break-words font-medium">{l.item_name}</p>
              <p className="text-sm text-muted">{LINE_TYPE_LABEL[l.line_type]}{l.quantity ? ` · ${l.quantity} ${l.unit ?? ""}` : ""}</p>
            </div>
            <Money value={l.line_amount_vnd} tone={false} />
          </li>
        ))}
        <li className="flex justify-between py-2 font-semibold"><span>Tổng</span><Money value={total} tone={false} /></li>
      </ul>
      <Table className="hidden md:block">
        <thead><tr><th>#</th><th>Loại</th><th>Mặt hàng</th><th>SL</th><th className="text-right">Thành tiền</th></tr></thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.line_no}>
              <td>{l.line_no}</td><td>{LINE_TYPE_LABEL[l.line_type]}</td><td className="break-words">{l.item_name}</td>
              <td>{l.quantity ? `${l.quantity} ${l.unit ?? ""}` : "—"}</td>
              <td className="text-right"><Money value={l.line_amount_vnd} tone={false} /></td>
            </tr>
          ))}
          <tr className="font-semibold"><td colSpan={4}>Tổng phiếu</td><td className="text-right"><Money value={total} tone={false} /></td></tr>
        </tbody>
      </Table>
    </>
  );
}

/** Câu giải thích làm tròn theo BA §3 */
export function SplitExplanation({ total, split }: { total: number; split: SplitInfo }) {
  return (
    <p className="text-sm text-muted">
      {formatVnd(total)} chia đều cho <strong>{split.n}</strong> thành viên: mỗi người {formatVnd(split.base_share_vnd)}
      {split.remainder > 0
        ? <>; còn dư {split.remainder} đồng nên {split.remainder} người đầu theo thứ tự mã nhân viên chịu thêm 1 đồng.</>
        : " (chia hết)."}
    </p>
  );
}
