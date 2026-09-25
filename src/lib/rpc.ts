import "server-only";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { toAppError, type AppError } from "@/lib/errors";
import { log } from "@/lib/log";

export type RpcResult<T> = { ok: true; data: T } | { ok: false; error: AppError };

/** Hàm có ghi (tiền, tài khoản, import) — luôn log kết quả. Hàm đọc chỉ log khi lỗi. */
const WRITE_PREFIXES = ["post_", "reverse_", "admin_create", "admin_set", "admin_upsert", "admin_mark",
  "admin_publish", "admin_cancel", "close_", "cast_", "withdraw_", "import_stage", "import_commit",
  "import_discard", "complete_", "reconcile"];

/**
 * Gọi api.<fn> bằng JWT của người dùng. Không tự retry lệnh ghi (idempotency key cho phép bấm lại an toàn).
 */
export async function callRpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<RpcResult<T>> {
  const started = Date.now();
  const requestId = (await headers()).get("x-request-id");
  const supabase = await createClient();
  const isWrite = WRITE_PREFIXES.some((p) => fn.startsWith(p));
  let userId: string | null = null;
  try {
    const { data: claims } = await supabase.auth.getClaims();
    userId = (claims?.claims?.sub as string | undefined) ?? null;
    const { data, error } = await supabase.schema("api").rpc(fn, args);
    if (error) {
      const appError = toAppError(error);
      const level = appError.code === "INVARIANT_VIOLATION" || appError.code === "UNKNOWN" ? "error" : "warn";
      log(level, { request_id: requestId, user_id: userId, action: `rpc.${fn}`, code: appError.code,
        detail: appError.detail ?? error.message, params: args, duration_ms: Date.now() - started });
      return { ok: false, error: appError };
    }
    if (isWrite) {
      log("info", { request_id: requestId, user_id: userId, action: `rpc.${fn}`, code: "OK", params: args,
        duration_ms: Date.now() - started });
    }
    return { ok: true, data: data as T };
  } catch (err) {
    const appError = toAppError(err);
    log("error", { request_id: requestId, user_id: userId, action: `rpc.${fn}`, code: appError.code,
      detail: (err as Error)?.message, params: args, duration_ms: Date.now() - started });
    return { ok: false, error: appError };
  }
}

/** Dùng trong Server Component: lỗi → ném để error.tsx hiển thị. */
export async function loadRpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const r = await callRpc<T>(fn, args);
  if (!r.ok) throw new Error(r.error.message);
  return r.data;
}
