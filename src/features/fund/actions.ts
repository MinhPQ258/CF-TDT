"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { callRpc } from "@/lib/rpc";
import { currentAdmin } from "@/lib/auth";
import { isIsoDate } from "@/lib/dates";
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
