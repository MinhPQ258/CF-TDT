import type { ImportKind } from "@/lib/types";

// Định nghĩa cột cho từng loại import. Tiêu đề cột dạng "Nhãn (key)" — khi đọc chỉ dựa vào key.

export type ColumnType = "text" | "date" | "money" | "number";

export interface ColumnSpec {
  key: string;
  label: string;
  type: ColumnType;
  required?: boolean;
  example: string | number;
  width?: number;
  help?: string;
}

export interface ImportSpec {
  kind: ImportKind;
  sheet: string;
  title: string;
  columns: ColumnSpec[];
  notes: string[];
}

const ref = (label = "Mã chứng từ"): ColumnSpec => ({ key: "external_ref", label, type: "text", required: true, example: "CK-2026-001", width: 18, help: "Bắt buộc, không trùng; dùng để chống import trùng" });
const date = (key = "occurred_on", label = "Ngày"): ColumnSpec => ({ key, label, type: "date", required: true, example: "2026-10-01", width: 14, help: "YYYY-MM-DD hoặc ô kiểu Ngày; không ở tương lai" });

export const IMPORT_SPECS: Record<ImportKind, ImportSpec> = {
  MEMBERS: {
    kind: "MEMBERS", sheet: "Thanh_vien", title: "Thành viên quỹ",
    columns: [
      { key: "employee_code", label: "Mã NV", type: "text", required: true, example: "NV001", width: 12 },
      { key: "username", label: "Tên đăng nhập", type: "text", required: true, example: "anhnv", width: 16, help: "a-z 0-9 . _ - (3–32 ký tự)" },
      { key: "display_name", label: "Tên hiển thị", type: "text", required: true, example: "Nguyễn Văn Anh", width: 24 },
      { key: "role", label: "Vai trò", type: "text", example: "MEMBER", width: 10, help: "MEMBER hoặc ADMIN (mặc định MEMBER)" },
      date("start_date", "Ngày bắt đầu"),
      { key: "end_date", label: "Ngày kết thúc", type: "date", example: "", width: 14, help: "Để trống nếu đang tham gia" },
      { key: "reason", label: "Lý do", type: "text", example: "Go-live", width: 20 },
    ],
    notes: ["Tài khoản chưa có sẽ được tạo với mật khẩu tạm (hiện một lần sau khi ghi).", "KHÔNG nhập mật khẩu vào file."],
  },
  DEPOSITS: {
    kind: "DEPOSITS", sheet: "Tien_nop", title: "Tiền nộp",
    columns: [ref(), date(), { key: "username", label: "Tên đăng nhập", type: "text", required: true, example: "anhnv", width: 16 },
      { key: "amount_vnd", label: "Số tiền", type: "money", required: true, example: 30000, width: 14 },
      { key: "note", label: "Ghi chú", type: "text", example: "Nộp tháng 10", width: 24 }],
    notes: ["Chỉ ghi khoản quỹ đã thực nhận."],
  },
  GIFTS: {
    kind: "GIFTS", sheet: "Tien_cho_them", title: "Tiền cho thêm",
    columns: [ref(), date(), { key: "amount_vnd", label: "Số tiền", type: "money", required: true, example: 100000, width: 14 },
      { key: "note", label: "Ghi chú", type: "text", example: "Sếp cho", width: 24 }],
    notes: ["Chia đều cho thành viên quỹ tại ngày nhận."],
  },
  PURCHASES: {
    kind: "PURCHASES", sheet: "Mua_do", title: "Phiếu mua",
    columns: [ref("Mã phiếu"), date(),
      { key: "paid_by", label: "Nguồn trả", type: "text", required: true, example: "FUND", width: 12, help: "FUND (quỹ) hoặc MEMBER (mua hộ)" },
      { key: "payer_username", label: "Người mua hộ", type: "text", example: "", width: 16, help: "Bắt buộc khi MEMBER" },
      { key: "shop", label: "Cửa hàng", type: "text", example: "Cửa hàng A", width: 18 },
      { key: "line_type", label: "Loại dòng", type: "text", example: "ITEM", width: 11, help: "ITEM / FEE / DISCOUNT" },
      { key: "item_name", label: "Mặt hàng", type: "text", required: true, example: "Hạt cà phê 1kg", width: 24 },
      { key: "quantity", label: "Số lượng", type: "number", example: 1, width: 10 },
      { key: "unit", label: "Đơn vị", type: "text", example: "kg", width: 8 },
      { key: "line_amount_vnd", label: "Thành tiền", type: "money", required: true, example: 250000, width: 14, help: "Giảm giá ghi số âm" },
      { key: "notes", label: "Ghi chú", type: "text", example: "", width: 20 }],
    notes: ["Mỗi dòng là một mặt hàng/phí/giảm giá; các dòng cùng Mã phiếu gộp thành một phiếu.", "Tổng phiếu = tổng các dòng, phải > 0."],
  },
  REIMBURSEMENTS: {
    kind: "REIMBURSEMENTS", sheet: "Hoan_tien", title: "Hoàn tiền",
    columns: [ref(), date(), { key: "username", label: "Tên đăng nhập", type: "text", required: true, example: "anhnv", width: 16 },
      { key: "amount_vnd", label: "Số tiền", type: "money", required: true, example: 50000, width: 14 },
      { key: "note", label: "Ghi chú", type: "text", example: "", width: 24 }],
    notes: ["Quỹ trả tiền thực cho thành viên (mua hộ/nộp dư)."],
  },
};

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 5000;

export function headerText(c: ColumnSpec): string {
  return `${c.label} (${c.key})`;
}
