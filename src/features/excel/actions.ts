"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { callRpc } from "@/lib/rpc";
import { currentAdminWith } from "@/lib/auth";
import { fail, ok, type ActionState } from "@/lib/action";
import { parseImportFile } from "@/lib/excel/parse";
import { IMPORT_SPECS } from "@/lib/excel/spec";
import { createAccount, type CreatedAccount } from "@/features/users/service";
import type { ImportJob, ImportKind } from "@/lib/types";

const NO_PERMISSION = { code: "INSUFFICIENT_PERMISSION" as const, message: "Bạn không có quyền thực hiện thao tác này" };
const kindSchema = z.enum(["MEMBERS", "DEPOSITS", "GIFTS", "PURCHASES", "REIMBURSEMENTS"]);

export interface StageResult {
  job_id?: string;
  structure_errors?: string[];
}

/** Bước 1: đọc file (cấu trúc) → stage vào DB (kiểm tra nghiệp vụ từng dòng) */
export async function stageImportAction(_prev: ActionState<StageResult>, formData: FormData): Promise<ActionState<StageResult>> {
  if (!(await currentAdminWith("excel.manage"))) return fail(NO_PERMISSION);
  const kind = kindSchema.safeParse(formData.get("kind"));
  const file = formData.get("file");
  if (!kind.success) return fail("Chọn loại dữ liệu import", { kind: "Chọn loại" });
  if (!(file instanceof File) || file.size === 0) return fail("Chọn file .xlsx", { file: "Chọn file" });
  if (!file.name.toLowerCase().endsWith(".xlsx")) return fail("Chỉ nhận file .xlsx", { file: "Chỉ nhận .xlsx" });

  const parsed = await parseImportFile(kind.data, new Uint8Array(await file.arrayBuffer()));
  if (!parsed.ok) {
    return { ok: false, message: "File sai cấu trúc — chưa ghi gì", code: "INVALID_INPUT", data: { structure_errors: parsed.errors }, at: Date.now() };
  }
  const r = await callRpc<ImportJob>("import_stage", { p_kind: kind.data, p_file_name: file.name, p_checksum: parsed.checksum, p_rows: parsed.rows });
  if (!r.ok) return fail(r.error);
  revalidatePath("/admin/import-export");
  return ok({ job_id: r.data.id }, r.data.status === "READY" ? "Đã đọc file, kiểm tra preview rồi xác nhận ghi" : `File có ${r.data.error_count} dòng lỗi — chưa ghi gì`);
}

export interface CommitResult {
  status: string;
  documents?: number;
  accounts?: CreatedAccount[];
}

/**
 * Bước 2: ghi nguyên khối. Import MEMBERS: tạo tài khoản còn thiếu trước (auth cần service key, không nằm trong transaction DB),
 * rồi import_commit ghi membership trong một transaction. Tạo tài khoản là idempotent theo username.
 */
export async function commitImportAction(input: { job_id: string; preview_hash: string }): Promise<ActionState<CommitResult>> {
  if (!(await currentAdminWith("excel.manage"))) return fail(NO_PERMISSION);
  const v = z.object({ job_id: z.string().uuid(), preview_hash: z.string().regex(/^[0-9a-f]{64}$/) }).safeParse(input);
  if (!v.success) return fail("Yêu cầu không hợp lệ");

  const job = await callRpc<ImportJob>("import_preview", { p_job_id: v.data.job_id });
  if (!job.ok) return fail(job.error);
  if (job.data.status === "HAS_ERRORS") return fail({ code: "IMPORT_HAS_ERRORS", message: "File còn dòng lỗi, sửa rồi tải lên lại" });
  if (job.data.preview_hash !== v.data.preview_hash) return fail({ code: "IMPORT_STALE", message: "Dữ liệu đã thay đổi sau khi xem trước, hãy xem lại preview" });

  const accounts: CreatedAccount[] = [];
  if (job.data.kind === "MEMBERS") {
    for (const row of job.data.rows ?? []) {
      const n = row.normalized;
      if (!n || n.exists !== false) continue;
      const created = await createAccount({ employee_code: n.employee_code, username: n.username, display_name: n.display_name, role: n.role });
      if (!created.ok) {
        return { ...created.state, message: `Dòng ${row.row_no}: ${created.state.message}. Các tài khoản đã tạo trước đó vẫn giữ; tải lại preview rồi ghi tiếp.`,
          data: { status: "PARTIAL_ACCOUNTS", accounts } };
      }
      accounts.push(created.account);
    }
  }

  const r = await callRpc<{ status: string; documents?: number; replayed?: boolean }>("import_commit", { p_job_id: v.data.job_id, p_preview_hash: v.data.preview_hash });
  revalidatePath("/admin/import-export");
  if (!r.ok) return { ...fail(r.error), data: { status: "ERROR", accounts } };
  if (r.data.status === "STALE") return { ...fail({ code: "IMPORT_STALE", message: "Dữ liệu đã thay đổi sau khi xem trước, hãy xem lại preview" }), data: { status: "STALE", accounts } };
  if (r.data.status === "HAS_ERRORS") return { ...fail({ code: "IMPORT_HAS_ERRORS", message: "File còn dòng lỗi, sửa rồi tải lên lại" }), data: { status: "HAS_ERRORS", accounts } };
  for (const p of ["/admin/fund", "/admin/dashboard", "/admin/users", "/admin/purchases"]) revalidatePath(p);
  return ok({ status: "COMMITTED", documents: r.data.documents, accounts },
    r.data.replayed ? "File này đã được ghi trước đó" : `Đã ghi ${r.data.documents ?? 0} ${IMPORT_SPECS[job.data.kind as ImportKind].title.toLowerCase()}`);
}

export async function discardImportAction(input: { job_id: string }): Promise<ActionState> {
  if (!(await currentAdminWith("excel.manage"))) return fail(NO_PERMISSION);
  const id = z.string().uuid().safeParse(input.job_id);
  if (!id.success) return fail("Yêu cầu không hợp lệ");
  const r = await callRpc("import_discard", { p_job_id: id.data });
  if (!r.ok) return fail(r.error);
  revalidatePath("/admin/import-export");
  return ok(undefined, "Đã hủy lần import");
}
