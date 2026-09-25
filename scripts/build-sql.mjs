// Gộp supabase/migrations/*.sql thành 1 file chạy trong Supabase SQL Editor.
// Chạy: npm run db:bundle
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(process.cwd(), "supabase", "migrations");
const out = join(process.cwd(), "supabase", "deploy", "coffee_tdt_full.sql");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

const header = `-- ============================================================================
-- Coffee TDT — toàn bộ schema + hàm RPC + bảo mật (SINH TỰ ĐỘNG, đừng sửa tay)
-- Nguồn: supabase/migrations/*.sql · Sinh lại: npm run db:bundle
--
-- CÁCH DÙNG (project Supabase MỚI, chạy 1 lần):
--   1. Supabase Dashboard → SQL Editor → New query → dán toàn bộ file → Run.
--      Chạy trong 1 transaction: lỗi ở đâu thì không có gì được tạo.
--   2. Settings → API → "Exposed schemas": thêm  api   (giữ public, graphql_public).
--   3. Authentication → Sign In / Providers: tắt "Allow new users to sign up",
--      Email: tắt "Confirm email"; đặt độ dài mật khẩu tối thiểu ≥ 8.
--   4. Tạo admin đầu tiên: xem supabase/deploy/seed_first_admin.sql.
-- ============================================================================

begin;
`;

const body = files
  .map((f) => `\n-- ────────────────────────────────────────────────────────────────────────────\n-- ${f}\n-- ────────────────────────────────────────────────────────────────────────────\n${readFileSync(join(dir, f), "utf8").trim()}\n`)
  .join("");

const footer = `
-- Báo PostgREST nạp lại schema cache để thấy các hàm api.*
notify pgrst, 'reload schema';

commit;
`;

writeFileSync(out, header + body + footer);
console.log(`Đã ghi ${out} (${files.length} migration)`);
