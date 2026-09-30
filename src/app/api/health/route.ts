import { NextResponse } from "next/server";
import { isLocalBackend } from "@/lib/backend";
import { serverEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Chẩn đoán cấu hình, không cần đăng nhập, KHÔNG trả giá trị bí mật:
// Supabase có kết nối được, schema api đã expose chưa, Auth có tự xác nhận email không, đủ biến môi trường chưa.

async function probe(url: string, init: RequestInit): Promise<{ status: number; body: any } | { error: string }> {
  try {
    const r = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(8000) });
    const text = await r.text();
    let body: any = text;
    try { body = JSON.parse(text); } catch { body = text.slice(0, 200); }
    return { status: r.status, body };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function GET() {
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    CRON_SECRET: Boolean(process.env.CRON_SECRET),
    APP_AUTH_EMAIL_DOMAIN: serverEnv.authEmailDomain(),
  };
  if (isLocalBackend()) return NextResponse.json({ backend: "local", env });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.json({ backend: "supabase", ok: false, env, problem: "Thiếu URL hoặc anon key" }, { status: 503 });
  const headers = { apikey: key, Authorization: `Bearer ${key}` };

  // Auth: 200 + mailer_autoconfirm
  const auth = await probe(`${url}/auth/v1/settings`, { headers });
  // Data API: anon gọi api.me → 42501 (bị chặn đúng) nghĩa là schema api ĐÃ expose; PGRST106 = chưa expose
  const api = await probe(`${url}/rest/v1/rpc/me`, {
    method: "POST", headers: { ...headers, "Content-Type": "application/json", "Content-Profile": "api" }, body: "{}",
  });

  const authOk = "status" in auth && auth.status === 200;
  const apiCode = "status" in api ? (api.body?.code ?? String(api.status)) : `network: ${api.error}`;
  const apiExposed = apiCode === "42501" || ("status" in api && api.status === 200);
  const problems: string[] = [];
  if (!authOk) problems.push(`Auth không phản hồi đúng (${"status" in auth ? auth.status : auth.error}) — kiểm tra NEXT_PUBLIC_SUPABASE_URL / ANON_KEY`);
  if (apiCode === "PGRST106") problems.push("Schema api chưa được thêm vào Exposed schemas");
  else if (apiCode === "PGRST202") problems.push("Chưa có hàm api.me — chưa chạy coffee_tdt_full.sql");
  else if (!apiExposed) problems.push(`Data API trả mã ${apiCode}`);
  if (authOk && "body" in auth && auth.body?.mailer_autoconfirm === false) {
    problems.push("Confirm email đang bật: user tạo trong Dashboard phải tick Auto Confirm");
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) problems.push("Thiếu SUPABASE_SERVICE_ROLE_KEY");
  if (!env.CRON_SECRET) problems.push("Thiếu CRON_SECRET");

  return NextResponse.json({
    backend: "supabase",
    ok: problems.length === 0,
    env,
    auth: authOk ? { reachable: true, disable_signup: auth.body?.disable_signup, mailer_autoconfirm: auth.body?.mailer_autoconfirm } : { reachable: false },
    data_api: { api_schema_exposed: apiExposed, code: apiCode },
    problems,
  }, { status: problems.length ? 503 : 200 });
}
