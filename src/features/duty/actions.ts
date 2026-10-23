"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { callRpc } from "@/lib/rpc";
import { currentAdminWith } from "@/lib/auth";
import { fail, ok, type ActionState } from "@/lib/action";
import type { DutyMember, DutySpinResult } from "@/lib/types";

const NO_PERMISSION = { code: "INSUFFICIENT_PERMISSION" as const, message: "Bạn không có quyền thực hiện thao tác này (cần quyền Trực nhật)" };
const name = z.string().trim().min(1, "Nhập tên").max(60, "Tối đa 60 ký tự");

/** Quay: server chọn người trúng; remove = xoá người đó khỏi vòng quay */
export async function spinDutyAction(remove: boolean): Promise<ActionState<DutySpinResult>> {
  if (!(await currentAdminWith("duty.manage"))) return fail(NO_PERMISSION);
  const r = await callRpc<DutySpinResult>("admin_duty_spin", { p_remove: Boolean(remove) });
  if (!r.ok) return fail(r.error);
  revalidatePath("/duty");
  return ok(r.data);
}

async function listOp(fn: string, args: Record<string, unknown>): Promise<ActionState<DutyMember[]>> {
  if (!(await currentAdminWith("duty.manage"))) return fail(NO_PERMISSION);
  const r = await callRpc<DutyMember[]>(fn, args);
  if (!r.ok) return fail(r.error);
  revalidatePath("/duty");
  return ok(r.data);
}

export async function addDutyMemberAction(input: string): Promise<ActionState<DutyMember[]>> {
  const v = name.safeParse(input);
  if (!v.success) return fail(v.error.issues[0].message);
  return listOp("admin_duty_add", { p_name: v.data });
}

export async function renameDutyMemberAction(id: string, input: string): Promise<ActionState<DutyMember[]>> {
  const v = z.object({ id: z.string().uuid(), name }).safeParse({ id, name: input });
  if (!v.success) return fail(v.error.issues[0].message);
  return listOp("admin_duty_rename", { p_id: v.data.id, p_name: v.data.name });
}

export async function deleteDutyMemberAction(id: string): Promise<ActionState<DutyMember[]>> {
  const v = z.string().uuid().safeParse(id);
  if (!v.success) return fail("Không hợp lệ");
  return listOp("admin_duty_delete", { p_id: v.data });
}

export async function resetDutyMembersAction(): Promise<ActionState<DutyMember[]>> {
  return listOp("admin_duty_reset", {});
}

/** Tích / bỏ tích: tích = có trên vòng quay */
export async function setDutyActiveAction(id: string, active: boolean): Promise<ActionState<DutyMember[]>> {
  const v = z.string().uuid().safeParse(id);
  if (!v.success) return fail("Không hợp lệ");
  return listOp("admin_duty_set_active", { p_id: v.data, p_active: Boolean(active) });
}

/** Reset lịch sử quay: người trong lịch sử trở lại vòng quay, rồi xoá lịch sử (chỉ người có quyền Trực nhật) */
export async function resetDutyHistoryAction(): Promise<ActionState<{ cleared: number; returned: number }>> {
  if (!(await currentAdminWith("duty.manage"))) return fail(NO_PERMISSION);
  const r = await callRpc<{ cleared: number; returned: number }>("admin_duty_reset_history");
  if (!r.ok) return fail(r.error);
  revalidatePath("/duty");
  return ok({ cleared: r.data.cleared, returned: r.data.returned },
    `Đã xoá ${r.data.cleared} lần quay, đưa ${r.data.returned} người trở lại vòng quay`);
}
