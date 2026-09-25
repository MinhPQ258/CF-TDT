// Mã lỗi ổn định từ hàm DB (RAISE ... MESSAGE='<CODE>') → thông báo tiếng Việt (DEV plan v2 §4-§5).

export const ERROR_CODES = [
  "INVALID_INPUT", "FUTURE_DATE", "VOTE_CLOSED", "VOTE_NOT_OPEN", "DUPLICATE_REFERENCE",
  "MEMBERSHIP_CHANGED", "MEMBERSHIP_OVERLAP", "NO_ACTIVE_MEMBERS", "PAYER_NOT_MEMBER",
  "ALREADY_REVERSED", "INVARIANT_VIOLATION", "INSUFFICIENT_PERMISSION", "ACCOUNT_DISABLED",
  "MUST_CHANGE_PASSWORD", "IMPORT_DUPLICATE_FILE", "IMPORT_HAS_ERRORS", "IMPORT_STALE",
  "LEDGER_IMMUTABLE", "SESSION_EXPIRED", "NETWORK", "UNKNOWN",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const MESSAGES: Record<ErrorCode, string> = {
  INVALID_INPUT: "Dữ liệu chưa hợp lệ",
  FUTURE_DATE: "Không được ghi giao dịch cho ngày trong tương lai",
  VOTE_CLOSED: "Đợt vote đã chốt",
  VOTE_NOT_OPEN: "Đợt vote chưa mở",
  DUPLICATE_REFERENCE: "Mã chứng từ hoặc dữ liệu này đã tồn tại",
  MEMBERSHIP_CHANGED: "Danh sách người chia đã thay đổi, hãy xem lại bản phân bổ",
  MEMBERSHIP_OVERLAP: "Khoảng thời gian tham gia bị trùng với khoảng đã có",
  NO_ACTIVE_MEMBERS: "Quỹ chưa có thành viên tại ngày này. Thêm thành viên quỹ trước",
  PAYER_NOT_MEMBER: "Người mua hộ không phải thành viên quỹ tại ngày phiếu",
  ALREADY_REVERSED: "Giao dịch đã được đảo trước đó",
  INVARIANT_VIOLATION: "Không ghi được — lỗi hệ thống đã được ghi nhận",
  INSUFFICIENT_PERMISSION: "Bạn không có quyền thực hiện thao tác này",
  ACCOUNT_DISABLED: "Tài khoản đã bị khóa, liên hệ quản trị",
  MUST_CHANGE_PASSWORD: "Bạn cần đổi mật khẩu trước khi tiếp tục",
  IMPORT_DUPLICATE_FILE: "File này đã được import trước đó",
  IMPORT_HAS_ERRORS: "File còn dòng lỗi, sửa rồi tải lên lại",
  IMPORT_STALE: "Dữ liệu đã thay đổi sau khi xem trước, hãy xem lại preview",
  LEDGER_IMMUTABLE: "Sổ quỹ không cho sửa/xóa — dùng giao dịch đảo",
  SESSION_EXPIRED: "Phiên đăng nhập đã hết hạn, hãy đăng nhập lại",
  NETWORK: "Chưa chắc đã ghi — bấm Gửi lại, hệ thống không ghi trùng",
  UNKNOWN: "Có lỗi xảy ra, thử lại sau",
};

export interface AppError {
  code: ErrorCode;
  message: string;
  detail?: string;
}

export function isErrorCode(x: string): x is ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(x);
}

export function messageFor(code: ErrorCode, detail?: string): string {
  const base = MESSAGES[code];
  if (!detail) return base;
  if (code === "VOTE_CLOSED" || code === "VOTE_NOT_OPEN") {
    const t = formatTimeDetail(detail);
    return t ? `${base} (${code === "VOTE_CLOSED" ? "chốt" : "mở"} lúc ${t})` : base;
  }
  if (code === "INVALID_INPUT" || code === "MEMBERSHIP_OVERLAP" || code === "DUPLICATE_REFERENCE") {
    return `${base}: ${detail}`;
  }
  return base;
}

function formatTimeDetail(detail: string): string | null {
  const d = new Date(detail);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
}

/** Chuyển lỗi PostgREST/Supabase (hoặc exception mạng) thành AppError. */
export function toAppError(err: unknown): AppError {
  const e = (err ?? {}) as { code?: string; message?: string; details?: string; detail?: string; status?: number; name?: string };
  const pgCode = e.code;
  const msg = (e.message ?? "").trim();
  const detail = (e.details ?? e.detail ?? "").trim() || undefined;

  if (pgCode === "P0001" && isErrorCode(msg)) return { code: msg, message: messageFor(msg, detail), detail };
  if (isErrorCode(msg)) return { code: msg, message: messageFor(msg, detail), detail };
  if (pgCode === "23P01") return { code: "MEMBERSHIP_OVERLAP", message: MESSAGES.MEMBERSHIP_OVERLAP };
  if (pgCode === "23505") return { code: "DUPLICATE_REFERENCE", message: MESSAGES.DUPLICATE_REFERENCE };
  if (pgCode === "PGRST301" || pgCode === "401" || e.status === 401 || /jwt/i.test(msg)) {
    return { code: "SESSION_EXPIRED", message: MESSAGES.SESSION_EXPIRED };
  }
  if (pgCode === "42501") return { code: "INSUFFICIENT_PERMISSION", message: MESSAGES.INSUFFICIENT_PERMISSION };
  if (pgCode === "57014" || e.name === "TypeError" || /fetch failed|network|timeout/i.test(msg)) {
    return { code: "NETWORK", message: MESSAGES.NETWORK };
  }
  return { code: "UNKNOWN", message: MESSAGES.UNKNOWN, detail: msg || undefined };
}
