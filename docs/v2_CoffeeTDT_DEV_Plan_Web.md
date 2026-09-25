# Coffee TDT — Kế hoạch phát triển web app

**Phiên bản:** 2.0 · **Ngày:** 25/09/2026 · **Thay thế:** `v1_CoffeeTDT_DEV_Plan_Web.md` (1.0)
**Đầu vào:** BA v2.2, DBA v2.2, **`v2_CoffeeTDT_Review_BA_DBA.md` (sổ quyết định — ưu tiên cao hơn BA/DBA khi mâu thuẫn)**
**Hạ tầng:** Next.js (App Router, TypeScript) trên **Vercel** + **Supabase** (Postgres + Auth). Repo & cấu hình: *chờ MinhPQ cung cấp* (xem §10).
**Hiển thị:** desktop từ 1366×768; mobile xuống 375×667 CSS px.

---

## 1. Phạm vi bản đầu (giữ nguyên, đã làm rõ)

| Module | Thành viên | Quản trị |
|---|---|---|
| Đăng nhập | Đăng nhập username + mật khẩu, bắt buộc đổi mật khẩu lần đầu, đổi mật khẩu, đăng xuất | Tạo tài khoản (sinh mật khẩu tạm, hiện 1 lần), khóa/mở, đặt lại mật khẩu, phân vai |
| Vote pha chung | Mọi tài khoản ACTIVE: xem đợt, vote/sửa/rút trước giờ chốt, xem kết quả **có tên** | Tạo/đăng/hủy/chốt sớm đợt, nhiều đợt/ngày |
| Quỹ | Số dư + lịch sử của mình; **tổng quỹ thực**; **danh sách phiếu mua** kèm phần chia của mình | Ghi tiền nộp, tiền cho thêm, hoàn tiền; đảo giao dịch; đối soát; quản lý membership (có lý do) |
| Mua đồ | Chỉ xem | Phiếu nhiều dòng (ITEM/FEE/DISCOUNT), QUỸ trả hoặc CÁ NHÂN mua hộ, **xem trước phân bổ** → xác nhận |
| Thống kê | Số cần nộp thêm / đã ứng, giải thích theo loại | Dashboard: quỹ thực, **chi phí phát sinh**, **quỹ đã chi**, tiền nộp, tiền cho thêm, số người/tổng cần nộp, cờ "rời quỹ chưa tất toán" |
| Excel | Không | Tải mẫu, preview, commit nguyên khối, xuất 6 sheet |

**Không nằm trong phạm vi:** số dư mở sổ (go-live từ 0), bút toán điều chỉnh tự do, quà không chia, thành viên tự gửi chứng từ, giá/cốc, công thức, tồn kho, pha lẻ, blog, thanh toán tự động — xem §11.

## 2. Kiến trúc (phương án B)

```
 Trình duyệt (desktop / mobile)
   │  HTML + Server Actions / Route Handlers, cookie phiên Supabase (HttpOnly)
   ▼
 Vercel — Next.js server (region gần Supabase, vd sin1)
   ├─ middleware: làm mới phiên, chặn /admin nếu không phải ADMIN, ép đổi mật khẩu
   ├─ features/*: validate input (zod) → gọi RPC → map mã lỗi → UI
   ├─ lib/excel: đọc/ghi .xlsx (exceljs), không post trực tiếp
   └─ SUPABASE_SECRET/SERVICE key: CHỈ dùng cho auth.admin.createUser/resetPassword
   │
   ▼ supabase-js với JWT của người dùng (RLS áp dụng)
 Supabase Postgres
   ├─ schema public: bảng dữ liệu, RLS BẬT, KHÔNG có policy ghi cho authenticated
   ├─ schema api: hàm RPC (SECURITY DEFINER, search_path cố định)
   │     post_deposit / post_gift / post_reimbursement
   │     preview_purchase / post_purchase / reverse_event
   │     cast_vote / withdraw_vote / close_vote_early
   │     my_balance / my_ledger / fund_summary / admin_* reports
   │     import_stage / import_commit
   ├─ trigger ràng buộc DEFERRED: mỗi event Σmember = Σcash (chặn COMMIT nếu lệch)
   └─ audit_events (append-only)
 Supabase Auth (auth.users) ── profiles.id = auth.users.id
```

**Nguyên tắc cứng:**
1. **Logic tiền chỉ tồn tại ở một nơi: hàm PL/pgSQL.** Preview và post dùng chung một hàm tính phân bổ (`api._allocate`) — TypeScript không bao giờ tự chia tiền (DRY, tránh lệch 1 đồng giữa preview và sổ).
2. Mỗi nghiệp vụ tiền = **một lệnh RPC = một transaction**. Không có transaction nhiều bước qua pooler serverless.
3. Mọi hàm RPC tự kiểm quyền bằng `auth.uid()` + `profiles.role`; server Next.js kiểm thêm lần nữa (phòng thủ 2 lớp). Không tin `user_id` từ client cho thao tác "của tôi".
4. Bảng ledger: `REVOKE UPDATE, DELETE` với mọi role ứng dụng; trigger chặn UPDATE/DELETE.

### Cấu trúc mã

```text
supabase/
  migrations/            # DDL, RLS, hàm RPC — nguồn sự thật của DB
  tests/                 # pgTAP: posting, bất biến, quyền
  seed.sql               # CHỈ dữ liệu mẫu cho dev/staging
src/
  app/(auth)/login  (auth)/change-password
  app/(member)/votes  (member)/me  (member)/purchases
  app/admin/{dashboard,users,memberships,votes,fund,purchases,reports,import-export}
  features/{auth,votes,fund,purchases,reports,excel}/   # actions, schema zod, components
  lib/supabase/{server,admin}.ts  lib/errors.ts  lib/money.ts (chỉ format VND)  lib/log.ts
tests/{unit,integration,e2e}
```

## 3. Thiết kế DB đã chỉnh (so với DBA v2.2)

| Bảng | Thay đổi |
|---|---|
| `profiles` (thay `users`) | `id uuid PK = auth.users.id`, `employee_code UNIQUE`, `username citext UNIQUE`, `display_name`, `role MEMBER/ADMIN`, `status ACTIVE/DISABLED`, `must_change_password bool`. **Bỏ `password_hash`.** |
| `fund_memberships` | `start_date date`, `end_date date NULL`, `EXCLUDE USING gist (user_id WITH =, daterange(start_date, end_date, '[)') WITH &&)` (cần `btree_gist`), `reason`, `updated_by`, `updated_at`. |
| `fund_events` | `occurred_on date` (thay `occurred_at`), **`idempotency_key uuid UNIQUE NOT NULL`**, `external_ref text NULL` (UNIQUE theo `kind` khi có), `kind` bỏ `ADJUSTMENT` (không tồn tại), `reverses_event_id UNIQUE NULL`, `status POSTED/REVERSED`, `reason` bắt buộc khi REVERSAL, `payload_hash` (hash preview đã xác nhận). |
| `purchases` | `external_ref NULL`, `total_amount_vnd` **do hàm tính** = Σ dòng, `CHECK > 0`. |
| `purchase_items` | `line_type ITEM/FEE/DISCOUNT`; `CHECK ((line_type='DISCOUNT' AND line_amount_vnd < 0) OR (line_type<>'DISCOUNT' AND line_amount_vnd >= 0))`. |
| `member_ledger` | `entry_type DEPOSIT_CREDIT/GIFT_SHARE/PURCHASE_SHARE/PURCHASE_CREDIT/REIMBURSEMENT_DEBIT` (**bỏ REVERSAL**), `reverses_entry_id UNIQUE NULL`, `occurred_on date`. |
| `cash_ledger` | `reverses_entry_id UNIQUE NULL`, `occurred_on date`. |
| `vote_sessions` | `status DRAFT/PUBLISHED/CANCELLED`, `closed_early_at NULL`; "đang mở" = `PUBLISHED AND closed_early_at IS NULL AND now() >= opens_at AND now() < cutoff_at`. |
| `votes` | `choice YES/NO`; `CHECK (choice='NO' → coffee_type IS NULL AND cups IS NULL)`; rút phiếu = `is_withdrawn=true` (giữ dòng để audit). |
| `import_jobs`, `import_rows` | staging từng dòng + lỗi; `file_checksum UNIQUE` theo loại import. |
| `audit_events` | append-only: actor, action, entity, before/after JSON, reason, request_id. |

### Posting (trong hàm, một transaction)

```
post_purchase(p_idem_key, p_occurred_on, p_paid_by, p_payer, p_lines[], p_preview_hash)
  1. assert is_admin(auth.uid())                          → INSUFFICIENT_PERMISSION
  2. nếu idempotency_key đã tồn tại → trả lại event cũ  (idempotent, KHÔNG lỗi)
  3. validate: occurred_on ≤ today(VN), lines ≥1, total>0  → INVALID_INPUT / FUTURE_DATE
  4. members := memberships hiệu lực tại occurred_on, ORDER BY employee_code, id
     N = 0 → NO_ACTIVE_MEMBERS ; paid_by=MEMBER & payer ∉ members → PAYER_NOT_MEMBER
  5. alloc := _allocate(total, members, sign=-1)
  6. hash(occurred_on, members, alloc, lines) ≠ p_preview_hash → MEMBERSHIP_CHANGED
  7. insert fund_event, purchase, items, cash (nếu FUND), member rows (+credit nếu MEMBER)
  8. audit_events ; COMMIT → trigger deferred kiểm Σmember = Σcash của event
```

`reverse_event(p_event_id, p_reason, p_idem_key)`: khóa event gốc `FOR UPDATE`; đã REVERSED → `ALREADY_REVERSED`; tạo event REVERSAL; mỗi dòng cash/member gốc sinh một dòng **cùng user, cùng entry_type, ngược dấu**, `reverses_entry_id` trỏ về gốc; không đọc membership hiện tại. Đảo một REVERSAL được phép (khôi phục gốc).

## 4. Hợp đồng API / lỗi

Giữ bảng API của v1.0 §3, triển khai bằng Server Actions/Route Handlers gọi RPC. Bổ sung:

- `POST /api/admin/purchases/preview` → `{members[], shares[], total, preview_hash}`; `POST /api/admin/purchases` nhận `idempotency_key` + `preview_hash`.
- `GET /api/purchases` (thành viên): danh sách phiếu + phần của tôi. `GET /api/fund/summary`: tổng quỹ thực.
- `PATCH /api/admin/memberships/:id` bắt buộc `reason`; trả `affected_posted_events` để UI cảnh báo.

**Mã lỗi ổn định** (hàm `RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='<CODE>'`, `lib/errors.ts` map sang thông báo tiếng Việt):
`INVALID_INPUT, FUTURE_DATE, VOTE_CLOSED, VOTE_NOT_OPEN, DUPLICATE_REFERENCE, MEMBERSHIP_CHANGED, MEMBERSHIP_OVERLAP, NO_ACTIVE_MEMBERS, PAYER_NOT_MEMBER, ALREADY_REVERSED, INVARIANT_VIOLATION, INSUFFICIENT_PERMISSION, ACCOUNT_DISABLED, MUST_CHANGE_PASSWORD, IMPORT_DUPLICATE_FILE, IMPORT_HAS_ERRORS, IMPORT_STALE`.

## 5. Bản đồ lỗi & xử lý

| Luồng | Điều gì có thể sai | Mã / exception | Xử lý | Người dùng thấy |
|---|---|---|---|---|
| Đăng nhập | Sai mật khẩu nhiều lần | Supabase `invalid_credentials` / rate limit | Dựa rate limit Supabase Auth; log cảnh báo | "Sai tên đăng nhập hoặc mật khẩu" (không lộ cái nào sai) |
| Đăng nhập | Tài khoản DISABLED | `ACCOUNT_DISABLED` | Middleware kiểm `profiles.status`, xóa phiên; khi khóa → `auth.admin.signOut` | "Tài khoản đã bị khóa, liên hệ quản trị" |
| Mọi trang | Phiên hết hạn giữa form | 401 | Giữ nháp form trong state, redirect login rồi quay lại | Thông báo đăng nhập lại, không mất dữ liệu đã gõ |
| Post tiền | Double-click / refresh / mạng chập chờn gửi lại | trùng `idempotency_key` | Trả event cũ | Thấy kết quả 1 lần duy nhất |
| Post mua | Membership đổi giữa preview và xác nhận | `MEMBERSHIP_CHANGED` | Tải lại preview | "Danh sách người chia đã thay đổi, xem lại" |
| Post mua | Không có thành viên / người mua không phải thành viên | `NO_ACTIVE_MEMBERS` / `PAYER_NOT_MEMBER` | Chặn | Lỗi dưới ô tương ứng |
| Post bất kỳ | Bug hàm làm lệch sổ | `INVARIANT_VIOLATION` (trigger) | ROLLBACK toàn bộ, log `error` kèm payload | "Không ghi được — lỗi hệ thống đã được ghi nhận" |
| Post bất kỳ | DB timeout / Supabase gián đoạn | lỗi mạng/`57014` | KHÔNG tự retry lệnh tiền (idempotency cho phép người dùng bấm lại an toàn) | "Chưa chắc đã ghi — bấm Gửi lại, hệ thống không ghi trùng" |
| Đảo | Đã đảo rồi (2 admin cùng lúc) | `ALREADY_REVERSED` | Khóa `FOR UPDATE` | "Giao dịch đã được đảo trước đó" |
| Vote | Gửi sau giờ chốt / đang chốt sớm | `VOTE_CLOSED` | `cast_vote` khóa session `FOR SHARE`; `close_vote_early` khóa `FOR UPDATE` | "Đợt đã chốt lúc hh:mm" |
| Membership | Chồng khoảng thời gian | `23P01` exclusion → `MEMBERSHIP_OVERLAP` | Chặn | Chỉ rõ khoảng bị trùng |
| Import | File > giới hạn, sai sheet/cột | `INVALID_INPUT` | Từ chối trước khi stage | Danh sách lỗi cấu trúc |
| Import | Dòng lỗi | `IMPORT_HAS_ERRORS` | Không cho commit | Bảng lỗi theo dòng |
| Import | File đã import | `IMPORT_DUPLICATE_FILE` / trùng `external_ref` | Chặn | Chỉ ra job/dòng đã có |
| Import | Membership đổi sau preview | `IMPORT_STALE` | Buộc preview lại | "Dữ liệu đã thay đổi, xem lại preview" |
| Xuất Excel | Kỳ quá dài / quá nhiều dòng | `INVALID_INPUT` | Giới hạn 12 tháng / 20.000 dòng | Gợi ý thu hẹp kỳ |
| Đối soát hằng ngày | Σmember ≠ Σcash | cron phát hiện | Ghi `audit_events`, banner đỏ ở dashboard admin, **không tự sửa** | Admin thấy banner + event nghi vấn |

**Cấm:** `catch {}` rỗng, `catch (e) { console.log(e) }` rồi tiếp tục. Server log lỗi có cấu trúc: `request_id, user_id, action, code, params (không chứa mật khẩu)`.

## 6. Máy trạng thái

```
fund_event:   POSTED ──reverse_event──▶ REVERSED     (một chiều, 1 lần; event REVERSAL mới ở trạng thái POSTED)
vote_session: DRAFT ──publish──▶ PUBLISHED ──(now ≥ cutoff | close_early)──▶ [đã chốt, suy ra]
              DRAFT/PUBLISHED ──cancel──▶ CANCELLED        (CANCELLED/đã chốt: không nhận vote)
import_job:   UPLOADED ─validate─▶ HAS_ERRORS | READY ─commit─▶ COMMITTED
              READY ─(dữ liệu đổi)─▶ STALE ─preview lại─▶ READY ; mọi trạng thái trừ COMMITTED ─▶ DISCARDED
profile:      ACTIVE(must_change_password) ─đổi MK─▶ ACTIVE ⇄ DISABLED
```

## 7. Giao diện & responsive

Giữ nguyên §4 của v1.0 (breakpoint, 44px, 16px, Safari 667, bảng QA 6 màn hình). Bổ sung:

- **Số dư của tôi** trả lời 3 câu theo thứ tự: *Tôi cần nộp bao nhiêu?* (số lớn, nhãn chữ "Cần nộp thêm"/"Đang dư", không chỉ màu) → *Vì sao?* (nhóm theo loại: đã nộp, mua hộ, được chia quà, chi phí được chia, đã hoàn) → *Chi tiết từng dòng*, mỗi dòng phiếu mua bấm vào xem phiếu (6A).
- **Preview mua đồ:** hiện N người, mức chia, ai nhận +1đ và câu giải thích làm tròn; tổng tự cộng khi thêm dòng; dòng DISCOUNT hiện số âm.
- **Trạng thái rỗng/lỗi/đang tải** cho mọi danh sách: chưa có đợt vote, chưa có giao dịch, quỹ chưa có thành viên (chặn form mua với hướng dẫn "Thêm thành viên quỹ trước").
- **Tên dài / số âm lớn:** cắt dòng có tooltip bấm được (không dựa hover); định dạng `−1.234.567 ₫` dùng dấu trừ thật.
- **Sửa membership:** hộp xác nhận nêu số phiếu đã post bị "lệch lịch sử" và nhắc phiếu cũ không bị tính lại.

## 8. Các giai đoạn

Ước lượng 1 dev full stack. Cột "AI hỗ trợ" là thời gian thực tế khi dùng Claude viết code, dev review/ghép.

| GĐ | Công việc | Cổng kiểm tra (phải xanh mới sang GĐ sau) | Người | AI hỗ trợ |
|---|---|---|---:|---:|
| 0 | Nhận repo + Supabase/Vercel; BA/DBA phát hành v2.3; chốt danh sách thành viên | Tài liệu v2.3 duyệt; env checklist §10 đủ | 1 ngày | 0,5 ngày |
| 1 | Scaffold Next.js, Supabase CLI local, migration `profiles` + RLS, Auth (email ảo, mật khẩu tạm, ép đổi MK, khóa TK), layout desktop/mobile, CI (lint, typecheck, pgTAP, vitest) | Login/đổi MK/khóa; member gọi route admin bị 403; CI xanh | 3–4 | 1 |
| 2 | Vote: sessions, `cast_vote`/`withdraw_vote`/`close_vote_early`, kết quả có tên | Vote trước/sau chốt; chốt đồng thời; 2 đợt/ngày | 2 | 0,5 |
| 3 | Sổ quỹ: memberships (exclusion, lý do, cảnh báo), `_allocate`, deposit/gift/reimbursement, trigger bất biến, `reverse_event`, số dư/lịch sử, tổng quỹ | pgTAP: 100/3 → 34/33/33, A/B/C, đảo & đảo-lại, bất biến sau mỗi loại | 3–4 | 1 |
| 4 | Mua đồ: `preview_purchase`/`post_purchase` (FUND/MEMBER, ITEM/FEE/DISCOUNT), UI nhiều bước mobile, danh sách phiếu cho thành viên | Ví dụ A/B/C qua UI; `MEMBERSHIP_CHANGED`; double-click không trùng | 4–5 | 1–1,5 |
| 5 | Dashboard (2 số chi, cờ rời quỹ), báo cáo kỳ, Excel import (stage → preview → commit 1 transaction) & export 6 sheet | Import lỗi 1 dòng không ghi gì; import lại bị chặn; tổng xuất khớp DB | 4–5 | 1,5 |
| 6 | Quan sát (log, cron đối soát), backup/restore thử, QA responsive 6 màn × 2 viewport, Safari thật, hướng dẫn admin, go-live | Checklist §9 hoàn tất | 3–4 | 1–1,5 |
| | **Tổng** | | **20–25 ngày** | **~7–8 ngày** |

## 9. Kiểm thử, quan sát, triển khai

### Kiểm thử
- **pgTAP (DB thật, cốt lõi):** chia 100/3; không vote vẫn bị chia; FUND/MEMBER/GIFT/DEPOSIT/REIMBURSEMENT; người mua hộ nằm trong N; người vào ngày D bị chia phiếu ngày D, người rời ngày D không bị; sửa membership không đổi ledger cũ; đảo sau khi tập thành viên đổi; đảo → đảo lại; `INVARIANT_VIOLATION` khi cố chèn dòng lệch (test trigger); UPDATE/DELETE ledger bị chặn; member không đọc được ledger người khác (RLS); 2 lệnh cùng idempotency key song song → 1 event.
- **Property test (vitest + fast-check gọi RPC):** chuỗi ngẫu nhiên 200 giao dịch + thay đổi membership → sau mỗi bước Σmember = Σcash và tổng phần chia = số tiền.
- **Integration:** import 3 dòng có 1 dòng lỗi → 0 ghi; import lại cùng file → `IMPORT_DUPLICATE_FILE`; phiên hết hạn giữa form.
- **E2E (Playwright, 1366×768 + 375×667):** admin tạo TK → member đổi MK, vote → admin nộp/mua/gift → member thấy "Cần nộp thêm" → admin xuất Excel.
- **Test "ác ý":** member gọi RPC `post_deposit` bằng anon key trực tiếp → bị từ chối; sửa `user_id` trong request "my-vote" → bị bỏ qua.

### Quan sát (bắt buộc từ GĐ 1)
- Log JSON có `request_id` cho mọi action tiền/auth/import; tắt log body chứa mật khẩu.
- `audit_events` cho: tạo/khóa TK, đặt lại MK, sửa membership, mọi post/đảo, import, export.
- **Vercel Cron hằng ngày** gọi `api.reconcile()` → ghi kết quả; lệch ≠ 0 hoặc quỹ âm → banner đỏ dashboard admin.
- Trang admin "Sức khỏe sổ": Σcash, Σmember, chênh lệch, event lệch (nếu có), lần đối soát cuối.

### Triển khai & rollback
```
Local (Supabase CLI) ─PR─▶ CI (lint, typecheck, pgTAP, vitest) ─merge─▶
  Staging: supabase db push (staging) → Vercel Preview/Staging → E2E + QA
  Prod:    backup thủ công → supabase db push (prod) → Vercel Production → smoke test
```
- **Migration luôn tương thích ngược** (chỉ thêm cột/hàm; đổi hàm = `CREATE OR REPLACE` giữ chữ ký) → code cũ vẫn chạy khi migration đã lên.
- **Rollback app:** Vercel "Promote previous deployment" (< 1 phút). **Rollback DB:** migration "down" viết tay cho từng thay đổi; dữ liệu tiền **không bao giờ** rollback bằng xóa — dùng `reverse_event`.
- **Backup:** kiểm tra gói Supabase đang dùng có backup tải về không; nếu không, GitHub Action `pg_dump` hằng đêm lưu vào nơi lưu trữ riêng tư của ngân hàng. Thử restore trên staging trước go-live.
- **Smoke test sau deploy:** login admin → `/admin/health` Σ chênh lệch = 0 → xem 1 đợt vote → xuất Excel kỳ hiện tại.
- **Go-live từ 0 (quyết định 1B):** tất toán ngoài app → seed profiles + memberships `start_date = ngày go-live` → mọi người đổi MK → giao dịch đầu tiên.

## 10. Cần MinhPQ cung cấp trước GĐ 1

- [ ] Link Git repo (GitHub/GitLab) + quyền push cho dev/Claude; nhánh chính.
- [ ] Supabase: 2 project (**staging**, **production**) — project ref, region (gợi ý Singapore để gần Vercel `sin1`), bật extension `btree_gist`, `citext`.
- [ ] Biến môi trường (đặt trên Vercel theo từng môi trường, **không commit**): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (hoặc publishable key), `SUPABASE_SERVICE_ROLE_KEY` (hoặc secret key — **chỉ server**), `CRON_SECRET`, `APP_AUTH_EMAIL_DOMAIN=coffee.internal`.
- [ ] Vercel: project đã nối repo, domain (nếu có), region function.
- [ ] Supabase Auth: tắt đăng ký công khai (disable signups), tắt xác nhận email (email ảo), đặt độ dài mật khẩu tối thiểu.
- [ ] Danh sách thành viên: mã NV, username, tên hiển thị, vai trò, ngày bắt đầu (file Excel, **không kèm mật khẩu**).

## 11. Không nằm trong phạm vi & TODO sau MVP

| Hạng mục | Lý do hoãn | Ưu tiên |
|---|---|---|
| Thành viên tự gửi chứng từ mua hộ chờ duyệt | Đã chọn 5A; làm khi admin quá tải | P3 |
| QR/VietQR chuyển khoản đúng số cần nộp | Tăng tốc thu tiền; cần kiểm tra quy định nội bộ | P3 |
| Nhắc nợ tự động (email/Zalo) | Cần kênh gửi đã duyệt | P3 |
| Số dư mở sổ | Đã chọn go-live từ 0 | — |
| Bút toán điều chỉnh / quà không chia | Đã chọn 2A | — |
| Cảnh báo hoàn tiền vượt số dư | Người dùng không chọn | — |

## 12. Danh sách công việc triển khai

- [ ] **T1 (P1, người ~2h / AI ~20′)** — DB — Migration `profiles`, `fund_memberships` (exclusion `[)` theo ngày), bật RLS deny-all. *Từ #3, #11.* Kiểm: pgTAP overlap.
- [ ] **T2 (P1, ~3h / ~30′)** — Auth — Email ảo, tạo TK sinh MK tạm, `must_change_password`, khóa TK + signOut. *Từ #11.* Kiểm: E2E login/đổi MK/khóa.
- [ ] **T3 (P1, ~4h / ~45′)** — DB — Ledger tables + trigger deferred Σmember=Σcash + chặn UPDATE/DELETE. *Từ bất biến DBA §1.* Kiểm: pgTAP chèn lệch → lỗi.
- [ ] **T4 (P1, ~3h / ~30′)** — DB — `_allocate` + `post_deposit/gift/reimbursement` + `idempotency_key`. *Từ #2, #10.* Kiểm: 100/3, A/B/C, gọi song song.
- [ ] **T5 (P1, ~3h / ~30′)** — DB — `reverse_event` giữ entry_type gốc, `reverses_entry_id`, cho đảo-lại. *Từ #9, #13c.* Kiểm: chuỗi gốc→đảo→đảo lại.
- [ ] **T6 (P1, ~6h / ~1h)** — Mua đồ — `preview_purchase`/`post_purchase` với `preview_hash`, ITEM/FEE/DISCOUNT, tổng tự tính. *Từ #8, DEV §3.* Kiểm: `MEMBERSHIP_CHANGED`.
- [ ] **T7 (P1, ~3h / ~30′)** — Vote — trạng thái suy ra theo giờ, khóa chốt sớm, kết quả có tên. *Từ #7, #13a.* Kiểm: vote tại đúng `cutoff_at`.
- [ ] **T8 (P1, ~4h / ~45′)** — Membership UI — lý do bắt buộc, cảnh báo N phiếu lệch, đóng membership hiện số dư + gợi ý tất toán. *Từ #3′, #4.*
- [ ] **T9 (P1, ~6h / ~1,5h)** — Excel — stage/preview/commit nguyên khối, chống trùng file/`external_ref`, `IMPORT_STALE`. *Từ BR-08.*
- [ ] **T10 (P1, ~3h / ~30′)** — Quan sát — log JSON `request_id`, `audit_events`, cron đối soát + `/admin/health`. *Từ Prime Directive #1.*
- [ ] **T11 (P2, ~4h / ~1h)** — Dashboard 2 số chi + cờ rời quỹ chưa tất toán; trang "Số dư của tôi" 3 tầng; danh sách phiếu cho thành viên. *Từ #4, #6, #12.*
- [ ] **T12 (P2, ~2h / ~30′)** — Chặn ngày tương lai ở mọi hàm post. *Từ #13b.*
- [ ] **T13 (P2, ~3h / ~1h)** — Property test 200 giao dịch ngẫu nhiên. *Từ Mục Test.*
- [ ] **T14 (P2, ~2h / ~30′)** — Backup đêm + thử restore staging. *Từ Triển khai.*

## 13. Quyết định còn mở

- Danh sách thành viên và ngày go-live (dữ liệu, cần trước seed).
- Link repo, cấu hình Vercel + Supabase (§10).
- BA/DBA phát hành v2.3 theo `v2_CoffeeTDT_Review_BA_DBA.md` §4.
