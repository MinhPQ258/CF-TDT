-- CHỈ dữ liệu mẫu cho dev/staging (supabase db reset). KHÔNG chạy trên production.
-- Tài khoản: admin / anh / binh / chi — mật khẩu tạm "Coffee@123" (bắt đổi khi đăng nhập).

create extension if not exists pgcrypto with schema extensions;

do $$
declare
  v_ids uuid[] := array['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002',
                        '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000004']::uuid[];
  v_users text[] := array['admin', 'anh', 'binh', 'chi'];
  v_names text[] := array['Quản trị quỹ', 'Nguyễn Văn Anh', 'Trần Thị Bình', 'Lê Minh Chi'];
  i int;
begin
  for i in 1..4 loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new)
    values ('00000000-0000-0000-0000-000000000000', v_ids[i], 'authenticated', 'authenticated',
      v_users[i] || '@coffee.internal', extensions.crypt('Coffee@123', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', jsonb_build_object('username', v_users[i]), now(), now(), '', '', '', '')
    on conflict (id) do nothing;
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at)
    values (gen_random_uuid(), v_ids[i], v_ids[i]::text,
      jsonb_build_object('sub', v_ids[i]::text, 'email', v_users[i] || '@coffee.internal'), 'email', now(), now(), now())
    on conflict do nothing;
    insert into public.profiles (id, employee_code, username, display_name, role, must_change_password)
    values (v_ids[i], 'NV00' || i, v_users[i], v_names[i], case when i = 1 then 'ADMIN' else 'MEMBER' end::public.user_role, true)
    on conflict (id) do nothing;
  end loop;

  -- 3 thành viên quỹ từ đầu tháng
  insert into public.fund_memberships (user_id, start_date, reason, created_by, updated_by)
  select id, date_trunc('month', now() at time zone 'Asia/Ho_Chi_Minh')::date, 'Seed dev', v_ids[1], v_ids[1]
  from public.profiles where username in ('anh', 'binh', 'chi')
  on conflict do nothing;
end;
$$;
