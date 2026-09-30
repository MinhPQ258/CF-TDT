import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { callRpc } from "@/lib/rpc";
import { serverEnv } from "@/lib/env";
import type { Me } from "@/lib/types";

/** Hồ sơ người đang đăng nhập (cache theo request). */
export const getMe = cache(async (): Promise<Me | null> => {
  const r = await callRpc<Me | null>("me");
  return r.ok ? r.data : null;
});

/** Lớp phòng thủ thứ 2 (sau middleware) cho Server Component / Server Action. */
export async function requireUser(): Promise<Me> {
  const me = await getMe();
  if (!me) redirect("/login");
  if (me.status === "DISABLED") redirect("/login?error=disabled");
  if (me.must_change_password && serverEnv.forcePasswordChange()) redirect("/change-password");
  return me;
}

export async function requireAdmin(): Promise<Me> {
  const me = await requireUser();
  if (me.role !== "ADMIN") redirect("/403");
  return me;
}

/** Cho Server Action: trả null thay vì redirect để action trả lỗi có cấu trúc. */
export async function currentAdmin(): Promise<Me | null> {
  const me = await getMe();
  if (!me || me.status !== "ACTIVE" || (me.must_change_password && serverEnv.forcePasswordChange()) || me.role !== "ADMIN") return null;
  return me;
}

export async function currentUser(): Promise<Me | null> {
  const me = await getMe();
  if (!me || me.status !== "ACTIVE" || (me.must_change_password && serverEnv.forcePasswordChange())) return null;
  return me;
}
