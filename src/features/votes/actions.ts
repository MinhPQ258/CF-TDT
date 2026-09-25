"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { callRpc } from "@/lib/rpc";
import { currentAdmin, currentUser } from "@/lib/auth";
import { fail, ok, zodFieldErrors, type ActionState } from "@/lib/action";
import { isIsoDate, vnLocalToIso } from "@/lib/dates";
import type { VoteSession } from "@/lib/types";

const voteSchema = z.discriminatedUnion("choice", [
  z.object({
    session_id: z.string().uuid(),
    choice: z.literal("YES"),
    coffee_type: z.enum(["MACHINE", "PHIN", "UNDECIDED"]),
    cups: z.coerce.number().int("Số cốc là số nguyên").min(1, "Ít nhất 1 cốc").max(20, "Tối đa 20 cốc"),
    note: z.string().trim().max(200, "Tối đa 200 ký tự").optional(),
  }),
  z.object({
    session_id: z.string().uuid(),
    choice: z.literal("NO"),
    note: z.string().trim().max(200, "Tối đa 200 ký tự").optional(),
  }),
]);

export async function castVoteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await currentUser())) return fail({ code: "SESSION_EXPIRED", message: "Phiên đăng nhập đã hết hạn, hãy đăng nhập lại" });
  const parsed = voteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Kiểm tra lại phiếu vote", zodFieldErrors(parsed.error.issues));
  const v = parsed.data;
  const r = await callRpc<VoteSession>("cast_vote", {
    p_session_id: v.session_id, p_choice: v.choice,
    p_coffee_type: v.choice === "YES" ? v.coffee_type : null,
    p_cups: v.choice === "YES" ? v.cups : null,
    p_note: v.note || null,
  });
  if (!r.ok) return fail(r.error);
  revalidatePath(`/votes/${v.session_id}`);
  revalidatePath("/votes");
  return ok(r.data, "Đã lưu phiếu của bạn");
}

export async function withdrawVoteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await currentUser())) return fail({ code: "SESSION_EXPIRED", message: "Phiên đăng nhập đã hết hạn, hãy đăng nhập lại" });
  const id = z.string().uuid().safeParse(formData.get("session_id"));
  if (!id.success) return fail("Đợt vote không hợp lệ");
  const r = await callRpc<VoteSession>("withdraw_vote", { p_session_id: id.data });
  if (!r.ok) return fail(r.error);
  revalidatePath(`/votes/${id.data}`);
  revalidatePath("/votes");
  return ok(r.data, "Đã rút phiếu");
}

const createSchema = z.object({
  name: z.string().trim().min(1, "Nhập tên đợt").max(100),
  service_date: z.string().refine(isIsoDate, "Ngày không hợp lệ"),
  opens_time: z.string().regex(/^\d{2}:\d{2}$/, "Giờ mở HH:mm"),
  cutoff_time: z.string().regex(/^\d{2}:\d{2}$/, "Giờ chốt HH:mm"),
  brew_time: z.string().regex(/^(\d{2}:\d{2})?$/).optional(),
  publish: z.enum(["on"]).optional(),
});

export async function createVoteSessionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await currentAdmin())) return fail({ code: "INSUFFICIENT_PERMISSION", message: "Bạn không có quyền thực hiện thao tác này" });
  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Kiểm tra lại thông tin đợt", zodFieldErrors(parsed.error.issues));
  const v = parsed.data;
  const opens = vnLocalToIso(v.service_date, v.opens_time);
  const cutoff = vnLocalToIso(v.service_date, v.cutoff_time);
  const brew = v.brew_time ? vnLocalToIso(v.service_date, v.brew_time) : null;
  if (!opens || !cutoff) return fail("Giờ không hợp lệ");
  if (cutoff <= opens) return fail("Giờ chốt phải sau giờ mở", { cutoff_time: "Giờ chốt phải sau giờ mở" });
  const r = await callRpc<VoteSession>("admin_create_vote_session", {
    p_name: v.name, p_service_date: v.service_date, p_opens_at: opens, p_cutoff_at: cutoff,
    p_planned_brew_at: brew, p_publish: v.publish === "on",
  });
  if (!r.ok) return fail(r.error);
  revalidatePath("/admin/votes");
  revalidatePath("/votes");
  return ok(r.data, `Đã tạo đợt "${r.data.name}"`);
}

const sessionAction = z.object({
  session_id: z.string().uuid(),
  op: z.enum(["publish", "cancel", "close"]),
  reason: z.string().trim().max(500).optional(),
});

export async function manageVoteSessionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await currentAdmin())) return fail({ code: "INSUFFICIENT_PERMISSION", message: "Bạn không có quyền thực hiện thao tác này" });
  const parsed = sessionAction.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Thao tác không hợp lệ");
  const { session_id, op, reason } = parsed.data;
  if (op === "cancel" && !reason) return fail("Nhập lý do hủy", { reason: "Nhập lý do hủy" });
  const r = op === "publish"
    ? await callRpc("admin_publish_vote_session", { p_session_id: session_id })
    : op === "cancel"
      ? await callRpc("admin_cancel_vote_session", { p_session_id: session_id, p_reason: reason })
      : await callRpc("close_vote_early", { p_session_id: session_id });
  if (!r.ok) return fail(r.error);
  revalidatePath("/admin/votes");
  revalidatePath("/votes");
  revalidatePath(`/votes/${session_id}`);
  return ok(undefined, op === "publish" ? "Đã đăng đợt" : op === "cancel" ? "Đã hủy đợt" : "Đã chốt sớm");
}
