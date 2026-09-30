# Coffee TDT

Web app nội bộ: vote pha cà phê chung + quỹ cà phê (tiền nộp, tiền cho thêm, mua đồ quỹ trả / mua hộ, hoàn tiền, chia đều, đối soát, Excel).
Theo `v2_CoffeeTDT_DEV_Plan_Web.md` và sổ quyết định `v2_CoffeeTDT_Review_BA_DBA.md`.

**Stack:** Next.js 15 (App Router, TypeScript) trên Vercel · Supabase (Postgres + Auth) · Tailwind 4 · exceljs · zod.

## Nguyên tắc

1. **Logic tiền chỉ ở PL/pgSQL** (`supabase/migrations`). Preview và post dùng chung `private.allocate` / `private.purchase_plan`; TypeScript không chia tiền.
2. **Một nghiệp vụ tiền = một RPC = một transaction.** Trigger deferred chặn COMMIT nếu một event có Σmember ≠ Σcash.
3. **Sổ chỉ ghi thêm.** UPDATE/DELETE ledger bị trigger chặn; sửa sai = `reverse_event` (dòng đảo giữ entry_type gốc, ngược dấu).
4. **Hai lớp quyền.** Middleware + `requireAdmin()` ở Next.js; mỗi hàm `api.*` tự kiểm `auth.uid()` + role. Bảng bật RLS, không có policy ghi.
5. **Idempotency.** Form sinh `idempotency_key` khi mở; gửi lại/double-click trả event cũ.

## Cấu trúc

```text
supabase/migrations/     DDL, trigger, hàm private.* (logic tiền) và api.* (RPC), RLS — nguồn sự thật DB
supabase/deploy/         coffee_tdt_full.sql (gộp để dán vào SQL Editor) + seed_first_admin.sql
supabase/seed.sql        dữ liệu mẫu dev (supabase db reset)
src/middleware.ts        phiên, request_id, khóa TK, ép đổi MK, chặn /admin
src/lib/                 supabase clients, rpc wrapper + log JSON, mã lỗi → tiếng Việt, VND, ngày VN, excel
src/features/*/actions   Server Actions: validate (zod) → RPC → map lỗi
src/app/(auth|member)/   đăng nhập, đổi MK, số dư, vote, phiếu mua
src/app/admin/           dashboard, sổ quỹ, mua đồ, vote, thành viên quỹ, tài khoản, báo cáo, Excel, sức khỏe sổ
src/app/api/             cron đối soát, xuất Excel, file mẫu import
tests/db/                test trên Postgres thật (PGlite): posting, bất biến, quyền/RLS, vote, import, property 200 bước
tests/unit/              money, errors, dates, excel
```

## Chạy test

```bash
npm install
npm test
```

`tests/db` chạy **toàn bộ migration trên Postgres 18 (PGlite, WASM)** với shim Supabase tối thiểu (`auth.users`, `auth.uid()`, roles), không cần Docker. Thay cho pgTAP trong plan: cùng các ca kiểm (100/3, A/B/C, đảo/đảo lại, INVARIANT_VIOLATION, RLS, idempotency song song…).

## Đăng nhập

Người dùng đăng nhập bằng **tên đăng nhập + mật khẩu**; server tra tài khoản theo username (không ghép email). Tài khoản mới và tài khoản được admin đặt lại dùng mật khẩu mặc định `APP_DEFAULT_PASSWORD` (mặc định `123456`), không bắt đổi mật khẩu (bật lại bằng `APP_FORCE_PASSWORD_CHANGE=true`). Supabase Auth: đặt **Minimum password length ≤ 6**.

## Chạy thử trên máy (không cần Supabase / Docker)

```bash
npm install
npm run dev:local
```

Mở http://localhost:3000. Chế độ local (`COFFEE_BACKEND=local`) chạy **đúng các file `supabase/migrations`** trên Postgres nhúng (PGlite) lưu ở `.local-db/`; chỉ phần đăng nhập Supabase được thay bằng bảng mật khẩu local + cookie ký HMAC. Lần đầu chạy tự nạp dữ liệu mẫu (`src/lib/backend/local-seed.ts`):

| Tài khoản | Vai trò | Ghi chú |
| --- | --- | --- |
| `admin` | ADMIN | Vào thẳng Đợt pha & vote |
| `anh`, `binh`, `chi` | Thành viên quỹ | Có sẵn tiền nộp, 1 phiếu mua hộ, 1 khoản cho thêm, 1 đợt pha đang mở |
| `moi` | Thành viên | Không thuộc quỹ |

Mật khẩu mặc định: `123456`. Xóa dữ liệu làm lại: `npm run local:reset`. Migration mới được áp tự động khi khởi động lại.

## Triển khai Supabase (project mới)

1. SQL Editor → dán `supabase/deploy/coffee_tdt_full.sql` → Run (một transaction).
2. **Settings → API → Exposed schemas: thêm `api`.**
3. Authentication: tắt sign-up công khai, tắt Confirm email, mật khẩu tối thiểu 8.
4. Tạo admin đầu tiên theo `supabase/deploy/seed_first_admin.sql`.
5. **DB đã chạy bản cũ** (11 migration, trước 30/09): chạy thêm `supabase/deploy/upgrade_012_vote_options.sql`. Kiểm tra: https://cf-tdt.vercel.app/api/health → `migrations` đều `true`.
6. Sau khi sửa migration: `npm run db:bundle` để sinh lại file gộp (CI kiểm file gộp khớp migrations).

Với Supabase CLI: `supabase link --project-ref <ref>` rồi `supabase db push` dùng thẳng `supabase/migrations`.

## Nâng cấp DB production + deploy (thủ công)

Production KHÔNG tự chạy migration. Mỗi lần có migration mới, làm đúng thứ tự:

1. **Chạy SQL trước:** Supabase Dashboard → SQL Editor → dán file nâng cấp trong `supabase/deploy/` → Run.
   Hiện tại: `upgrade_013_016.sql` (DB đang ở migration 12 → 16). File chạy trong 1 transaction và chạy lại được.
2. **Rồi mới push `main`:** Vercel tự deploy khi push. Push trước khi chạy SQL thì web lỗi vì thiếu hàm mới.
3. **Kiểm tra:** `/api/health` → mọi mục `migrations` là `true`.

GitHub Actions (`ci.yml`) chỉ kiểm tra: lint, typecheck, test (gồm test chạy file nâng cấp trên DB migration 12), bundle SQL, build.
Migration mới: thêm file vào `supabase/migrations/` (chỉ thêm, tương thích ngược), chạy `npm run db:bundle`, tạo file nâng cấp tương ứng trong `supabase/deploy/`. Local tự áp migration khi khởi động `npm run dev:local`.

## Vercel

Biến môi trường (xem `.env.example`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (chỉ server: tạo TK, đặt lại MK, khóa phiên, cron), `CRON_SECRET`, `APP_AUTH_EMAIL_DOMAIN=coffee.internal`.
`vercel.json`: region `sin1`, cron `/api/cron/reconcile` 00:00 giờ VN. Node 22.

## Go-live từ 0 (quyết định 1B)

Tất toán ngoài app → import `Thanh_vien` (Excel, `start_date` = ngày go-live; tài khoản mới nhận mật khẩu tạm hiện một lần) → mọi người đổi MK → giao dịch đầu tiên.
