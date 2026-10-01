import { PERMISSION_LABEL } from "@/lib/permissions";
import type { AuditRow } from "@/lib/types";

/** Tên hành động trong tab Log */
export const AUDIT_ACTION_LABEL: Record<string, string> = {
  "auth.login": "Đăng nhập",
  "auth.password_changed": "Đổi mật khẩu",
  "vote.cast": "Vote",
  "vote.cast_for": "Vote hộ",
  "vote.withdraw": "Rút vote",
  "vote.withdraw_for": "Bỏ vote hộ",
  "vote.create": "Tạo đợt pha",
  "vote.update": "Sửa đợt pha",
  "vote.publish": "Đăng đợt pha",
  "vote.close_early": "Chốt sớm đợt",
  "vote.cancel": "Hủy đợt",
  "vote.cutoff": "Đổi giờ chốt",
  "vote.option_add": "Thêm lựa chọn",
  "vote.option_hide": "Ẩn lựa chọn",
  "vote.option_show": "Hiện lựa chọn",
  "fund.deposit": "Nộp quỹ",
  "fund.gift": "Tiền cho thêm",
  "fund.purchase": "Ghi phiếu mua",
  "fund.reimbursement": "Hoàn tiền",
  "fund.reverse": "Đảo giao dịch",
  "user.create": "Tạo người dùng",
  "user.password_reset": "Cấp lại mật khẩu",
  "user.disable": "Khóa người dùng",
  "user.enable": "Mở khóa người dùng",
  "user.role": "Đổi vai trò (cũ)",
  "user.roles": "Phân vai trò",
  "role.create": "Tạo vai trò",
  "role.update": "Sửa vai trò",
  "role.delete": "Xoá vai trò",
  "profile.avatar_set": "Đổi ảnh đại diện",
  "profile.avatar_remove": "Xoá ảnh đại diện",
  "import.stage": "Tải file Excel",
  "import.commit": "Ghi dữ liệu Excel",
  "import.discard": "Bỏ file Excel",
  "export.xlsx": "Xuất Excel",
  "reconcile.alert": "Cảnh báo đối soát",
};

/** Bộ lọc loại hành động (tiền tố mã) */
export const AUDIT_GROUPS = [
  { prefix: "auth.", label: "Đăng nhập / mật khẩu" },
  { prefix: "vote.", label: "Vote & đợt pha" },
  { prefix: "fund.", label: "Sổ quỹ & phiếu mua" },
  { prefix: "user.", label: "Người dùng" },
  { prefix: "role.", label: "Vai trò" },
  { prefix: "profile.", label: "Hồ sơ cá nhân" },
  { prefix: "import.", label: "Excel" },
] as const;

const vnd = (n: unknown) => (typeof n === "number" ? `${n.toLocaleString("vi-VN")} ₫` : null);
const perms = (x: unknown) => (Array.isArray(x) ? x.map((p) => PERMISSION_LABEL[String(p)] ?? String(p)).join(", ") || "không có quyền" : null);

/** Mô tả ngắn nội dung thay đổi của một dòng log */
export function describeAudit(r: AuditRow): string {
  const a = (r.after ?? {}) as Record<string, unknown>;
  const b = (r.before ?? {}) as Record<string, unknown>;
  const target = r.target ? `${r.target.display_name} (@${r.target.username})` : null;
  switch (r.action) {
    case "vote.cast":
    case "vote.cast_for":
    case "vote.withdraw":
    case "vote.withdraw_for": {
      const what = r.action.startsWith("vote.withdraw") ? "" : a.choice === "NO" ? " · Không uống" : ` · ${[a.style, a.cups ? `${a.cups} cốc` : null].filter(Boolean).join(", ")}`;
      return `${a.session ?? "Đợt pha"}${a.for ? ` · cho ${a.for}` : ""}${what}`;
    }
    case "user.roles":
      return `${a.user ?? target ?? ""}: ${(b.roles as string[] | undefined)?.join(", ") || "—"} → ${(a.roles as string[] | undefined)?.join(", ") || "không vai trò"}`;
    case "role.create":
    case "role.update":
      return `${a.name}: ${perms(a.permissions)}${r.action === "role.update" && b.name && b.name !== a.name ? ` (đổi tên từ ${b.name})` : ""}`;
    case "role.delete":
      return String(b.name ?? "");
    case "fund.deposit":
      return [r.subject, vnd(a.amount_vnd), a.external_ref ? `CT ${a.external_ref}` : null].filter(Boolean).join(" · ");
    case "fund.reimbursement":
      return [r.subject ? `hoàn cho ${r.subject}` : null, vnd(a.amount_vnd)].filter(Boolean).join(" · ");
    case "fund.gift":
      return [vnd(a.amount_vnd), a.share_count ? `chia ${a.share_count} người` : null].filter(Boolean).join(" · ");
    case "fund.purchase":
      return [vnd(a.total), a.paid_by === "MEMBER" && r.subject ? `${r.subject} mua hộ` : "quỹ trả", a.share_count ? `chia ${a.share_count} người` : null].filter(Boolean).join(" · ");
    case "fund.reverse":
      return r.reason ? `Lý do: ${r.reason}` : "";
    case "profile.avatar_set":
    case "profile.avatar_remove":
    case "auth.login":
    case "auth.password_changed":
      return "";
    default: {
      const parts = [target, a.name, a.username, vnd(a.amount_vnd), a.status, r.reason].filter((x) => x !== null && x !== undefined && x !== "");
      return parts.map(String).join(" · ");
    }
  }
}
