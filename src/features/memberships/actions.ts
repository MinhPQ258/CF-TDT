"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { callRpc } from "@/lib/rpc";
import { currentAdmin } from "@/lib/auth";
import { isIsoDate } from "@/lib/dates";
import { fail, ok, zodFieldErrors, type ActionState } from "@/lib/action";

const NO_PERMISSION = { code: "INSUFFICIENT_PERMISSION" as const, message: "Bạn không có quyền thực hiện thao tác này" };

const schema = z.object({
  membership_id: z.string().uuid().optional().or(z.literal("")),
  user_id: z.string().uuid().optional().or(z.literal("")),
  start_date: z.string().refine(isIsoDate, "Ngày bắt đầu không hợp lệ"),
  end_date: z.string().refine((s) => s === "" || isIsoDate(s), "Ngày kết thúc không hợp lệ").optional(),
  reason: z.string().trim().max(500).optional(),
});

export interface MembershipImpact {
  affected_posted_events: number;
  balance_vnd: number;
}

/** Bước 1: tính số phiếu đã post bị "lệch lịch sử" + số dư, để hiển thị hộp xác nhận. */
export async function membershipImpactAction(input: {
  membership_id?: string; user_id?: string; start_date: string; end_date?: string;
}): Promise<ActionState<MembershipImpact>> {
  if (!(await currentAdmin())) return fail(NO_PERMISSION);
  const parsed = schema.safeParse(input);
  if (!parsed.success) return fail("Kiểm tra lại ngày", zodFieldErrors(parsed.error.issues));
  const v = parsed.data;
  if (!v.membership_id && !v.user_id) return fail("Chọn thành viên", { user_id: "Chọn thành viên" });
  if (v.end_date && v.end_date <= v.start_date) return fail("Ngày kết thúc phải sau ngày bắt đầu", { end_date: "Phải sau ngày bắt đầu" });
  const r = await callRpc<MembershipImpact>("admin_membership_impact", {
    p_membership_id: v.membership_id || null, p_user_id: v.user_id || null,
    p_start_date: v.start_date, p_end_date: v.end_date || null,
  });
  if (!r.ok) return fail(r.error);
  return ok(r.data);
}

/** Bước 2: lưu (lý do bắt buộc) */
export async function saveMembershipAction(input: {
  membership_id?: string; user_id?: string; start_date: string; end_date?: string; reason: string;
}): Promise<ActionState<MembershipImpact>> {
  if (!(await currentAdmin())) return fail(NO_PERMISSION);
  const parsed = schema.safeParse(input);
  if (!parsed.success) return fail("Kiểm tra lại thông tin", zodFieldErrors(parsed.error.issues));
  const v = parsed.data;
  if (!v.reason) return fail("Nhập lý do thay đổi", { reason: "Lý do bắt buộc" });
  const r = await callRpc<MembershipImpact & { membership_id: string }>("admin_upsert_membership", {
    p_membership_id: v.membership_id || null, p_user_id: v.user_id || null,
    p_start_date: v.start_date, p_end_date: v.end_date || null, p_reason: v.reason,
  });
  if (!r.ok) return fail(r.error);
  revalidatePath("/admin/memberships");
  revalidatePath("/admin/users");
  revalidatePath("/admin/dashboard");
  return ok(r.data, "Đã lưu thành viên quỹ");
}
