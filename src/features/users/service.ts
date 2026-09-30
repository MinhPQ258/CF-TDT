import "server-only";
import { randomInt } from "node:crypto";
import { headers } from "next/headers";
import { z } from "zod";
import { callRpc } from "@/lib/rpc";
import { backend } from "@/lib/backend";
import { serverEnv, usernameToEmail } from "@/lib/env";
import { fail, type ActionState } from "@/lib/action";
import { log } from "@/lib/log";

// Không phải Server Action: chỉ gọi từ action đã kiểm quyền admin.

/** Tạo nhanh: chỉ cần username. Mã NV trống → tự sinh NV### kế tiếp; tên hiển thị trống → = username. */
export const createAccountSchema = z.object({
  employee_code: z.string().trim().regex(/^[A-Za-z0-9._-]{1,32}$/, "Mã NV 1–32 ký tự chữ/số . _ -").optional().or(z.literal("").transform(() => undefined)),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,32}$/, "Username 3–32 ký tự a-z 0-9 . _ -"),
  display_name: z.string().trim().max(100).optional(),
  role: z.enum(["MEMBER", "ADMIN"]).default("MEMBER"),
});

/** Mã NV kế tiếp dạng NV001, NV002… (lớn nhất hiện có + 1) */
async function nextEmployeeCode(): Promise<string> {
  const r = await callRpc<{ employee_code: string }[]>("admin_list_users");
  const max = r.ok ? Math.max(0, ...r.data.map((u) => Number(/^NV(\d+)$/i.exec(u.employee_code)?.[1] ?? 0))) : 0;
  return `NV${String(max + 1).padStart(3, "0")}`;
}

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
export async function createAccount(raw: z.input<typeof createAccountSchema>): Promise<{ ok: true; account: CreatedAccount } | { ok: false; state: ActionState<never> }> {
  const requestId = (await headers()).get("x-request-id");
  const input = {
    username: raw.username.trim().toLowerCase(),
    role: raw.role ?? "MEMBER",
    display_name: raw.display_name?.trim() || raw.username.trim().toLowerCase(),
    employee_code: raw.employee_code?.trim() || await nextEmployeeCode(),
  };
  const be = await backend();
  const temp = serverEnv.defaultPassword();
  const { id: userId, error } = await be.admin.createUser(usernameToEmail(input.username), temp,
    { username: input.username, display_name: input.display_name });
  if (error || !userId) {
    log("warn", { request_id: requestId, action: "user.create.auth", code: error?.code ?? "error", params: { username: input.username } });
    const exists = error?.code === "email_exists" || /already|registered|exists/i.test(error?.message ?? "");
    return { ok: false, state: fail(exists ? "Username đã tồn tại" : "Không tạo được tài khoản đăng nhập", exists ? { username: "Username đã tồn tại" } : undefined) };
  }
  const r = await callRpc("admin_create_profile", {
    p_user_id: userId, p_employee_code: input.employee_code, p_username: input.username,
    p_display_name: input.display_name, p_role: input.role,
  });
  if (!r.ok) {
    const del = await be.admin.deleteUser(userId);
    if (del.error) log("error", { request_id: requestId, action: "user.create.compensate", code: "DELETE_FAILED", detail: del.error.message, params: { user_id: userId } });
    const field: Record<string, string> | undefined = r.error.detail === "employee_code" ? { employee_code: "Mã NV đã tồn tại" } : r.error.detail === "username" ? { username: "Username đã tồn tại" } : undefined;
    return { ok: false, state: fail(r.error, field) };
  }
  if (!serverEnv.forcePasswordChange()) await be.admin.setMustChangePassword(userId, false);
  return { ok: true, account: { username: input.username, display_name: input.display_name, temp_password: temp } };
}

