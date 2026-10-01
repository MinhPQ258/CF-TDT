-- ============================================================================
-- Coffee TDT — NÂNG CẤP DB production từ migration 17 lên 18: phân quyền RBAC (vai trò, gán vai trò, nhật ký)
-- CHẠY SAU upgrade_017_avatar.sql. Chạy TRƯỚC khi deploy code mới: Supabase SQL Editor → dán → Run.
-- Một transaction, chạy lại được. Mọi ADMIN hiện có được gán vai trò hệ thống "Quản trị viên" (đủ quyền).
-- Nội dung = nguyên văn supabase/migrations/20260930000018_rbac.sql.
-- ============================================================================

begin;
-- 000018: Phân quyền RBAC — vai trò (nhóm quyền) do admin tự tạo, gán nhiều vai trò cho một người, nhật ký hành động.
--
-- Quyền cố định (mã → màn hình):
--   votes.manage      Quản lý đợt pha (tạo nháp, sửa, chốt sớm, hủy, lựa chọn)
--   fund.manage       Sổ quỹ (nộp quỹ, tiền cho thêm, hoàn tiền, đảo giao dịch)
--   purchases.manage  Phiếu mua
--   reports.view      Tổng quan quỹ, báo cáo, sức khỏe sổ, đối soát
--   excel.manage      Nhập / xuất Excel
--   users.manage      Người dùng, vai trò, nhật ký
--
-- Kiểm tra quyền NẰM TRONG DB: private.require_admin() (mọi RPC quản trị đều gọi) đọc tên RPC đang chạy
-- từ ngăn xếp PG_CONTEXT rồi đối chiếu bảng quyền bên dưới — không phải viết lại từng RPC.
-- profiles.role vẫn giữ (ADMIN = có ít nhất 1 quyền) để code cũ / giao diện dùng tiếp; tự đồng bộ theo vai trò.

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 60),
  description text null check (description is null or length(description) <= 300),
  permissions text[] not null default '{}',
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists roles_name_uq on public.roles (lower(name));

create table if not exists public.user_roles (
  user_id uuid not null references public.profiles (id) on delete cascade,
  role_id uuid not null references public.roles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, role_id)
);
create index if not exists user_roles_role_idx on public.user_roles (role_id);

alter table public.roles enable row level security;
alter table public.user_roles enable row level security;
revoke all on public.roles, public.user_roles from anon, authenticated;

-- ───────────────────────── Danh mục quyền ─────────────────────────
create or replace function private.all_permissions()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['votes.manage', 'fund.manage', 'purchases.manage', 'reports.view', 'excel.manage', 'users.manage'];
$$;

create or replace function private.user_permissions(p_user uuid)
returns text[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(distinct x order by x), '{}')
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  cross join lateral unnest(r.permissions) x
  where ur.user_id = p_user;
$$;

-- Quyền cần cho từng RPC quản trị (có một trong các quyền là đủ). null = có bất kỳ quyền quản trị nào.
-- RPC quản trị mới chưa khai báo ở đây mặc định cần users.manage (an toàn).
create or replace function private.rpc_required_permissions(p_fn text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case
    when p_fn in ('admin_add_vote_option', 'admin_cancel_vote_session', 'admin_create_vote_session', 'admin_publish_vote_session',
                  'admin_set_vote_cutoff', 'admin_set_vote_option_hidden', 'admin_update_vote_session', 'admin_vote_templates',
                  'close_vote_early') then array['votes.manage']
    when p_fn in ('post_deposit', 'post_gift', 'post_reimbursement', 'preview_gift') then array['fund.manage']
    when p_fn in ('post_purchase', 'preview_purchase') then array['purchases.manage']
    when p_fn in ('reverse_event', 'admin_list_events') then array['fund.manage', 'purchases.manage']
    when p_fn = 'admin_event_detail' then array['fund.manage', 'purchases.manage', 'reports.view']
    when p_fn in ('admin_overview', 'admin_member_balances', 'admin_member_statement', 'admin_health', 'reconcile') then array['reports.view']
    when p_fn in ('admin_export_data', 'import_commit', 'import_discard', 'import_list_jobs', 'import_preview', 'import_stage') then array['excel.manage']
    -- danh sách người dùng: màn nộp quỹ / phiếu mua cũng cần chọn người
    when p_fn = 'admin_list_users' then null
    else array['users.manage']
  end;
$$;

-- Thay bản 000003: thay vì role = 'ADMIN', kiểm tra quyền theo RPC đang gọi
create or replace function private.require_admin()
returns public.profiles
language plpgsql
stable
set search_path = ''
as $$
declare
  v public.profiles := private.require_user();
  v_have text[] := private.user_permissions(v.id);
  v_ctx text;
  v_fn text;
  v_need text[];
begin
  if cardinality(v_have) = 0 then
    perform private.raise_err('INSUFFICIENT_PERMISSION', 'cần quyền quản trị');
  end if;
  -- RPC ngoài cùng (api.*) trong ngăn xếp gọi hàm
  get diagnostics v_ctx = pg_context;
  select (array_agg(m[1]))[count(*)] into v_fn
  from regexp_matches(v_ctx, 'function api\.([a-z0-9_]+)\(', 'g') as m;
  if v_fn is null then
    return v; -- gọi trực tiếp (SQL Editor / nội bộ), không qua RPC
  end if;
  v_need := private.rpc_required_permissions(v_fn);
  if v_need is not null and not (v_have && v_need) then
    perform private.raise_err('INSUFFICIENT_PERMISSION', 'cần quyền ' || array_to_string(v_need, ' hoặc '));
  end if;
  return v;
end;
$$;

-- ───────────────────────── Đồng bộ profiles.role ─────────────────────────
create or replace function private.sync_profile_role(p_user uuid)
returns void
language sql
set search_path = ''
as $$
  update public.profiles
  set role = case when cardinality(private.user_permissions(p_user)) > 0 then 'ADMIN' else 'MEMBER' end::public.user_role
  where id = p_user
    and role is distinct from (case when cardinality(private.user_permissions(p_user)) > 0 then 'ADMIN' else 'MEMBER' end)::public.user_role;
$$;

create or replace function private.trg_user_roles_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.sync_profile_role(case when tg_op = 'DELETE' then old.user_id else new.user_id end);
  return null;
end;
$$;

drop trigger if exists user_roles_sync on public.user_roles;
create trigger user_roles_sync after insert or delete on public.user_roles
  for each row execute function private.trg_user_roles_sync();

create or replace function private.trg_roles_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.sync_profile_role(ur.user_id) from public.user_roles ur where ur.role_id = new.id;
  return null;
end;
$$;

drop trigger if exists roles_sync on public.roles;
create trigger roles_sync after update of permissions on public.roles
  for each row execute function private.trg_roles_sync();

-- Ghi trực tiếp profiles.role (tạo TK vai trò ADMIN, import Excel, admin_set_user_role cũ) → gán / gỡ vai trò hệ thống.
-- Bỏ qua khi chính trigger đồng bộ ở trên cập nhật (pg_trigger_depth() > 1) để không lặp.
create or replace function private.trg_profile_role_legacy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sys uuid := (select id from public.roles where is_system order by created_at limit 1);
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  if new.role = 'ADMIN' and cardinality(private.user_permissions(new.id)) = 0 and v_sys is not null then
    insert into public.user_roles (user_id, role_id) values (new.id, v_sys) on conflict do nothing;
  elsif new.role = 'MEMBER' and tg_op = 'UPDATE' and old.role = 'ADMIN' then
    delete from public.user_roles where user_id = new.id;
  end if;
  return null;
end;
$$;

drop trigger if exists profiles_role_legacy on public.profiles;
create trigger profiles_role_legacy after insert or update of role on public.profiles
  for each row execute function private.trg_profile_role_legacy();

-- Vai trò hệ thống "Quản trị viên" (đủ quyền, không xoá / không bớt quyền) + gán cho mọi ADMIN hiện có
insert into public.roles (name, description, permissions, is_system)
select 'Quản trị viên', 'Toàn quyền quản trị (vai trò hệ thống, không xoá được)', private.all_permissions(), true
where not exists (select 1 from public.roles where is_system);

insert into public.user_roles (user_id, role_id)
select p.id, r.id from public.profiles p cross join (select id from public.roles where is_system order by created_at limit 1) r
-- chỉ ADMIN cũ chưa có vai trò nào (chạy lại file không nâng người đã được phân vai trò hẹp lên toàn quyền)
where p.role = 'ADMIN' and not exists (select 1 from public.user_roles x where x.user_id = p.id)
on conflict do nothing;

-- Không để hệ thống mất người quản trị người dùng
create or replace function private.assert_user_admin_exists()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p where p.status = 'ACTIVE' and 'users.manage' = any (private.user_permissions(p.id))) then
    perform private.raise_err('INVALID_INPUT', 'Phải còn ít nhất 1 người đang hoạt động có quyền Quản trị người dùng');
  end if;
end;
$$;

-- ───────────────────────── Nhật ký: vote + đăng nhập ─────────────────────────
create or replace function private.trg_votes_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := coalesce(auth.uid(), new.voted_by, new.user_id);
begin
  if tg_op = 'UPDATE' and old.is_withdrawn = new.is_withdrawn and old.choice = new.choice
     and old.style_option_id is not distinct from new.style_option_id and old.cups is not distinct from new.cups
     and old.voted_by is not distinct from new.voted_by and old.coffee_type is not distinct from new.coffee_type then
    return null; -- không đổi gì đáng ghi (đồ đi kèm ghi ở bảng riêng)
  end if;
  insert into public.audit_events (actor_user_id, action, entity_type, entity_id, after)
  values (v_actor,
    case when new.is_withdrawn then case when new.user_id = v_actor then 'vote.withdraw' else 'vote.withdraw_for' end
         when new.user_id = v_actor then 'vote.cast' else 'vote.cast_for' end,
    'vote_session', new.vote_session_id::text,
    jsonb_build_object(
      'session', (select s.name from public.vote_sessions s where s.id = new.vote_session_id),
      'for', case when new.user_id <> v_actor then (select p.display_name from public.profiles p where p.id = new.user_id) end,
      'choice', new.choice, 'style', private.vote_style_label(new), 'cups', new.cups));
  return null;
end;
$$;

drop trigger if exists votes_audit on public.votes;
create trigger votes_audit after insert or update on public.votes
  for each row execute function private.trg_votes_audit();

create or replace function api.log_login()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.profiles := private.require_user(true);
begin
  perform private.audit(v.id, 'auth.login', 'profile', v.id::text);
end;
$$;

-- ───────────────────────── api.me: thêm permissions (bản 000017 + 1 trường) ─────────────────────────
create or replace function api.me()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v public.profiles;
begin
  if v_uid is null then
    return null;
  end if;
  select * into v from public.profiles where id = v_uid;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'id', v.id, 'employee_code', v.employee_code, 'username', v.username::text,
    'display_name', v.display_name, 'role', v.role, 'status', v.status,
    'must_change_password', v.must_change_password,
    'is_member_today', v.id = any (private.members_on(private.vn_today())),
    'avatar', v.avatar,
    'permissions', to_jsonb(private.user_permissions(v.id))
  );
end;
$$;

-- Danh sách người dùng: thêm avatar (bản 000005 + 1 trường)
create or replace function api.admin_list_users()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := private.vn_today();
begin
  perform private.require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'employee_code', p.employee_code, 'username', p.username::text,
      'display_name', p.display_name, 'role', p.role, 'status', p.status,
      'must_change_password', p.must_change_password, 'created_at', p.created_at,
      'balance_vnd', private.balance_of(p.id),
      'avatar', p.avatar,
      'current_membership', (
        select jsonb_build_object('id', m.id, 'start_date', m.start_date, 'end_date', m.end_date)
        from public.fund_memberships m
        where m.user_id = p.id and m.start_date <= v_today and (m.end_date is null or v_today < m.end_date)
      )
    ) order by p.employee_code, p.id)
    from public.profiles p
  ), '[]'::jsonb);
end;
$$;

-- ───────────────────────── Vai trò ─────────────────────────
create or replace function private.role_json(r public.roles)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('id', r.id, 'name', r.name, 'description', r.description,
    'permissions', to_jsonb(r.permissions), 'is_system', r.is_system,
    'users', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'display_name', p.display_name, 'username', p.username::text)
        order by p.display_name)
      from public.user_roles ur join public.profiles p on p.id = ur.user_id where ur.role_id = r.id), '[]'::jsonb));
$$;

create or replace function api.admin_list_roles()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return coalesce((select jsonb_agg(private.role_json(r) order by r.is_system desc, lower(r.name)) from public.roles r), '[]'::jsonb);
end;
$$;

-- Tạo (p_role_id null) hoặc sửa vai trò
create or replace function api.admin_save_role(p_role_id uuid, p_name text, p_description text, p_permissions text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
  v_name text := private.clean_text(p_name);
  v_desc text := private.clean_text(p_description);
  v_perms text[];
  r public.roles;
  v_before jsonb;
begin
  if v_name is null or length(v_name) > 60 then
    perform private.raise_err('INVALID_INPUT', 'Tên vai trò 1–60 ký tự');
  end if;
  if v_desc is not null and length(v_desc) > 300 then
    perform private.raise_err('INVALID_INPUT', 'Mô tả tối đa 300 ký tự');
  end if;
  select coalesce(array_agg(distinct x order by x), '{}') into v_perms from unnest(coalesce(p_permissions, '{}')) x;
  if not (v_perms <@ private.all_permissions()) then
    perform private.raise_err('INVALID_INPUT', 'Quyền không hợp lệ');
  end if;
  if exists (select 1 from public.roles where lower(name) = lower(v_name) and id is distinct from p_role_id) then
    perform private.raise_err('DUPLICATE_REFERENCE', 'Tên vai trò đã có');
  end if;

  if p_role_id is null then
    insert into public.roles (name, description, permissions) values (v_name, v_desc, v_perms) returning * into r;
    perform private.audit(v_admin.id, 'role.create', 'role', r.id::text, null,
      jsonb_build_object('name', r.name, 'permissions', r.permissions));
  else
    select * into r from public.roles where id = p_role_id for update;
    if not found then
      perform private.raise_err('INVALID_INPUT', 'Không tìm thấy vai trò');
    end if;
    if r.is_system and not (private.all_permissions() <@ v_perms) then
      perform private.raise_err('INVALID_INPUT', 'Vai trò hệ thống luôn đủ quyền');
    end if;
    v_before := jsonb_build_object('name', r.name, 'description', r.description, 'permissions', r.permissions);
    update public.roles set name = v_name, description = v_desc, permissions = v_perms, updated_at = now()
    where id = r.id returning * into r;
    perform private.audit(v_admin.id, 'role.update', 'role', r.id::text, v_before,
      jsonb_build_object('name', r.name, 'description', r.description, 'permissions', r.permissions));
  end if;
  perform private.assert_user_admin_exists();
  return private.role_json(r);
end;
$$;

create or replace function api.admin_delete_role(p_role_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
  r public.roles;
begin
  select * into r from public.roles where id = p_role_id for update;
  if not found then
    perform private.raise_err('INVALID_INPUT', 'Không tìm thấy vai trò');
  end if;
  if r.is_system then
    perform private.raise_err('INVALID_INPUT', 'Không xoá được vai trò hệ thống');
  end if;
  delete from public.roles where id = r.id;
  perform private.audit(v_admin.id, 'role.delete', 'role', r.id::text,
    jsonb_build_object('name', r.name, 'permissions', r.permissions), null);
  perform private.assert_user_admin_exists();
end;
$$;

-- Gán danh sách vai trò cho một người (thay toàn bộ)
create or replace function api.admin_set_user_roles(p_user_id uuid, p_role_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
  t public.profiles;
  v_ids uuid[];
  v_before jsonb;
  v_after jsonb;
begin
  select * into t from public.profiles where id = p_user_id;
  if not found then
    perform private.raise_err('INVALID_INPUT', 'Không tìm thấy tài khoản');
  end if;
  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(coalesce(p_role_ids, '{}')) x;
  if (select count(*) from public.roles where id = any (v_ids)) <> cardinality(v_ids) then
    perform private.raise_err('INVALID_INPUT', 'Vai trò không hợp lệ');
  end if;
  select coalesce(jsonb_agg(r.name order by r.name), '[]') into v_before
  from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = t.id;

  delete from public.user_roles where user_id = t.id and not (role_id = any (v_ids));
  insert into public.user_roles (user_id, role_id) select t.id, x from unnest(v_ids) x on conflict do nothing;

  select coalesce(jsonb_agg(r.name order by r.name), '[]') into v_after
  from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = t.id;
  if v_before is distinct from v_after then
    perform private.audit(v_admin.id, 'user.roles', 'profile', t.id::text,
      jsonb_build_object('roles', v_before), jsonb_build_object('roles', v_after, 'user', t.display_name));
  end if;
  perform private.assert_user_admin_exists();
  return jsonb_build_object('user_id', t.id, 'roles', v_after, 'permissions', to_jsonb(private.user_permissions(t.id)));
end;
$$;

-- ───────────────────────── Nhật ký hành động ─────────────────────────
create or replace function api.admin_list_audit(
  p_actor uuid default null, p_from date default null, p_to date default null, p_action text default null,
  p_limit int default 50, p_offset int default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
begin
  perform private.require_admin();
  return (
    with f as (
      select a.*
      from public.audit_events a
      where (p_actor is null or a.actor_user_id = p_actor)
        and (p_from is null or (a.occurred_at at time zone 'Asia/Ho_Chi_Minh')::date >= p_from)
        and (p_to is null or (a.occurred_at at time zone 'Asia/Ho_Chi_Minh')::date <= p_to)
        and (p_action is null or a.action like p_action || '%')
    )
    select jsonb_build_object(
      'total', (select count(*) from f),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', x.id, 'occurred_at', x.occurred_at, 'action', x.action, 'entity_type', x.entity_type, 'entity_id', x.entity_id,
          'before', x.before, 'after', x.after, 'reason', x.reason,
          'actor', case when x.actor_user_id is null then null else jsonb_build_object(
            'id', ap.id, 'display_name', ap.display_name, 'username', ap.username::text) end,
          'target', case when x.entity_type = 'profile' and tp.id is not null and tp.id is distinct from x.actor_user_id
            then jsonb_build_object('display_name', tp.display_name, 'username', tp.username::text) end,
          -- người liên quan trong giao dịch quỹ (người nộp / nhận hoàn / mua hộ)
          'subject', sp.display_name
        ) order by x.occurred_at desc, x.id desc)
        from (select * from f order by occurred_at desc, id desc limit v_limit offset v_offset) x
        left join public.profiles ap on ap.id = x.actor_user_id
        left join public.profiles tp on x.entity_type = 'profile'
          and x.entity_id ~ '^[0-9a-f-]{36}$' and tp.id = x.entity_id::uuid
        left join public.profiles sp on coalesce(x.after ->> 'user_id', x.after ->> 'payer_user_id') ~ '^[0-9a-f-]{36}$'
          and sp.id = coalesce(x.after ->> 'user_id', x.after ->> 'payer_user_id')::uuid
      ), '[]'::jsonb)
    )
  );
end;
$$;

grant execute on function api.log_login() to authenticated;
grant execute on function api.admin_list_roles() to authenticated;
grant execute on function api.admin_save_role(uuid, text, text, text[]) to authenticated;
grant execute on function api.admin_delete_role(uuid) to authenticated;
grant execute on function api.admin_set_user_roles(uuid, uuid[]) to authenticated;
grant execute on function api.admin_list_audit(uuid, date, date, text, int, int) to authenticated;

revoke all on function private.all_permissions(), private.user_permissions(uuid), private.rpc_required_permissions(text),
  private.sync_profile_role(uuid), private.assert_user_admin_exists(), private.role_json(public.roles)
  from public, anon, authenticated;


commit;

notify pgrst, 'reload schema';

-- Kiểm tra: các dòng đều true; danh sách vai trò + người đang có vai trò hệ thống
select 'bảng roles / user_roles' as muc, to_regclass('public.roles') is not null and to_regclass('public.user_roles') is not null as co
union all select 'api.admin_set_user_roles', to_regprocedure('api.admin_set_user_roles(uuid,uuid[])') is not null
union all select 'api.admin_list_audit', to_regprocedure('api.admin_list_audit(uuid,date,date,text,integer,integer)') is not null
union all select 'có người quản trị người dùng', exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id where 'users.manage' = any (r.permissions));
