import ExcelJS from "exceljs";
import type { MemberBalanceRow, Overview } from "@/lib/types";
import { ENTRY_TYPE_LABEL, EVENT_KIND_LABEL } from "@/lib/labels";

// Dữ liệu từ api.admin_export_data → workbook 6 sheet (BA §5, DBA §5).

export interface ExportData {
  period: { from: string; to: string };
  overview: Overview;
  members: MemberBalanceRow[];
  deposits: { occurred_on: string; employee_code: string | null; display_name: string | null; amount_vnd: number; external_ref: string | null; kind: string; status: string; note: string | null }[];
  gifts: { occurred_on: string; amount_vnd: number; share_count: number | null; external_ref: string | null; kind: string; status: string; note: string | null }[];
  purchases: { occurred_on: string; external_ref: string | null; shop: string | null; paid_by: string; payer: string | null; total_vnd: number; employee_code: string; display_name: string; entry_type: keyof typeof ENTRY_TYPE_LABEL; amount_vnd: number; is_reversal: boolean }[];
  purchase_lines: { purchased_on: string; external_ref: string | null; line_no: number; line_type: string; item_name: string; quantity: number | null; unit: string | null; line_amount_vnd: number }[];
  votes: { service_date: string; session: string; state: string; employee_code: string; display_name: string; choice: string; coffee_type: string | null; cups: number | null; note: string | null }[];
}

export const EXPORT_SHEETS = ["Tong_quan", "So_du_theo_nguoi", "Tien_nop", "Tien_cho_them", "Mua_do_va_phan_bo", "Vote"] as const;

const MONEY = "#,##0;[Red]-#,##0";

function sheet(wb: ExcelJS.Workbook, name: string, columns: { header: string; key: string; width?: number; money?: boolean }[]) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 14 }));
  ws.getRow(1).font = { bold: true };
  columns.forEach((c, i) => { if (c.money) ws.getColumn(i + 1).numFmt = MONEY; });
  return ws;
}

function kindLabel(kind: string): string {
  return EVENT_KIND_LABEL[kind as keyof typeof EVENT_KIND_LABEL] ?? kind;
}

export async function buildExport(d: ExportData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Coffee TDT";
  const o = d.overview;

  const t = sheet(wb, "Tong_quan", [{ header: "Chỉ tiêu", key: "k", width: 40 }, { header: "Giá trị", key: "v", width: 18, money: true }]);
  const rows: [string, number | string][] = [
    ["Kỳ", `${d.period.from} → ${d.period.to}`],
    ["Tiền quỹ đầu kỳ", o.cash_opening_vnd],
    ["Tiền nộp trong kỳ", o.deposits_vnd],
    ["Tiền cho thêm trong kỳ", o.gifts_vnd],
    ["Quỹ đã chi trong kỳ (phiếu quỹ trả + hoàn tiền)", o.fund_spent_vnd],
    ["Chi phí phát sinh trong kỳ (mọi phiếu mua)", o.costs_incurred_vnd],
    ["Tiền quỹ cuối kỳ", o.cash_closing_vnd],
    ["Tiền quỹ hiện tại", o.cash_balance_vnd],
    ["Số người đang cần nộp thêm", o.owing.people],
    ["Tổng số tiền cần nộp thêm", o.owing.total_vnd],
    ["Đối soát: Σ thành viên − Σ quỹ", o.invariant.diff_vnd],
  ];
  for (const [k, v] of rows) t.addRow({ k, v });
  t.getCell("B2").numFmt = "@";
  t.getCell("B10").numFmt = "0";

  const m = sheet(wb, "So_du_theo_nguoi", [
    { header: "Mã NV", key: "code", width: 10 }, { header: "Tên", key: "name", width: 24 },
    { header: "Số dư đầu kỳ", key: "open", money: true }, { header: "Đã nộp", key: "dep", money: true },
    { header: "Mua hộ (ghi có)", key: "pc", money: true }, { header: "Được chia quà", key: "gift", money: true },
    { header: "Chi phí được chia", key: "ps", money: true }, { header: "Đã được hoàn", key: "re", money: true },
    { header: "Số dư cuối kỳ", key: "close", money: true }, { header: "Cần nộp thêm", key: "need", money: true },
    { header: "Thành viên hôm nay", key: "mem", width: 12 }, { header: "Rời quỹ chưa tất toán", key: "left", width: 14 },
  ]);
  for (const r of d.members) {
    m.addRow({ code: r.employee_code, name: r.display_name, open: r.opening_vnd, dep: r.movement.DEPOSIT_CREDIT,
      pc: r.movement.PURCHASE_CREDIT, gift: r.movement.GIFT_SHARE, ps: r.movement.PURCHASE_SHARE, re: r.movement.REIMBURSEMENT_DEBIT,
      close: r.closing_vnd, need: r.closing_vnd < 0 ? -r.closing_vnd : 0, mem: r.is_member_today ? "Có" : "Không", left: r.left_unsettled ? "Có" : "" });
  }
  const total = m.addRow({ name: "TỔNG", close: d.members.reduce((s, r) => s + r.closing_vnd, 0) });
  total.font = { bold: true };

  const dep = sheet(wb, "Tien_nop", [
    { header: "Ngày", key: "d", width: 12 }, { header: "Loại", key: "k", width: 18 }, { header: "Mã NV", key: "code", width: 10 },
    { header: "Tên", key: "name", width: 24 }, { header: "Số tiền (± quỹ)", key: "a", money: true, width: 16 },
    { header: "Mã chứng từ", key: "ref", width: 16 }, { header: "Trạng thái", key: "s", width: 12 }, { header: "Ghi chú", key: "n", width: 30 },
  ]);
  for (const r of d.deposits) dep.addRow({ d: r.occurred_on, k: kindLabel(r.kind), code: r.employee_code, name: r.display_name, a: r.amount_vnd, ref: r.external_ref, s: r.status, n: r.note });

  const g = sheet(wb, "Tien_cho_them", [
    { header: "Ngày", key: "d", width: 12 }, { header: "Loại", key: "k", width: 18 }, { header: "Số tiền", key: "a", money: true },
    { header: "Số người chia", key: "n", width: 12 }, { header: "Mã chứng từ", key: "ref", width: 16 }, { header: "Trạng thái", key: "s", width: 12 }, { header: "Ghi chú", key: "note", width: 30 },
  ]);
  for (const r of d.gifts) g.addRow({ d: r.occurred_on, k: kindLabel(r.kind), a: r.amount_vnd, n: r.share_count, ref: r.external_ref, s: r.status, note: r.note });

  const items = new Map<string, string>();
  for (const l of d.purchase_lines) {
    const key = l.external_ref ?? `${l.purchased_on}`;
    items.set(key, [items.get(key), `${l.item_name}${l.line_amount_vnd < 0 ? " (−)" : ""}`].filter(Boolean).join("; "));
  }
  const p = sheet(wb, "Mua_do_va_phan_bo", [
    { header: "Ngày", key: "d", width: 12 }, { header: "Mã phiếu", key: "ref", width: 14 }, { header: "Cửa hàng", key: "shop", width: 18 },
    { header: "Mặt hàng", key: "items", width: 36 }, { header: "Nguồn trả", key: "pb", width: 10 }, { header: "Người mua hộ", key: "payer", width: 18 },
    { header: "Tổng phiếu", key: "total", money: true }, { header: "Mã NV", key: "code", width: 10 }, { header: "Tên", key: "name", width: 22 },
    { header: "Loại dòng", key: "type", width: 20 }, { header: "Số tiền", key: "a", money: true }, { header: "Dòng đảo", key: "rev", width: 9 },
  ]);
  for (const r of d.purchases) {
    p.addRow({ d: r.occurred_on, ref: r.external_ref, shop: r.shop, items: items.get(r.external_ref ?? "") ?? "", pb: r.paid_by === "FUND" ? "Quỹ" : "Mua hộ",
      payer: r.payer, total: r.total_vnd, code: r.employee_code, name: r.display_name, type: ENTRY_TYPE_LABEL[r.entry_type] ?? r.entry_type, a: r.amount_vnd, rev: r.is_reversal ? "Có" : "" });
  }

  const v = sheet(wb, "Vote", [
    { header: "Ngày", key: "d", width: 12 }, { header: "Đợt", key: "s", width: 20 }, { header: "Trạng thái", key: "st", width: 12 },
    { header: "Mã NV", key: "code", width: 10 }, { header: "Tên", key: "name", width: 22 }, { header: "Uống", key: "c", width: 8 },
    { header: "Loại pha", key: "t", width: 12 }, { header: "Số cốc", key: "cups", width: 8 }, { header: "Ghi chú", key: "n", width: 24 },
  ]);
  for (const r of d.votes) v.addRow({ d: r.service_date, s: r.session, st: r.state, code: r.employee_code, name: r.display_name, c: r.choice === "YES" ? "Có" : "Không", t: r.coffee_type, cups: r.cups, n: r.note });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
