// Chỉ định dạng/đọc số VND. KHÔNG tính phân bổ ở đây (logic tiền nằm ở hàm DB).

const GROUP = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });
const MINUS = "−"; // dấu trừ thật

/** 1234567 → "1.234.567 ₫"; −1234567 → "−1.234.567 ₫" */
export function formatVnd(amount: number | null | undefined, opts: { sign?: boolean; unit?: boolean } = {}): string {
  const n = Number(amount ?? 0);
  const unit = opts.unit === false ? "" : " ₫";
  const body = GROUP.format(Math.abs(n));
  if (n < 0) return `${MINUS}${body}${unit}`;
  if (n > 0 && opts.sign) return `+${body}${unit}`;
  return `${body}${unit}`;
}

/** Đọc số tiền người dùng gõ ("30.000", "30000", "-5.000", "−5 000") → số nguyên hoặc null */
export function parseVnd(input: string | null | undefined): number | null {
  if (input == null) return null;
  const s = String(input).trim().replace(/−/g, "-");
  if (s === "") return null;
  const negative = s.startsWith("-");
  const digits = s.replace(/[^\d]/g, "");
  if (digits === "" || digits.length > 13) return null;
  const n = Number(digits);
  if (!Number.isSafeInteger(n)) return null;
  return negative ? -n : n;
}
