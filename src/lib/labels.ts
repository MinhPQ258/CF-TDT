import type { CoffeeType, EntryType, EventKind, ImportKind, ImportStatus, LineType, VoteState } from "@/lib/types";

export const EVENT_KIND_LABEL: Record<EventKind, string> = {
  DEPOSIT: "Tiền nộp",
  GIFT: "Tiền cho thêm",
  PURCHASE_FUND: "Mua đồ (quỹ trả)",
  PURCHASE_MEMBER: "Mua đồ (mua hộ)",
  REIMBURSEMENT: "Hoàn tiền",
  REVERSAL: "Đảo giao dịch",
};

/** Nhóm giải thích số dư (DEV plan v2 §7) */
export const ENTRY_TYPE_LABEL: Record<EntryType, string> = {
  DEPOSIT_CREDIT: "Đã nộp",
  PURCHASE_CREDIT: "Mua hộ (được ghi có)",
  GIFT_SHARE: "Được chia tiền cho thêm",
  PURCHASE_SHARE: "Chi phí được chia",
  REIMBURSEMENT_DEBIT: "Đã được hoàn",
};

export const ENTRY_TYPE_ORDER: EntryType[] = ["DEPOSIT_CREDIT", "PURCHASE_CREDIT", "GIFT_SHARE", "PURCHASE_SHARE", "REIMBURSEMENT_DEBIT"];

export const LINE_TYPE_LABEL: Record<LineType, string> = { ITEM: "Mặt hàng", FEE: "Phí", DISCOUNT: "Giảm giá" };

export const VOTE_STATE_LABEL: Record<VoteState, string> = {
  DRAFT: "Nháp",
  UPCOMING: "Sắp mở",
  OPEN: "Đang mở",
  CLOSED: "Đã chốt",
  CANCELLED: "Đã hủy",
};

export const COFFEE_TYPE_LABEL: Record<CoffeeType, string> = { MACHINE: "Máy", PHIN: "Phin", UNDECIDED: "Chưa chọn" };

export const IMPORT_KIND_LABEL: Record<ImportKind, string> = {
  MEMBERS: "Thành viên quỹ",
  DEPOSITS: "Tiền nộp",
  GIFTS: "Tiền cho thêm",
  PURCHASES: "Phiếu mua",
  REIMBURSEMENTS: "Hoàn tiền",
};

export const IMPORT_STATUS_LABEL: Record<ImportStatus, string> = {
  UPLOADED: "Đã tải lên",
  HAS_ERRORS: "Có lỗi",
  READY: "Sẵn sàng",
  STALE: "Cần xem lại",
  COMMITTED: "Đã ghi",
  DISCARDED: "Đã hủy",
};
