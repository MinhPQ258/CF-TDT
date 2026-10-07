-- ============================================================================
-- Chẩn đoán lỗi "không có quyền" khi thủ quỹ ghi tiền vào (Supabase SQL Editor → dán → Run)
-- Chỉ đọc; bước 3 thử ghi 1.000 ₫ rồi ROLLBACK, không lưu gì. Gửi lại kết quả cả 3 bảng.
-- ============================================================================

-- 1) Tài khoản thủ quỹ và người được ghi tiền
select username, role, status, array_to_string(private.user_permissions(id), ', ') as quyen
from public.profiles
where username = 'thuongntt' or id = 'b3f1d7bd-89bb-4b50-bfd5-f59ccb2ff5f2';

-- 2) Các hàm liên quan: có phải security definer, ai sở hữu, vai trò authenticated có được gọi không
select p.oid::regprocedure as ham, p.prosecdef as security_definer, pg_get_userbyid(p.proowner) as owner,
  has_function_privilege('authenticated', p.oid, 'execute') as authenticated_goi_duoc
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where (n.nspname = 'api' and p.proname in ('post_deposit', 'me'))
   or (n.nspname = 'private' and p.proname in ('require_admin', 'user_permissions', 'rpc_required_permissions'));

-- 3) Thử ghi 1.000 ₫ như thủ quỹ rồi HUỶ (rollback, không lưu gì)
begin;
create temp table _t (k text, v text) on commit drop;
grant all on _t to public;
do $$
declare
  v_id uuid := (select id from public.profiles where username = 'thuongntt');
  s text; m text; d text; c text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_id, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform api.post_deposit(p_idem_key => gen_random_uuid(), p_user_id => 'b3f1d7bd-89bb-4b50-bfd5-f59ccb2ff5f2'::uuid,
      p_amount_vnd => 1000, p_occurred_on => (now() at time zone 'Asia/Ho_Chi_Minh')::date, p_external_ref => null, p_note => 'chan doan');
    insert into _t values ('post_deposit', 'OK');
  exception when others then
    get stacked diagnostics s = returned_sqlstate, m = message_text, d = pg_exception_detail, c = pg_exception_context;
    insert into _t values ('sqlstate', s), ('message', m), ('detail', d), ('context', c);
  end;
end;
$$;
reset role;
select * from _t;
rollback;
