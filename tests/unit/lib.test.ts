import { describe, expect, test } from "vitest";
import ExcelJS from "exceljs";
import { formatVnd, parseVnd } from "@/lib/money";
import { toAppError, messageFor } from "@/lib/errors";
import { addDays, isIsoDate, vnLocalToIso, vnToday } from "@/lib/dates";
import { buildTemplate } from "@/lib/excel/template";
import { parseImportFile, toIsoDate, toMoney } from "@/lib/excel/parse";
import { EXPORT_SHEETS, buildExport, type ExportData } from "@/lib/excel/export";
import { IMPORT_SPECS, headerText } from "@/lib/excel/spec";

describe("money", () => {
  test("định dạng VND với dấu trừ thật", () => {
    expect(formatVnd(1234567)).toBe("1.234.567 ₫");
    expect(formatVnd(-1234567)).toBe("−1.234.567 ₫");
    expect(formatVnd(5000, { sign: true })).toBe("+5.000 ₫");
    expect(formatVnd(0, { sign: true })).toBe("0 ₫");
  });
  test("đọc số tiền người dùng gõ", () => {
    expect(parseVnd("30.000")).toBe(30000);
    expect(parseVnd("30,000 ₫")).toBe(30000);
    expect(parseVnd("−5 000")).toBe(-5000);
    expect(parseVnd("")).toBeNull();
    expect(parseVnd("abc")).toBeNull();
    expect(parseVnd("99999999999999")).toBeNull();
  });
});

describe("errors", () => {
  test("map mã lỗi P0001 sang tiếng Việt", () => {
    expect(toAppError({ code: "P0001", message: "MEMBERSHIP_CHANGED" })).toMatchObject({ code: "MEMBERSHIP_CHANGED" });
    expect(toAppError({ code: "P0001", message: "INVALID_INPUT", details: "dòng 2: thiếu tên" }).message).toContain("dòng 2");
    expect(toAppError({ code: "23P01", message: "conflicting key" }).code).toBe("MEMBERSHIP_OVERLAP");
    expect(toAppError({ code: "PGRST301", message: "JWT expired" }).code).toBe("SESSION_EXPIRED");
    expect(toAppError(new TypeError("fetch failed")).code).toBe("NETWORK");
    expect(toAppError({ code: "XX000", message: "boom" }).code).toBe("UNKNOWN");
  });
  test("VOTE_CLOSED kèm giờ chốt theo giờ VN", () => {
    expect(messageFor("VOTE_CLOSED", "2026-09-25T02:00:00Z")).toMatch(/09:00/);
  });
});

describe("dates", () => {
  test("giờ VN", () => {
    expect(vnToday(new Date("2026-09-24T17:30:00Z"))).toBe("2026-09-25");
    expect(vnLocalToIso("2026-09-25", "09:00")).toBe("2026-09-25T02:00:00.000Z");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(isIsoDate("2026-02-30")).toBe(false);
  });
});

describe("excel", () => {
  test("ô ngày/tiền", () => {
    expect(toIsoDate(new Date(Date.UTC(2026, 9, 1)))).toBe("2026-10-01");
    expect(toIsoDate("1/10/2026")).toBe("2026-10-01");
    expect(toMoney("30.000")).toBe(30000);
    expect(toMoney("-5,000")).toBe(-5000);
    expect(toMoney(1200)).toBe(1200);
  });

  test("mẫu → điền → đọc lại; checksum ổn định", async () => {
    const tpl = await buildTemplate("PURCHASES");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(tpl as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Mua_do")!;
    expect(ws.getRow(1).getCell(1).value).toBe(headerText(IMPORT_SPECS.PURCHASES.columns[0]));
    ws.addRow(["HD2", "2026-10-02", "MEMBER", "anhnv", "", "DISCOUNT", "Giảm", null, null, -5000, ""]);
    ws.addRow([]); // dòng trống bị bỏ qua
    const buf = new Uint8Array(await wb.xlsx.writeBuffer());
    const r1 = await parseImportFile("PURCHASES", buf);
    const r2 = await parseImportFile("PURCHASES", buf);
    expect(r1.ok).toBe(true);
    expect(r1.checksum).toBe(r2.checksum);
    expect(r1.rows).toHaveLength(2);
    expect(r1.rows[0]).toMatchObject({ row_no: 2, external_ref: "CK-2026-001", line_amount_vnd: 250000, quantity: 1 });
    expect(r1.rows[1]).toMatchObject({ row_no: 3, paid_by: "MEMBER", line_type: "DISCOUNT", line_amount_vnd: -5000 });
  });

  test("sai sheet / thiếu cột → lỗi cấu trúc, không có dòng", async () => {
    const tpl = await buildTemplate("DEPOSITS");
    expect((await parseImportFile("GIFTS", new Uint8Array(tpl))).errors[0]).toMatch(/Tien_cho_them/);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Tien_nop");
    ws.addRow(["Mã chứng từ (external_ref)", "Ngày (occurred_on)"]);
    ws.addRow(["X", "2026-10-01"]);
    const r = await parseImportFile("DEPOSITS", new Uint8Array(await wb.xlsx.writeBuffer()));
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/Thiếu cột bắt buộc/);
    expect((await parseImportFile("DEPOSITS", new Uint8Array([1, 2, 3]))).errors[0]).toMatch(/Không đọc được/);
  });

  test("xuất đủ 6 sheet, tổng số dư = quỹ cuối kỳ", async () => {
    const data: ExportData = {
      period: { from: "2026-10-01", to: "2026-10-31" },
      overview: { period: { from: "2026-10-01", to: "2026-10-31" }, cash_balance_vnd: 30000, cash_opening_vnd: 0, cash_closing_vnd: 30000,
        costs_incurred_vnd: 150000, fund_spent_vnd: 90000, deposits_vnd: 90000, gifts_vnd: 30000, owing: { people: 2, total_vnd: 20000 },
        left_unsettled: [], active_members: 3, invariant: { cash_vnd: 30000, member_vnd: 30000, diff_vnd: 0 }, last_reconciliation: null },
      members: [
        { user_id: "a", employee_code: "A", display_name: "A", status: "ACTIVE", opening_vnd: 0, closing_vnd: 50000, balance_now_vnd: 50000, is_member_today: true, left_unsettled: false,
          movement: { DEPOSIT_CREDIT: 30000, PURCHASE_CREDIT: 60000, GIFT_SHARE: 10000, PURCHASE_SHARE: -50000, REIMBURSEMENT_DEBIT: 0 } },
        { user_id: "b", employee_code: "B", display_name: "B", status: "ACTIVE", opening_vnd: 0, closing_vnd: -10000, balance_now_vnd: -10000, is_member_today: true, left_unsettled: false,
          movement: { DEPOSIT_CREDIT: 30000, PURCHASE_CREDIT: 0, GIFT_SHARE: 10000, PURCHASE_SHARE: -50000, REIMBURSEMENT_DEBIT: 0 } },
        { user_id: "c", employee_code: "C", display_name: "C", status: "ACTIVE", opening_vnd: 0, closing_vnd: -10000, balance_now_vnd: -10000, is_member_today: true, left_unsettled: false,
          movement: { DEPOSIT_CREDIT: 30000, PURCHASE_CREDIT: 0, GIFT_SHARE: 10000, PURCHASE_SHARE: -50000, REIMBURSEMENT_DEBIT: 0 } },
      ],
      deposits: [], gifts: [], purchases: [], purchase_lines: [], votes: [],
    };
    const buf = await buildExport(data);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual([...EXPORT_SHEETS]);
    const m = wb.getWorksheet("So_du_theo_nguoi")!;
    const totalRow = m.getRow(m.rowCount);
    expect(totalRow.getCell(9).value).toBe(data.overview.cash_closing_vnd);
  });
});
