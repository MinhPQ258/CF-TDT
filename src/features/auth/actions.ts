"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { usernameToEmail } from "@/lib/env";
import { callRpc } from "@/lib/rpc";
import { fail, zodFieldErrors, type ActionState } from "@/lib/action";
import { log } from "@/lib/log";
import type { Me } from "@/lib/types";

const loginSchema = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,32}$/, "Tên đăng nhập 3–32 ký tự a-z, 0-9, . _ -"),
  password: z.string().min(1, "Nhập mật khẩu").max(200),
  next: z.string().optional(),
});

/** Chỉ cho phép chuyển về đường dẫn nội bộ */
function safeNext(next: string | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/login")) return "/";
  return next;
}

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Kiểm tra lại thông tin đăng nhập", zodFieldErrors(parsed.error.issues));
  const { username, password, next } = parsed.data;
  const requestId = (await headers()).get("x-request-id");
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({ email: usernameToEmail(username), password });
  if (error) {
    log("warn", { request_id: requestId, action: "auth.login", code: error.code ?? "invalid_credentials", params: { username } });
    if (error.status === 429) return fail("Thử đăng nhập quá nhiều lần, đợi vài phút rồi thử lại");
    // Không tiết lộ sai tên hay sai mật khẩu
    return fail("Sai tên đăng nhập hoặc mật khẩu");
  }

  const me = await callRpc<Me | null>("me");
  if (!me.ok || !me.data || me.data.status === "DISABLED") {
    await supabase.auth.signOut();
    log("warn", { request_id: requestId, action: "auth.login", code: "ACCOUNT_DISABLED", params: { username } });
    return fail(me.ok && me.data ? "Tài khoản đã bị khóa, liên hệ quản trị" : "Tài khoản chưa được thiết lập, liên hệ quản trị");
  }
  log("info", { request_id: requestId, user_id: me.data.id, action: "auth.login", code: "OK" });
  if (me.data.must_change_password) redirect("/change-password");
  redirect(safeNext(next));
}

export async function logoutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

const changeSchema = z
  .object({
    current_password: z.string().min(1, "Nhập mật khẩu hiện tại"),
    new_password: z.string().min(8, "Mật khẩu mới tối thiểu 8 ký tự").max(72, "Tối đa 72 ký tự"),
    confirm_password: z.string(),
  })
  .refine((v) => v.new_password === v.confirm_password, { path: ["confirm_password"], message: "Mật khẩu nhập lại không khớp" })
  .refine((v) => v.new_password !== v.current_password, { path: ["new_password"], message: "Mật khẩu mới phải khác mật khẩu hiện tại" });

export async function changePasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = changeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Kiểm tra lại mật khẩu", zodFieldErrors(parsed.error.issues));
  const requestId = (await headers()).get("x-request-id");
  const me = await callRpc<Me | null>("me");
  if (!me.ok || !me.data) return fail({ code: "SESSION_EXPIRED", message: "Phiên đăng nhập đã hết hạn, hãy đăng nhập lại" });

  const supabase = await createClient();
  // Xác thực lại bằng mật khẩu hiện tại trước khi đổi
  const reauth = await supabase.auth.signInWithPassword({ email: usernameToEmail(me.data.username), password: parsed.data.current_password });
  if (reauth.error) return fail("Mật khẩu hiện tại không đúng", { current_password: "Mật khẩu hiện tại không đúng" });

  const { error } = await supabase.auth.updateUser({ password: parsed.data.new_password });
  if (error) {
    log("warn", { request_id: requestId, user_id: me.data.id, action: "auth.change_password", code: error.code ?? "error" });
    const weak = error.code === "weak_password" || /weak|short/i.test(error.message);
    return fail(weak ? "Mật khẩu quá yếu, chọn mật khẩu dài và khó đoán hơn" : "Không đổi được mật khẩu, thử lại",
      weak ? { new_password: "Mật khẩu quá yếu" } : undefined);
  }
  const done = await callRpc("complete_password_change");
  if (!done.ok) return fail(done.error);
  redirect(me.data.role === "ADMIN" ? "/admin/dashboard" : "/me");
}
