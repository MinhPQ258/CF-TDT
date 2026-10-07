-- ============================================================================
-- Coffee TDT — NÂNG CẤP DB production lên migration 20: sửa lỗi "không có quyền" khi ghi sổ quỹ
-- (permission denied for schema private lúc COMMIT). Chạy ngay được, không cần deploy code.
-- Một transaction, chạy lại được. Nội dung = nguyên văn supabase/migrations/20261007000020_deferred_trigger_definer.sql.
-- ============================================================================

begin;
-- 000020: Sửa lỗi "permission denied for schema private" khi ghi sổ quỹ trên production.
-- Trigger kiểm bất biến Σmember = Σcash là trigger HOÃN (chạy lúc COMMIT). Trên Postgres < 18 (Supabase),
-- trigger hoãn chạy dưới vai trò đang đăng nhập (authenticated) — vai trò này không được dùng schema private.
-- Cho hàm trigger chạy với quyền chủ sở hữu, như các hàm api.*. Không đổi logic.

alter function private.check_event_balance_trg() security definer;
alter function private.check_event_balance(uuid) security definer;
revoke all on function private.check_event_balance_trg(), private.check_event_balance(uuid) from public, anon, authenticated;

commit;

-- Kiểm tra: mọi hàm của trigger hoãn phải là security definer (cột la_definer = true)
select t.tgname as trigger_hoan, p.oid::regprocedure as ham, p.prosecdef as la_definer
from pg_trigger t join pg_proc p on p.oid = t.tgfoid
where t.tgdeferrable and not t.tgisinternal;
