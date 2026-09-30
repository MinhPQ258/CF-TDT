-- ============================================================================
-- Coffee TDT — Tạo nhiều tài khoản trên production bằng SQL (Supabase SQL Editor)
--
-- 1. Sửa danh sách trong "input" (mỗi dòng 1 người). fund_start = ngày vào quỹ, để null nếu không thuộc quỹ.
--    username: 3–32 ký tự a-z 0-9 . _ -   ·   role: 'MEMBER' hoặc 'ADMIN'
-- 2. Sửa v_domain nếu APP_AUTH_EMAIL_DOMAIN trên Vercel khác 'cf.tdt', và v_admin = username admin đang dùng.
-- 3. Run. Mọi tài khoản mới dùng mật khẩu mặc định 123456 (đổi v_password nếu muốn), không bắt đổi mật khẩu.
--    Người đã có (trùng username / mã NV / email) tự bỏ qua, chạy lại không tạo trùng.
--
-- Cách khác không cần SQL: trong app → Excel → mẫu "Thành viên quỹ" (tạo tài khoản + membership, hiện mật khẩu tạm).
-- ============================================================================

with params as (
  select 'cf.tdt'::text as v_domain, 'minhpq'::text as v_admin, '123456'::text as v_password
),
input (employee_code, username, display_name, role, fund_start) as (
  values
    ('NV002', 'binh',  'Trần Thị Bình',  'MEMBER', date '2026-10-01'),
    ('NV003', 'chi',   'Lê Minh Chi',    'MEMBER', date '2026-10-01'),
    ('NV004', 'hoa',   'Đỗ Thị Hoa',     'MEMBER', null::date)
),
prepared as materialized (
  select
    gen_random_uuid() as id,
    btrim(i.employee_code) as employee_code,
    lower(btrim(i.username)) as username,
    btrim(i.display_name) as display_name,
    upper(i.role)::public.user_role as role,
    i.fund_start,
    lower(btrim(i.username)) || '@' || p.v_domain as email,
    p.v_password as temp_password
  from input i cross join params p
  where not exists (select 1 from public.profiles x where x.username = lower(btrim(i.username)) or x.employee_code = btrim(i.employee_code))
    and not exists (select 1 from auth.users u where lower(u.email) = lower(btrim(i.username)) || '@' || p.v_domain)
),
admin as (
  select x.id from public.profiles x, params p where x.username = p.v_admin and x.role = 'ADMIN'
),
new_auth as (
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new)
  select '00000000-0000-0000-0000-000000000000', pr.id, 'authenticated', 'authenticated', pr.email,
    extensions.crypt(pr.temp_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('username', pr.username, 'display_name', pr.display_name), now(), now(), '', '', '', ''
  from prepared pr
  returning id
),
new_identity as (
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at)
  select gen_random_uuid(), pr.id, pr.id::text,
    jsonb_build_object('sub', pr.id::text, 'email', pr.email, 'email_verified', true), 'email', now(), now(), now()
  from prepared pr
  returning user_id
),
new_profile as (
  insert into public.profiles (id, employee_code, username, display_name, role, status, must_change_password)
  select pr.id, pr.employee_code, pr.username, pr.display_name, pr.role, 'ACTIVE', false
  from prepared pr
  returning id
),
new_membership as (
  insert into public.fund_memberships (user_id, start_date, reason, created_by, updated_by)
  select pr.id, pr.fund_start, 'Tạo bằng insert_users.sql', a.id, a.id
  from prepared pr cross join admin a
  where pr.fund_start is not null
  returning user_id
),
audit as (
  insert into public.audit_events (actor_user_id, action, entity_type, entity_id, after, reason)
  select (select id from admin), 'user.create', 'profile', pr.id::text,
    jsonb_build_object('employee_code', pr.employee_code, 'username', pr.username, 'role', pr.role, 'fund_start', pr.fund_start),
    'insert_users.sql'
  from prepared pr
  returning id
)
select pr.employee_code, pr.username, pr.display_name, pr.role, pr.fund_start,
       pr.temp_password,
       case when pr.fund_start is not null and not exists (select 1 from admin) then 'CHƯA vào quỹ: không tìm thấy admin ' || (select v_admin from params) else 'ok' end as note
from prepared pr
order by pr.employee_code;
