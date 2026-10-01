"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { callRpc } from "@/lib/rpc";
import { currentAdmin, currentAdminWith } from "@/lib/auth";
import { isIsoDate, vnToday } from "@/lib/dates";
import { parseVnd } from "@/lib/money";
import { fail, ok, zodFieldErrors, type ActionState } from "@/lib/action";
import type { EventResult, GiftPreview, PurchasePreview } from "@/lib/types";

const NO_PERMISSION = { code: "INSUFFICIENT_PERMISSION" as const, message: "Bạn không có quyền thực hiện thao tác này" };

const amount = z.string().transform((s, ctx) => {
  const n = parseVnd(s);
  if (n === null || n <= 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Số tiền phải là số nguyên dương" });
    return z.NEVER;
  }
  return n;
});
const date = z.string().refine(isIsoDate, "Ngày không hợp lệ");
const optText = (max: number) => z.string().trim().max(max, `Tối đa ${max} ký tự`).optional().transform((s) => s || null);

function revalidateFund() {
  for (const p of ["/admin/fund", "/admin/dashboard", "/admin/reports", "/admin/health", "/admin/purchases", "/me", "/purchases"]) revalidatePath(p);
}

const personSchema = z.object({
  idem_key: z.string().uuid(),
  kind: z.enum(["DEPOSIT", "REIMBURSEMENT"]),
  user_id: z.string().uuid("Chọn thành viên"),
  amount_vnd: amount,
  occurred_on: date,
  external_ref: optText(64),
  note: optText(500),
});

/** Tiền nộp / hoàn tiền (một người) */
export async function postPersonMoneyAction(_prev: ActionState, formData: FormData): Promise<ActionState<EventResult>> {
  if (!(await currentAdmin())) return fail(NO_PERMISSION);
  const parsed = personSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Kiểm tra lại thông tin", zodFieldErrors(parsed.error.issues));
  const v = parsed.data;
  const r = await callRpc<EventResult>(v.kind === "DEPOSIT" ? "post_deposit" : "post_reimbursement", {
    p_idem_key: v.idem_key, p_user_id: v.user_id, p_amount_vnd: v.amount_vnd, p_occurred_on: v.occurred_on,
    p_external_ref: v.external_ref, p_note: v.note,
  });
  if (!r.ok) return fail(r.error, r.error.code === "FUTURE_DATE" ? { occurred_on: r.error.message } : r.error.code === "DUPLICATE_REFERENCE" ? { external_ref: r.error.message } : undefined);
  revalidateFund();
  return ok(r.data, r.data.replayed ? "Giao dịch này đã được ghi trước đó (không ghi trùng)" : v.kind === "DEPOSIT" ? "Đã ghi tiền nộp" : "Đã ghi hoàn tiền");
}

/** uuid ổn định cho từng người trong một lần nộp nhiều người → bấm lại không ghi trùng */
function childKey(batch: string, userId: string): string {
  const h = createHash("sha256").update(`${batch}:${userId}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const bulkDepositSchema = z.object({
  idem_key: z.string().uuid(),
  user_ids: z.array(z.string().uuid()).min(1, "Chọn ít nhất 1 người nộp").max(200),
  amount_vnd: amount,
  occurred_on: date,
  external_ref: optText(64),
  note: optText(500),
});

export interface BulkDepositResult { done: number; replayed: number; failed: { user_id: string; message: string }[]; total_vnd: number }

/** Nộp quỹ nhiều người cùng số tiền: mỗi người một giao dịch Tiền nộp */
export async function postBulkDepositAction(input: {
  idem_key: string; user_ids: string[]; amount_vnd: string; occurred_on: string; external_ref?: string; note?: string;
}): Promise<ActionState<BulkDepositResult>> {
  if (!(await currentAdmin())) return fail(NO_PERMISSION);
  const parsed = bulkDepositSchema.safeParse(input);
  if (!parsed.success) return fail("Kiểm tra lại thông tin", zodFieldErrors(parsed.error.issues));
  const v = parsed.data;
  const ids = [...new Set(v.user_ids)];
  const res: BulkDepositResult = { done: 0, replayed: 0, failed: [], total_vnd: 0 };
  for (const [i, uid] of ids.entries()) {
    // Mã chứng từ không được trùng → nhiều người thì thêm hậu tố /1, /2…
    const ref = v.external_ref && ids.length > 1 ? `${v.external_ref.slice(0, 60)}/${i + 1}` : v.external_ref;
    const r = await callRpc<EventResult>("post_deposit", {
      p_idem_key: childKey(v.idem_key, uid), p_user_id: uid, p_amount_vnd: v.amount_vnd, p_occurred_on: v.occurred_on,
      p_external_ref: ref, p_note: v.note,
    });
    if (!r.ok) {
      if (r.error.code === "FUTURE_DATE") return fail(r.error, { occurred_on: r.error.message });
      res.failed.push({ user_id: uid, message: r.error.message });
      continue;
    }
    if (r.data.replayed) res.replayed++;
    else res.done++;
    res.total_vnd += v.amount_vnd;
  }
  if (res.done + res.replayed > 0) revalidateFund();
  if (res.failed.length > 0) {
    return { ...fail(`Ghi được ${res.done + res.replayed}/${ids.length} người. ${res.failed.length} người lỗi: ${res.failed[0].message}`), data: res };
  }
  return ok(res, res.done === 0 ? "Các khoản này đã được ghi trước đó (không ghi trùng)" : `Đã ghi tiền nộp cho ${ids.length} người`);
}

export async function previewGiftAction(input: { amount_vnd: string; occurred_on: string }): Promise<ActionState<GiftPreview>> {
  if (!(await currentAdmin())) return fail(NO_PERMISSION);
  const parsed = z.object({ amount_vnd: amount, occurred_on: date }).safeParse(input);
  if (!parsed.success) return fail("Kiểm tra lại thông tin", zodFieldErrors(parsed.error.issues));
  const r = await callRpc<GiftPreview>("preview_gift", { p_amount_vnd: parsed.data.amount_vnd, p_occurred_on: parsed.data.occurred_on });
  if (!r.ok) return fail(r.error);
  return ok(r.data);
}

const giftSchema = z.object({
  idem_key: z.string().uuid(),
  amount_vnd: amount,
  occurred_on: date,
  preview_hash: z.string().regex(/^[0-9a-f]{64}$/, "Cần xem trước phân bổ"),
  external_ref: optText(64),
  note: optText(500),
});

export async function postGiftAction(input: Record<string, string>): Promise<ActionState<EventResult>> {
  if (!(await currentAdmin())) return fail(NO_PERMISSION);
  const parsed = giftSchema.safeParse(input);
  if (!parsed.success) return fail("Kiểm tra lại thông tin", zodFieldErrors(parsed.error.issues));
  const v = parsed.data;
  const r = await callRpc<EventResult>("post_gift", {
    p_idem_key: v.idem_key, p_amount_vnd: v.amount_vnd, p_occurred_on: v.occurred_on, p_preview_hash: v.preview_hash,
    p_external_ref: v.external_ref, p_note: v.note,
  });
  if (!r.ok) return fail(r.error);
  revalidateFund();
  return ok(r.data, r.data.replayed ? "Khoản này đã được ghi trước đó (không ghi trùng)" : "Đã ghi tiền cho thêm");
}

const lineSchema = z.object({
  line_type: z.enum(["ITEM", "FEE", "DISCOUNT"]),
  item_name: z.string().trim().min(1, "Nhập tên").max(200),
  quantity: z.number().positive().nullable().optional(),
  unit: z.string().trim().max(32).nullable().optional(),
  line_amount_vnd: z.number().int(),
});

const purchaseBase = z.object({
  occurred_on: date,
  paid_by: z.enum(["FUND", "MEMBER"]),
  payer_user_id: z.string().uuid().nullable(),
  lines: z.array(lineSchema).min(1, "Thêm ít nhất 1 dòng").max(100),
});

export async function previewPurchaseAction(input: z.infer<typeof purchaseBase>): Promise<ActionState<PurchasePreview>> {
  if (!(await currentAdmin())) return fail(NO_PERMISSION);
  const parsed = purchaseBase.safeParse(input);
  if (!parsed.success) return fail("Kiểm tra lại phiếu", zodFieldErrors(parsed.error.issues));
  const v = parsed.data;
  const r = await callRpc<PurchasePreview>("preview_purchase", {
    p_occurred_on: v.occurred_on, p_paid_by: v.paid_by, p_payer_user_id: v.paid_by === "MEMBER" ? v.payer_user_id : null, p_lines: v.lines,
  });
  if (!r.ok) return fail(r.error);
  return ok(r.data);
}

const purchaseSchema = purchaseBase.extend({
  idem_key: z.string().uuid(),
  preview_hash: z.string().regex(/^[0-9a-f]{64}$/),
  shop: z.string().trim().max(200).nullable().optional(),
  external_ref: z.string().trim().max(64).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export async function postPurchaseAction(input: z.infer<typeof purchaseSchema>): Promise<ActionState<EventResult>> {
  if (!(await currentAdmin())) return fail(NO_PERMISSION);
  const parsed = purchaseSchema.safeParse(input);
  if (!parsed.success) return fail("Kiểm tra lại phiếu", zodFieldErrors(parsed.error.issues));
  const v = parsed.data;
  const r = await callRpc<EventResult>("post_purchase", {
    p_idem_key: v.idem_key, p_occurred_on: v.occurred_on, p_paid_by: v.paid_by,
    p_payer_user_id: v.paid_by === "MEMBER" ? v.payer_user_id : null, p_lines: v.lines, p_preview_hash: v.preview_hash,
    p_shop: v.shop || null, p_external_ref: v.external_ref || null, p_notes: v.notes || null,
  });
  if (!r.ok) return fail(r.error);
  revalidateFund();
  return ok(r.data, r.data.replayed ? "Phiếu này đã được ghi trước đó (không ghi trùng)" : "Đã ghi phiếu mua");
}

const reverseSchema = z.object({
  idem_key: z.string().uuid(),
  event_id: z.string().uuid(),
  reason: z.string().trim().min(1, "Nhập lý do đảo").max(500),
});

export async function reverseEventAction(_prev: ActionState, formData: FormData): Promise<ActionState<EventResult>> {
  if (!(await currentAdmin())) return fail(NO_PERMISSION);
  const parsed = reverseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Nhập lý do đảo", zodFieldErrors(parsed.error.issues));
  const v = parsed.data;
  const r = await callRpc<EventResult>("reverse_event", { p_event_id: v.event_id, p_reason: v.reason, p_idem_key: v.idem_key });
  if (!r.ok) return fail(r.error);
  revalidateFund();
  revalidatePath(`/admin/fund/${v.event_id}`);
  return ok(r.data, "Đã đảo giao dịch");
}

export async function reconcileNowAction(): Promise<ActionState> {
  if (!(await currentAdmin())) return fail(NO_PERMISSION);
  const r = await callRpc<{ ok: boolean; diff: number }>("reconcile", { p_source: "manual" });
  if (!r.ok) return fail(r.error);
  revalidatePath("/admin/health");
  revalidatePath("/admin/dashboard");
  return r.data.ok ? ok(r.data, "Đối soát khớp: Σ thành viên = Σ quỹ") : fail(`Đối soát phát hiện lệch ${r.data.diff} ₫ hoặc quỹ âm — xem chi tiết`);
}

const quickPurchaseSchema = z.object({
  idem_key: z.string().uuid(),
  amount_vnd: amount,
  note: z.string().trim().min(1, "Ghi chú mua gì").max(200, "Tối đa 200 ký tự"),
});

/** Mua sắm nhanh: số tiền + ghi chú → phiếu mua 1 dòng, quỹ trả, ngày hôm nay; chia đều tự động (không xem trước) */
export async function quickPurchaseAction(input: { idem_key: string; amount_vnd: string; note: string }): Promise<ActionState<EventResult>> {
  if (!(await currentAdminWith("purchases.manage"))) return fail(NO_PERMISSION);
  const parsed = quickPurchaseSchema.safeParse(input);
  if (!parsed.success) return fail("Kiểm tra lại thông tin", zodFieldErrors(parsed.error.issues));
  const v = parsed.data;
  const today = vnToday();
  const lines = [{ line_type: "ITEM", item_name: v.note, quantity: null, unit: null, line_amount_vnd: v.amount_vnd }];
  const preview = await callRpc<PurchasePreview>("preview_purchase", { p_occurred_on: today, p_paid_by: "FUND", p_payer_user_id: null, p_lines: lines });
  if (!preview.ok) return fail(preview.error);
  const r = await callRpc<EventResult>("post_purchase", {
    p_idem_key: v.idem_key, p_occurred_on: today, p_paid_by: "FUND", p_payer_user_id: null, p_lines: lines,
    p_preview_hash: preview.data.preview_hash, p_shop: null, p_external_ref: null, p_notes: v.note,
  });
  if (!r.ok) return fail(r.error);
  revalidateFund();
  return ok(r.data, r.data.replayed ? "Khoản này đã được ghi trước đó (không ghi trùng)" : `Đã ghi mua sắm ${v.amount_vnd.toLocaleString("vi-VN")} ₫`);
}
