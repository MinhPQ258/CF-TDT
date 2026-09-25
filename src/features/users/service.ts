import "server-only";
import { randomInt } from "node:crypto";
import { headers } from "next/headers";
import { z } from "zod";
import { callRpc } from "@/lib/rpc";
import { createAdminClient } from "@/lib/supabase/admin";
import { usernameToEmail } from "@/lib/env";
import { fail, type ActionState } from "@/lib/action";
import { log } from "@/lib/log";

// Không phải Server Action: chỉ gọi từ action đã kiểm quyền admin.

export const createAccountSchema = z.object({
  employee_code: z.string().trim().regex(/^[A-Za-z0-9._-]{1,32}$/, "Mã NV 1–32 ký tự chữ/số . _ -"),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,32}$/, "Username 3–32 ký tự a-z 0-9 . _ -"),
  display_name: z.string().trim().min(1, "Nhập tên hiển thị").max(100),
  role: z.enum(["MEMBER", "ADMIN"]),
});

/** Mật khẩu tạm dễ đọc (bỏ ký tự dễ nhầm), 12 ký tự. Chỉ hiển thị 1 lần. */
export function generateTempPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 12; i++) s += alphabet[randomInt(alphabet.length)];
  return s;
}

export interface CreatedAccount {
  username: string;
  display_name: string;
  temp_password: string;
}

/**
 * Tạo tài khoản: auth user (service key, email ảo) → profile (RPC với JWT admin, có audit).
 * Nếu tạo profile lỗi thì xóa auth user vừa tạo (bù trừ).
 */
export async function createAccount(input: z.infer<typeof createAccountSchema>): Promise<{ ok: true; account: CreatedAccount } | { ok: false; state: ActionState<never> }> {
  const requestId = (await headers()).get("x-request-id");
  const admin = createAdminClient();
  const temp = generateTempPassword();
  const { data, error } = await admin.auth.admin.createUser({
    email: usernameToEmail(input.username), password: temp, email_confirm: true,
    user_metadata: { username: input.username, display_name: input.display_name },
  });
  if (error || !data.user) {
    log("warn", { request_id: requestId, action: "user.create.auth", code: error?.code ?? "error", params: { username: input.username } });
    const exists = error?.code === "email_exists" || /already|registered|exists/i.test(error?.message ?? "");
    return { ok: false, state: fail(exists ? "Username đã tồn tại" : "Không tạo được tài khoản đăng nhập", exists ? { username: "Username đã tồn tại" } : undefined) };
  }
  const r = await callRpc("admin_create_profile", {
    p_user_id: data.user.id, p_employee_code: input.employee_code, p_username: input.username,
    p_display_name: input.display_name, p_role: input.role,
  });
  if (!r.ok) {
    const del = await admin.auth.admin.deleteUser(data.user.id);
    if (del.error) log("error", { request_id: requestId, action: "user.create.compensate", code: "DELETE_FAILED", detail: del.error.message, params: { user_id: data.user.id } });
    const field: Record<string, string> | undefined = r.error.detail === "employee_code" ? { employee_code: "Mã NV đã tồn tại" } : r.error.detail === "username" ? { username: "Username đã tồn tại" } : undefined;
    return { ok: false, state: fail(r.error, field) };
  }
  return { ok: true, account: { username: input.username, display_name: input.display_name, temp_password: temp } };
}

