import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import type { ImportKind } from "@/lib/types";
import { IMPORT_SPECS, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, type ColumnSpec } from "./spec";

// Chỉ đọc cấu trúc file → JSON. Kiểm tra nghiệp vụ nằm ở api.import_stage (DB).

export interface ParseResult {
  ok: boolean;
  checksum: string;
  rows: Record<string, unknown>[];
  errors: string[];
}

export function sha256(buf: Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (typeof v === "object") {
    if (v instanceof Date) return v.toISOString();
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("text" in v && typeof v.text === "string") return v.text;
    if ("result" in v) return cellText(v.result as ExcelJS.CellValue);
    return "";
  }
  return String(v);
}

/** Ô ngày: Date (Excel lưu nửa đêm UTC) hoặc chữ "YYYY-MM-DD" / "DD/MM/YYYY" → "YYYY-MM-DD" */
export function toIsoDate(v: ExcelJS.CellValue): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === "object" && "result" in v) return toIsoDate(v.result as ExcelJS.CellValue);
  const s = cellText(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return s; // để DB báo "ngày không hợp lệ" cho đúng dòng
}

/** Ô tiền: số hoặc chữ "30.000" / "-5,000" → số nguyên; không đọc được → chuỗi gốc (DB báo lỗi dòng) */
export function toMoney(v: ExcelJS.CellValue): number | string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  if (typeof v === "object" && "result" in v) return toMoney(v.result as ExcelJS.CellValue);
  const s = cellText(v).trim().replace(/−/g, "-");
  if (/^-?[\d.,\s]+$/.test(s)) {
    const digits = s.replace(/[^\d]/g, "");
    if (digits) return (s.startsWith("-") ? -1 : 1) * Number(digits);
  }
  return s;
}

function toNumber(v: ExcelJS.CellValue): number | string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  if (typeof v === "object" && "result" in v) return toNumber(v.result as ExcelJS.CellValue);
  const s = cellText(v).trim().replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : s;
}

function headerKey(text: string, columns: ColumnSpec[]): string | null {
  const t = text.trim();
  const m = /\(([a-z_]+)\)\s*$/.exec(t);
  const key = m ? m[1] : t.toLowerCase();
  return columns.some((c) => c.key === key) ? key : null;
}

export async function parseImportFile(kind: ImportKind, data: Uint8Array): Promise<ParseResult> {
  const spec = IMPORT_SPECS[kind];
  const checksum = sha256(data);
  const fail = (...errors: string[]): ParseResult => ({ ok: false, checksum, rows: [], errors });
  if (data.byteLength > MAX_IMPORT_BYTES) return fail(`File vượt quá ${MAX_IMPORT_BYTES / 1024 / 1024} MB`);

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data as unknown as ArrayBuffer);
  } catch {
    return fail("Không đọc được file. Hãy dùng file .xlsx tải từ mẫu.");
  }
  const ws = wb.getWorksheet(spec.sheet) ?? wb.worksheets[0];
  if (!ws) return fail("File không có sheet dữ liệu");
  if (ws.name !== spec.sheet) return fail(`Không thấy sheet "${spec.sheet}". Hãy dùng mẫu import "${spec.title}".`);

  const colIndex = new Map<string, number>();
  ws.getRow(1).eachCell((cell, col) => {
    const k = headerKey(cellText(cell.value), spec.columns);
    if (k && !colIndex.has(k)) colIndex.set(k, col);
  });
  const missing = spec.columns.filter((c) => c.required && !colIndex.has(c.key)).map((c) => c.label);
  if (missing.length) return fail(`Thiếu cột bắt buộc: ${missing.join(", ")}`);

  const rows: Record<string, unknown>[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const obj: Record<string, unknown> = { row_no: r };
    let hasValue = false;
    for (const c of spec.columns) {
      const idx = colIndex.get(c.key);
      if (!idx) continue;
      const raw = row.getCell(idx).value;
      const value = c.type === "date" ? toIsoDate(raw) : c.type === "money" ? toMoney(raw) : c.type === "number" ? toNumber(raw) : cellText(raw).trim() || null;
      if (value !== null && value !== "") hasValue = true;
      obj[c.key] = value;
    }
    if (hasValue) rows.push(obj);
    if (rows.length > MAX_IMPORT_ROWS) return fail(`Tối đa ${MAX_IMPORT_ROWS} dòng mỗi file`);
  }
  if (rows.length === 0) return fail("File không có dòng dữ liệu");
  return { ok: true, checksum, rows, errors: [] };
}
