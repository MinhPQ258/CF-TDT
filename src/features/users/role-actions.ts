"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { callRpc } from "@/lib/rpc";
import { currentAdminWith } from "@/lib/auth";
import { fail, ok, zodFieldErrors, type ActionState } from "@/lib/action";
import { PERMISSIONS } from "@/lib/permissions";

const NO_PERMISSION = { code: "INSUFFICIENT_PERMISSION" as const, message: "Bạn không có quyền thực hiện thao tác này" };
const CODES = PERMISSIONS.map((p) => p.code) as [string, ...string[]];

const roleSchema = z.object({
  role_id: z.string().uuid().nullable(),
  name: z.string().trim().min(1, "Nhập tên vai trò").max(60, "Tối đa 60 ký tự"),
  description: z.string().trim().max(300, "Tối đa 300 ký tự").optional(),
  permissions: z.array(z.enum(CODES)),
});

/** Tạo (role_id null) hoặc sửa vai trò */
export async function saveRoleAction(input: z.input<typeof roleSchema>): Promise<ActionState> {
  if (!(await currentAdminWith("users.manage"))) return fail(NO_PERMISSION);
  const parsed = roleSchema.safeParse(input);
  if (!parsed.success) return fail("Kiểm tra lại vai trò", zodFieldErrors(parsed.error.issues));
  const v = parsed.data;
  const r = await callRpc("admin_save_role", {
    p_role_id: v.role_id, p_name: v.name, p_description: v.description || null, p_permissions: v.permissions,
  });
  if (!r.ok) return fail(r.error, r.error.code === "DUPLICATE_REFERENCE" ? { name: "Tên vai trò đã có" } : undefined);
  revalidatePath("/admin", "layout");
  return ok(undefined, v.role_id ? `Đã lưu vai trò ${v.name}` : `Đã tạo vai trò ${v.name}`);
}

export async function deleteRoleAction(roleId: string): Promise<ActionState> {
  if (!(await currentAdminWith("users.manage"))) return fail(NO_PERMISSION);
  const id = z.string().uuid().safeParse(roleId);
  if (!id.success) return fail("Vai trò không hợp lệ");
  const r = await callRpc("admin_delete_role", { p_role_id: id.data });
  if (!r.ok) return fail(r.error);
  revalidatePath("/admin", "layout");
  return ok(undefined, "Đã xoá vai trò");
}

/** Gán danh sách vai trò cho một người (thay toàn bộ) */
export async function setUserRolesAction(userId: string, roleIds: string[]): Promise<ActionState> {
  if (!(await currentAdminWith("users.manage"))) return fail(NO_PERMISSION);
  const v = z.object({ userId: z.string().uuid(), roleIds: z.array(z.string().uuid()).max(50) }).safeParse({ userId, roleIds });
  if (!v.success) return fail("Dữ liệu không hợp lệ");
  const r = await callRpc("admin_set_user_roles", { p_user_id: v.data.userId, p_role_ids: v.data.roleIds });
  if (!r.ok) return fail(r.error);
  revalidatePath("/admin", "layout");
  return ok(undefined, "Đã cập nhật vai trò");
}
