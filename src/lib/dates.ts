// Giờ Việt Nam (UTC+7, không có giờ mùa hè). Ngày nghiệp vụ là chuỗi YYYY-MM-DD.

export const VN_TZ = "Asia/Ho_Chi_Minh";
const VN_OFFSET = "+07:00";

export function vnToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: VN_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function firstOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function isIsoDate(s: string | null | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** "2026-09-25" → "25/09/2026" */
export function formatDate(date: string | null | undefined): string {
  if (!date) return "—";
  const [y, m, d] = date.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** ISO timestamptz → "25/09 08:30" giờ VN */
export function formatDateTime(iso: string | null | undefined, withYear = false): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("vi-VN", {
    timeZone: VN_TZ, hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("vi-VN", { timeZone: VN_TZ, hour: "2-digit", minute: "2-digit" });
}

/** Ngày + "HH:mm" giờ VN (từ input) → ISO có múi giờ, quy đổi một lần duy nhất */
export function vnLocalToIso(date: string, time: string): string | null {
  if (!isIsoDate(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const d = new Date(`${date}T${time}:00${VN_OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
