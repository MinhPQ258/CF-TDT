/** Danh mục quyền RBAC — khớp private.all_permissions() (migration 000018). DB mới là nơi kiểm tra thật. */
export const PERMISSIONS = [
  { code: "votes.manage", label: "Quản lý đợt pha", hint: "Tạo nháp, sửa, chốt sớm, hủy đợt; xem ai vote gì" },
  { code: "fund.manage", label: "Sổ quỹ", hint: "Nộp quỹ, tiền cho thêm, hoàn tiền, đảo giao dịch" },
  { code: "purchases.manage", label: "Phiếu mua", hint: "Ghi và đảo phiếu mua đồ" },
  { code: "reports.view", label: "Báo cáo", hint: "Tổng quan quỹ, báo cáo theo kỳ, sức khỏe sổ" },
  { code: "excel.manage", label: "Excel", hint: "Nhập / xuất dữ liệu Excel" },
  { code: "users.manage", label: "Quản trị người dùng", hint: "Người dùng, vai trò, nhật ký" },
] as const;

export type Permission = (typeof PERMISSIONS)[number]["code"];

export const PERMISSION_LABEL: Record<string, string> = Object.fromEntries(PERMISSIONS.map((p) => [p.code, p.label]));

/** Có ít nhất một trong các quyền */
export function can(me: { permissions?: string[] | null } | null | undefined, ...perms: Permission[]): boolean {
  const have = me?.permissions ?? [];
  return perms.some((p) => have.includes(p));
}

/** Quyền cần cho từng màn quản trị (theo tiền tố đường dẫn) */
export const PAGE_PERMISSION: { prefix: string; perms: Permission[] }[] = [
  { prefix: "/admin/votes", perms: ["votes.manage"] },
  { prefix: "/admin/dashboard", perms: ["reports.view"] },
  { prefix: "/admin/reports", perms: ["reports.view"] },
  { prefix: "/admin/health", perms: ["reports.view"] },
  { prefix: "/admin/fund", perms: ["fund.manage"] },
  { prefix: "/admin/purchases", perms: ["purchases.manage"] },
  { prefix: "/admin/import-export", perms: ["excel.manage"] },
  { prefix: "/admin/users", perms: ["users.manage"] },
];

export function pagePerms(href: string): Permission[] | null {
  return PAGE_PERMISSION.find((x) => href === x.prefix || href.startsWith(x.prefix + "/") || href.startsWith(x.prefix + "?"))?.perms ?? null;
}
