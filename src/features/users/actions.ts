"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { callRpc } from "@/lib/rpc";
import { currentAdminWith } from "@/lib/auth";
import { backend } from "@/lib/backend";
import { fail, ok, zodFieldErrors, type ActionState } from "@/lib/action";
import { log } from "@/lib/log";
import { serverEnv } from "@/lib/env";
import type { AdminUser } from "@/lib/types";
import { createAccount, createAccountSchema, type CreatedAccount } from "./service";

const NO_PERMISSION = { code: "INSUFFICIENT_PERMISSION" as const, message: "Bạn không có quyền thực hiện thao tác này" };

export async function createUserAction(_prev: ActionState, formData: FormData): Promise<ActionState<CreatedAccount>> {
  if (!(await currentAdminWith("users.manage"))) return fail(NO_PERMISSION);
  const parsed = createAccountSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Kiểm tra lại thông tin tài khoản", zodFieldErrors(parsed.error.issues));
  const r = await createAccount(parsed.data);
  if (!r.ok) return r.state;
  revalidatePath("/admin/users");
  return ok(r.account, `Đã tạo ${r.account.username}.`);
}

const statusSchema = z.object({
  user_id: z.string().uuid(),
  status: z.enum(["ACTIVE", "DISABLED"]),
  reason: z.string().trim().max(500).optional(),
});

/** Khóa: cập nhật profile (DB, có audit) rồi ban trên Supabase Auth để chặn làm mới phiên. */
export async function setUserStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await currentAdminWith("users.manage"))) return fail(NO_PERMISSION);
  const parsed = statusSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Dữ liệu không hợp lệ", zodFieldErrors(parsed.error.issues));
  const { user_id, status } = parsed.data;
  const reason = parsed.data.reason || (status === "DISABLED" ? "Khóa bởi quản trị" : "Mở khóa bởi quản trị");
  const r = await callRpc("admin_set_user_status", { p_user_id: user_id, p_status: status, p_reason: reason });
  if (!r.ok) return fail(r.error);
  const { error } = await (await backend()).admin.updateUser(user_id, { banned: status === "DISABLED" });
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
  reason: z.string().trim().max(500).optional(),
});

export async function setUserRoleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await currentAdminWith("users.manage"))) return fail(NO_PERMISSION);
  const parsed = roleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Nhập lý do", zodFieldErrors(parsed.error.issues));
  const r = await callRpc("admin_set_user_role", { p_user_id: parsed.data.user_id, p_role: parsed.data.role, p_reason: parsed.data.reason || "Đổi bởi quản trị" });
  if (!r.ok) return fail(r.error);
  revalidatePath("/admin/users");
  return ok(undefined, "Đã đổi vai trò");
}

/** Đặt mật khẩu về mặc định (APP_RESET_PASSWORD, mặc định 123456) + bắt đổi khi đăng nhập */
export async function resetPasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState<{ temp_password: string }>> {
  if (!(await currentAdminWith("users.manage"))) return fail(NO_PERMISSION);
  const id = z.string().uuid().safeParse(formData.get("user_id"));
  if (!id.success) return fail("Tài khoản không hợp lệ");
  const users = await callRpc<AdminUser[]>("admin_list_users");
  if (!users.ok) return fail(users.error);
  const target = users.data.find((u) => u.id === id.data);
  if (!target) return fail("Không tìm thấy tài khoản");
  const be = await backend();
  const temp = serverEnv.defaultPassword();
  const { error } = await be.admin.updateUser(id.data, { password: temp });
  if (error) {
    log("warn", { request_id: (await headers()).get("x-request-id"), action: "user.reset_password", code: error.code ?? "error", detail: error.message, params: { user_id: id.data } });
    if (error.code === "weak_password" || /at least \d+ characters|weak/i.test(error.message)) {
      return fail(`Supabase từ chối mật khẩu mặc định (${error.message}). Hạ "Minimum password length" trong Supabase Auth xuống ${temp.length} hoặc đặt APP_RESET_PASSWORD dài hơn.`);
    }
    return fail(`Không đặt lại được mật khẩu (mã ${error.code ?? error.status ?? "?"})`);
  }
  const r = await callRpc("admin_mark_password_reset", { p_user_id: id.data }); // ghi audit
  if (!r.ok) return fail(r.error);
  if (!serverEnv.forcePasswordChange()) await be.admin.setMustChangePassword(id.data, false);
  revalidatePath("/admin/users");
  return ok({ temp_password: temp }, `Đã đặt mật khẩu của ${target.username} về mặc định.`);
}
