"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { callRpc } from "@/lib/rpc";
import { currentAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok, zodFieldErrors, type ActionState } from "@/lib/action";
import { log } from "@/lib/log";
import { createAccount, createAccountSchema, generateTempPassword, type CreatedAccount } from "./service";

const NO_PERMISSION = { code: "INSUFFICIENT_PERMISSION" as const, message: "Bạn không có quyền thực hiện thao tác này" };

export async function createUserAction(_prev: ActionState, formData: FormData): Promise<ActionState<CreatedAccount>> {
  if (!(await currentAdmin())) return fail(NO_PERMISSION);
  const parsed = createAccountSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Kiểm tra lại thông tin tài khoản", zodFieldErrors(parsed.error.issues));
  const r = await createAccount(parsed.data);
  if (!r.ok) return r.state;
  revalidatePath("/admin/users");
  return ok(r.account, "Đã tạo tài khoản. Mật khẩu tạm chỉ hiển thị một lần.");
}

const statusSchema = z.object({
  user_id: z.string().uuid(),
  status: z.enum(["ACTIVE", "DISABLED"]),
  reason: z.string().trim().min(1, "Nhập lý do").max(500),
});

/** Khóa: cập nhật profile (DB, có audit) rồi ban trên Supabase Auth để chặn làm mới phiên. */
export async function setUserStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await currentAdmin())) return fail(NO_PERMISSION);
  const parsed = statusSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Nhập lý do", zodFieldErrors(parsed.error.issues));
  const { user_id, status, reason } = parsed.data;
  const r = await callRpc("admin_set_user_status", { p_user_id: user_id, p_status: status, p_reason: reason });
  if (!r.ok) return fail(r.error);
  const { error } = await createAdminClient().auth.admin.updateUserById(user_id, { ban_duration: status === "DISABLED" ? "876000h" : "none" });
  revalidatePath("/admin/users");
  if (error) {
    log("error", { request_id: (await headers()).get("x-request-id"), action: "user.ban", code: "AUTH_BAN_FAILED", detail: error.message, params: { user_id, status } });
    return ok(undefined, "Đã cập nhật trạng thái. Lưu ý: chưa đồng bộ được với hệ thống đăng nhập — tài khoản vẫn bị chặn ở mỗi lần truy cập.");
  }
  return ok(undefined, status === "DISABLED" ? "Đã khóa tài khoản và đăng xuất các phiên" : "Đã mở khóa tài khoản");
}

const roleSchema = z.object({
  user_id: z.string().uuid(),
  role: z.enum(["MEMBER", "ADMIN"]),
  reason: z.string().trim().min(1, "Nhập lý do").max(500),
});

export async function setUserRoleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await currentAdmin())) return fail(NO_PERMISSION);
  const parsed = roleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Nhập lý do", zodFieldErrors(parsed.error.issues));
  const r = await callRpc("admin_set_user_role", { p_user_id: parsed.data.user_id, p_role: parsed.data.role, p_reason: parsed.data.reason });
  if (!r.ok) return fail(r.error);
  revalidatePath("/admin/users");
  return ok(undefined, "Đã đổi vai trò");
}

export async function resetPasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState<{ temp_password: string }>> {
  if (!(await currentAdmin())) return fail(NO_PERMISSION);
  const id = z.string().uuid().safeParse(formData.get("user_id"));
  if (!id.success) return fail("Tài khoản không hợp lệ");
  const temp = generateTempPassword();
  const { error } = await createAdminClient().auth.admin.updateUserById(id.data, { password: temp });
  if (error) {
    log("warn", { request_id: (await headers()).get("x-request-id"), action: "user.reset_password", code: error.code ?? "error", params: { user_id: id.data } });
    return fail("Không đặt lại được mật khẩu");
  }
  const r = await callRpc("admin_mark_password_reset", { p_user_id: id.data });
  if (!r.ok) return fail(r.error);
  revalidatePath("/admin/users");
  return ok({ temp_password: temp }, "Đã đặt mật khẩu tạm. Chỉ hiển thị một lần.");
}
