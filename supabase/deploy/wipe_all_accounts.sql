-- ============================================================================
-- Coffee TDT — XOÁ SẠCH toàn bộ tài khoản + mọi dữ liệu nghiệp vụ trên DB (KHÔNG HOÀN TÁC ĐƯỢC)
--
-- Xoá: tài khoản đăng nhập (auth.users + identities/sessions), hồ sơ, đợt vote, phiếu vote, lựa chọn,
--      sổ quỹ (fund_events, member_ledger, cash_ledger), phiếu mua, import Excel, đối soát, nhật ký audit,
--      thành viên quỹ (dữ liệu cũ).
-- Giữ:  cấu trúc DB, hàm api/private, lịch sử migration (không cần chạy lại migration).
--
-- Cách chạy (Supabase Dashboard → SQL Editor):
--   0. NÊN sao lưu trước: Dashboard → Database → Backups, hoặc Excel → Xuất dữ liệu trong app.
--   1. Sửa dòng v_confirm bên dưới thành đúng: 'XOA TAT CA'
--   2. Run. Cả script chạy trong 1 giao dịch: lỗi ở đâu thì không xoá gì.
--   3. Chạy tiếp create_admin_minhpq.sql để có tài khoản đăng nhập.
-- ============================================================================

do $$
declare
  v_confirm text := 'CHUA_XAC_NHAN';   -- ← sửa thành 'XOA TAT CA' để chạy
  v_users int;
begin
  if v_confirm <> 'XOA TAT CA' then
    raise exception 'Chưa xác nhận: sửa v_confirm thành ''XOA TAT CA'' rồi chạy lại. Không có gì bị xoá.';
  end if;

  select count(*) into v_users from auth.users;

  -- TRUNCATE bỏ qua trigger chặn sửa/xoá sổ (sổ chỉ ghi thêm) và các ràng buộc hoãn; CASCADE theo khoá ngoại
  truncate table
    public.vote_addons, public.votes, public.vote_session_options, public.vote_sessions,
    public.purchase_items, public.purchases,
    public.member_ledger, public.cash_ledger, public.fund_events,
    public.import_rows, public.import_jobs,
    public.reconciliation_runs, public.audit_events,
    public.fund_memberships, public.profiles
  restart identity cascade;

  -- Tài khoản đăng nhập (Supabase tự xoá identities, sessions, refresh tokens theo khoá ngoại)
  delete from auth.users;

  raise notice 'Đã xoá % tài khoản đăng nhập và toàn bộ dữ liệu nghiệp vụ.', v_users;
end;
$$;

-- Kiểm tra: tất cả phải = 0
select
  (select count(*) from auth.users) as auth_users,
  (select count(*) from public.profiles) as profiles,
  (select count(*) from public.vote_sessions) as vote_sessions,
  (select count(*) from public.fund_events) as fund_events,
  (select count(*) from public.member_ledger) as member_ledger,
  (select count(*) from public.cash_ledger) as cash_ledger,
  (select count(*) from public.purchases) as purchases,
  (select count(*) from public.audit_events) as audit_events;
