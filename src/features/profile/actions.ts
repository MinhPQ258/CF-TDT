"use server";

import { revalidatePath } from "next/cache";
import { callRpc } from "@/lib/rpc";
import { currentUser } from "@/lib/auth";
import { fail, ok, type ActionState } from "@/lib/action";

const AVATAR_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_LEN = 200_000;

/** Đổi ảnh đại diện của chính mình; null = xoá ảnh (quay về chữ cái đầu) */
export async function setMyAvatarAction(avatar: string | null): Promise<ActionState<{ avatar: string | null }>> {
  if (!(await currentUser())) return fail({ code: "SESSION_EXPIRED", message: "Phiên đăng nhập đã hết, đăng nhập lại" });
  if (avatar !== null && (avatar.length > MAX_LEN || !AVATAR_RE.test(avatar))) return fail("Ảnh không hợp lệ hoặc quá lớn");
  const r = await callRpc<{ avatar: string | null }>("set_my_avatar", { p_avatar: avatar });
  if (!r.ok) return fail(r.error);
  revalidatePath("/", "layout");
  return ok(r.data, avatar ? "Đã đổi ảnh đại diện" : "Đã xoá ảnh đại diện");
}
