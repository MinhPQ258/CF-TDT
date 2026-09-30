"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { callRpc } from "@/lib/rpc";
import { currentAdmin, currentUser } from "@/lib/auth";
import { fail, ok, zodFieldErrors, type ActionState } from "@/lib/action";
import { isIsoDate, vnLocalToIso } from "@/lib/dates";
import type { VoteOptions, VoteSession } from "@/lib/types";

const SESSION_EXPIRED = { code: "SESSION_EXPIRED" as const, message: "Phiên đăng nhập đã hết hạn, hãy đăng nhập lại" };
const NO_PERMISSION = { code: "INSUFFICIENT_PERMISSION" as const, message: "Bạn không có quyền thực hiện thao tác này" };

function revalidateVotes(sessionId?: string) {
  revalidatePath("/");
  revalidatePath("/votes");
  revalidatePath("/admin/votes");
  if (sessionId) {
    revalidatePath(`/votes/${sessionId}`);
    revalidatePath(`/admin/votes/${sessionId}`);
  }
}

// ───────── Thành viên ─────────

const voteSchema = z.object({
  session_id: z.string().uuid(),
  choice: z.enum(["YES", "NO"]),
  style_option_id: z.string().uuid().nullable().optional(),
  addon_ids: z.array(z.string().uuid()).max(20).optional(),
  cups: z.number().int().min(1, "Ít nhất 1 cốc").max(20, "Tối đa 20 cốc").nullable().optional(),
  note: z.string().trim().max(200, "Tối đa 200 ký tự").optional(),
});

const proxySchema = z.object({
  user_id: z.string().uuid(),
  style_option_id: z.string().uuid({ message: "Chọn kiểu pha cho người được đặt hộ" }),
  addon_ids: z.array(z.string().uuid()).max(20),
  cups: z.number().int().min(1).max(20).nullable(),
});

export async function castVoteAction(input: z.infer<typeof voteSchema> & {
  /** đặt hộ: thêm/cập nhật */
  proxies?: z.infer<typeof proxySchema>[];
  /** đặt hộ: bỏ những người này */
  remove_proxies?: string[];
}): Promise<ActionState<VoteSession>> {
  if (!(await currentUser())) return fail(SESSION_EXPIRED);
  const parsed = voteSchema.safeParse(input);
  if (!parsed.success) return fail("Kiểm tra lại lựa chọn", zodFieldErrors(parsed.error.issues));
  const proxies = z.array(proxySchema).max(50).safeParse(input.proxies ?? []);
  if (!proxies.success) return fail(proxies.error.issues[0]?.message ?? "Kiểm tra lại người được đặt hộ");
  const removes = z.array(z.string().uuid()).max(50).safeParse(input.remove_proxies ?? []);
  if (!removes.success) return fail("Danh sách bỏ đặt hộ không hợp lệ");
  const v = parsed.data;
  if (v.choice === "YES" && !v.style_option_id) return fail("Chọn kiểu pha", { style_option_id: "Chọn kiểu pha" });
  const yes = v.choice === "YES";
  const r = await callRpc<VoteSession>("cast_vote", {
    p_session_id: v.session_id, p_choice: v.choice,
    p_style_option_id: yes ? v.style_option_id : null,
    p_addon_ids: yes ? v.addon_ids ?? [] : [],
    p_cups: yes ? v.cups ?? null : null,
    p_note: v.note || null,
  });
  if (!r.ok) return fail(r.error);
  let last = r.data;
  for (const uid of removes.data) {
    const w = await callRpc<VoteSession>("withdraw_vote_for", { p_session_id: v.session_id, p_user_id: uid });
    if (!w.ok) { revalidateVotes(v.session_id); return fail(w.error); }
    last = w.data;
  }
  for (const p of proxies.data) {
    const x = await callRpc<VoteSession>("cast_vote_for", {
      p_session_id: v.session_id, p_user_id: p.user_id, p_style_option_id: p.style_option_id,
      p_addon_ids: p.addon_ids, p_cups: p.cups, p_note: null,
    });
    // phiếu của mình đã ghi; báo lỗi người đặt hộ để sửa và gửi lại
    if (!x.ok) { revalidateVotes(v.session_id); return fail({ ...x.error, message: `Đã ghi vote của bạn, nhưng đặt hộ lỗi: ${x.error.message}` }); }
    last = x.data;
  }
  revalidateVotes(v.session_id);
  return ok(last, proxies.data.length ? `Đã ghi vote và đặt hộ ${proxies.data.length} người` : "Đã ghi vote");
}

export async function withdrawVoteAction(input: { session_id: string }): Promise<ActionState> {
  if (!(await currentUser())) return fail(SESSION_EXPIRED);
  const id = z.string().uuid().safeParse(input.session_id);
  if (!id.success) return fail("Đợt vote không hợp lệ");
  const r = await callRpc<VoteSession>("withdraw_vote", { p_session_id: id.data });
  if (!r.ok) return fail(r.error);
  revalidateVotes(id.data);
  return ok(undefined, "Đã rút vote");
}

// ───────── Quản trị ─────────

const hhmm = z.string().regex(/^\d{2}:\d{2}$/, "Giờ dạng HH:mm");
const labels = z.array(z.string().trim().min(1).max(40, "Tối đa 40 ký tự"));

const createSchema = z.object({
  name: z.string().trim().max(100).transform((x) => x || "Pha cà phê"),
  service_date: z.string().refine(isIsoDate, "Ngày không hợp lệ"),
  opens_time: z.string().regex(/^(\d{2}:\d{2})?$/, "Giờ dạng HH:mm"),
  cutoff_time: hhmm,
  brew_time: z.string().regex(/^(\d{2}:\d{2})?$/, "Giờ dạng HH:mm"),
  styles: labels.min(1, "Cần ít nhất 1 kiểu pha").max(10, "Tối đa 10 kiểu pha"),
  addons: labels.max(20, "Tối đa 20 đồ đi kèm"),
  allow_cups: z.boolean(),
  publish: z.boolean(),
  copy_from: z.string().uuid().nullable().optional(),
});

/** Mọi tài khoản ACTIVE tạo được đợt (nút ＋); thành viên luôn đăng ngay, không có nháp */
export async function createVoteSessionAction(input: z.infer<typeof createSchema>): Promise<ActionState<VoteSession>> {
  if (!(await currentUser())) return fail(SESSION_EXPIRED);
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return fail("Kiểm tra lại thông tin đợt", zodFieldErrors(parsed.error.issues));
  const v = parsed.data;
  // Giờ mở trống = mở ngay
  const opens = v.opens_time ? vnLocalToIso(v.service_date, v.opens_time) : new Date(Date.now() - 60_000).toISOString();
  const cutoff = vnLocalToIso(v.service_date, v.cutoff_time);
  const brew = v.brew_time ? vnLocalToIso(v.service_date, v.brew_time) : null;
  if (!opens || !cutoff) return fail("Giờ không hợp lệ");
  if (cutoff <= opens) return fail("Giờ chốt phải sau giờ mở", { cutoff_time: "Giờ chốt phải sau giờ mở" });
  if (new Date(cutoff).getTime() <= Date.now()) return fail("Giờ chốt đã qua", { cutoff_time: "Giờ chốt phải ở tương lai" });
  const r = await callRpc<VoteSession>("create_vote_session", {
    p_name: v.name, p_service_date: v.service_date, p_opens_at: opens, p_cutoff_at: cutoff,
    p_planned_brew_at: brew, p_publish: v.publish, p_styles: v.styles, p_addons: v.addons,
    p_allow_cups: v.allow_cups, p_copy_from: v.copy_from ?? null,
  });
  if (!r.ok) return fail(r.error);
  revalidateVotes(r.data.id);
  return ok(r.data, v.publish ? `Đã đăng đợt "${r.data.name}"` : `Đã lưu nháp "${r.data.name}"`);
}

const sessionAction = z.object({
  session_id: z.string().uuid(),
  op: z.enum(["publish", "cancel", "close"]),
  reason: z.string().trim().max(500).optional(),
});

export async function manageVoteSessionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await currentAdmin())) return fail(NO_PERMISSION);
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
  revalidateVotes(session_id);
  return ok(undefined, op === "publish" ? "Đã đăng đợt" : op === "cancel" ? "Đã hủy đợt" : "Đã chốt sớm");
}

export async function addVoteOptionAction(input: { session_id: string; kind: "STYLE" | "ADDON"; label: string }): Promise<ActionState<VoteOptions>> {
  if (!(await currentAdmin())) return fail(NO_PERMISSION);
  const v = z.object({ session_id: z.string().uuid(), kind: z.enum(["STYLE", "ADDON"]), label: z.string().trim().min(1, "Nhập tên").max(40, "Tối đa 40 ký tự") }).safeParse(input);
  if (!v.success) return fail("Kiểm tra lại tên lựa chọn", zodFieldErrors(v.error.issues));
  const r = await callRpc<VoteOptions>("admin_add_vote_option", { p_session_id: v.data.session_id, p_kind: v.data.kind, p_label: v.data.label });
  if (!r.ok) return fail(r.error);
  revalidateVotes(v.data.session_id);
  return ok(r.data, `Đã thêm "${v.data.label}"`);
}

export async function setVoteOptionHiddenAction(input: { session_id: string; option_id: string; hidden: boolean }): Promise<ActionState<VoteOptions>> {
  if (!(await currentAdmin())) return fail(NO_PERMISSION);
  const v = z.object({ session_id: z.string().uuid(), option_id: z.string().uuid(), hidden: z.boolean() }).safeParse(input);
  if (!v.success) return fail("Yêu cầu không hợp lệ");
  const r = await callRpc<VoteOptions>("admin_set_vote_option_hidden", { p_option_id: v.data.option_id, p_hidden: v.data.hidden });
  if (!r.ok) return fail(r.error);
  revalidateVotes(v.data.session_id);
  return ok(r.data, v.data.hidden ? "Đã ẩn lựa chọn" : "Đã hiện lại lựa chọn");
}

/** Chỉnh sửa đợt (admin): cùng dữ liệu với màn Tạo đợt */
export async function updateVoteSessionAction(input: Omit<z.infer<typeof createSchema>, "publish" | "copy_from"> & { session_id: string }): Promise<ActionState<VoteSession>> {
  if (!(await currentAdmin())) return fail(NO_PERMISSION);
  const id = z.string().uuid().safeParse(input.session_id);
  if (!id.success) return fail("Đợt vote không hợp lệ");
  const parsed = createSchema.omit({ publish: true, copy_from: true }).safeParse(input);
  if (!parsed.success) return fail("Kiểm tra lại thông tin đợt", zodFieldErrors(parsed.error.issues));
  const v = parsed.data;
  const opens = v.opens_time ? vnLocalToIso(v.service_date, v.opens_time) : new Date(Date.now() - 60_000).toISOString();
  const cutoff = vnLocalToIso(v.service_date, v.cutoff_time);
  if (!opens || !cutoff) return fail("Giờ không hợp lệ");
  if (cutoff <= opens) return fail("Giờ chốt phải sau giờ mở", { cutoff_time: "Giờ chốt phải sau giờ mở" });
  if (new Date(cutoff).getTime() <= Date.now()) return fail("Giờ chốt đã qua", { cutoff_time: "Giờ chốt phải ở tương lai" });
  const r = await callRpc<VoteSession>("admin_update_vote_session", {
    p_session_id: id.data, p_name: v.name, p_service_date: v.service_date, p_opens_at: opens, p_cutoff_at: cutoff,
    p_allow_cups: v.allow_cups, p_styles: v.styles, p_addons: v.addons,
  });
  if (!r.ok) return fail(r.error);
  revalidateVotes(id.data);
  return ok(r.data, "Đã lưu thay đổi");
}

export async function setVoteCutoffAction(input: { session_id: string; service_date: string; cutoff_time: string }): Promise<ActionState> {
  if (!(await currentAdmin())) return fail(NO_PERMISSION);
  const v = z.object({ session_id: z.string().uuid(), service_date: z.string().refine(isIsoDate), cutoff_time: hhmm }).safeParse(input);
  if (!v.success) return fail("Giờ chốt không hợp lệ", { cutoff_time: "Giờ dạng HH:mm" });
  const cutoff = vnLocalToIso(v.data.service_date, v.data.cutoff_time);
  const r = await callRpc("admin_set_vote_cutoff", { p_session_id: v.data.session_id, p_cutoff_at: cutoff });
  if (!r.ok) return fail(r.error);
  revalidateVotes(v.data.session_id);
  return ok(undefined, `Đã đổi giờ chốt thành ${v.data.cutoff_time}`);
}
