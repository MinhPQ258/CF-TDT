import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${serverEnv.cronSecret()}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Vercel Cron hằng đêm: api.reconcile() với service role. Lệch → audit + banner đỏ dashboard; không tự sửa. */
export async function GET(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  if (!process.env.CRON_SECRET || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    log("error", { request_id: requestId, action: "cron.reconcile", code: "MISCONFIGURED", detail: "Thiếu CRON_SECRET hoặc SUPABASE_SERVICE_ROLE_KEY" });
    return NextResponse.json({ code: "MISCONFIGURED" }, { status: 503 });
  }
  if (!authorized(req)) return NextResponse.json({ code: "UNAUTHORIZED" }, { status: 401 });
  const { data, error } = await createAdminClient().schema("api").rpc("reconcile", { p_source: "cron" });
  if (error) {
    log("error", { request_id: requestId, action: "cron.reconcile", code: error.code ?? "error", detail: error.message });
    return NextResponse.json({ code: "RECONCILE_FAILED" }, { status: 500 });
  }
  const result = data as { ok: boolean; diff: number; cash_total: number };
  log(result.ok ? "info" : "error", { request_id: requestId, action: "cron.reconcile", code: result.ok ? "OK" : "MISMATCH", params: result });
  return NextResponse.json(result);
}
