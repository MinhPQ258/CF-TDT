import ExcelJS from "exceljs";
import type { ImportKind } from "@/lib/types";
import { IMPORT_SPECS, headerText } from "./spec";

/** File mẫu: sheet dữ liệu (tiêu đề + 1 dòng ví dụ) + sheet hướng dẫn */
export async function buildTemplate(kind: ImportKind): Promise<Buffer> {
  const spec = IMPORT_SPECS[kind];
  const wb = new ExcelJS.Workbook();
  wb.creator = "Coffee TDT";
  const ws = wb.addWorksheet(spec.sheet, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = spec.columns.map((c) => ({ header: headerText(c), key: c.key, width: c.width ?? 14 }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3E9E1" } };
  const example: Record<string, string | number> = {};
  for (const c of spec.columns) example[c.key] = c.example;
  ws.addRow(example);
  spec.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (c.type === "money") col.numFmt = "#,##0";
    if (c.type === "date") col.numFmt = "@"; // nhập dạng chữ YYYY-MM-DD để tránh lệch múi giờ
  });

  const help = wb.addWorksheet("Huong_dan");
  help.columns = [{ header: "Cột", key: "col", width: 28 }, { header: "Bắt buộc", key: "req", width: 10 }, { header: "Ghi chú", key: "help", width: 70 }];
  help.getRow(1).font = { bold: true };
  for (const c of spec.columns) help.addRow({ col: headerText(c), req: c.required ? "Có" : "", help: c.help ?? "" });
  help.addRow({});
  for (const n of [`Loại import: ${spec.title}. Giữ nguyên dòng tiêu đề; xóa dòng ví dụ trước khi nhập.`, ...spec.notes,
    "Import nguyên khối: một dòng lỗi thì không ghi dòng nào.", "Cùng một file chỉ import được một lần."]) {
    help.addRow({ col: n });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
