-- ============================================================================
-- Coffee TDT — NÂNG CẤP DB production lên migration 21: Trực nhật (vòng quay)
-- Chạy TRƯỚC khi deploy code mới: Supabase SQL Editor → dán → Run. Một transaction, chạy lại được.
-- Thêm quyền "duty.manage" (vai trò hệ thống Quản trị viên tự có); danh sách ban đầu = mọi tài khoản đang hoạt động.
-- Nội dung = nguyên văn supabase/migrations/20261022000021_duty_wheel.sql.
-- ============================================================================

begin;
-- 000021: Trực nhật — vòng quay chọn người trực nhật.
-- Quyền mới duty.manage (gán sẵn cho vai trò hệ thống "Quản trị viên"): quay, sửa danh sách.
-- Mọi người khác chỉ xem lịch sử quay. Người trúng do SERVER chọn (random()); giao diện chỉ quay tới đúng ô đó.

create table if not exists public.duty_members (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 60),
  user_id uuid null references public.profiles (id) on delete set null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists duty_members_name_uq on public.duty_members (lower(name));

create table if not exists public.duty_spins (
  id bigint generated always as identity primary key,
  name text not null,
  user_id uuid null references public.profiles (id) on delete set null,
  spun_at timestamptz not null default now(),
  spun_by uuid null references public.profiles (id) on delete set null
);
create index if not exists duty_spins_at_idx on public.duty_spins (spun_at desc);

alter table public.duty_members enable row level security;
alter table public.duty_spins enable row level security;
revoke all on public.duty_members, public.duty_spins from anon, authenticated;

-- ───────────────────────── Quyền ─────────────────────────
create or replace function private.all_permissions()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['votes.manage', 'fund.manage', 'purchases.manage', 'reports.view', 'excel.manage', 'users.manage', 'duty.manage'];
$$;

-- Bản 000018 + nhóm admin_duty_* → duty.manage
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
    when p_fn like 'admin\_duty\_%' then array['duty.manage']
    -- danh sách người dùng: màn nộp quỹ / phiếu mua cũng cần chọn người
    when p_fn = 'admin_list_users' then null
    else array['users.manage']
  end;
$$;

-- Vai trò hệ thống luôn đủ quyền → thêm duty.manage
update public.roles set permissions = private.all_permissions(), updated_at = now()
where is_system and not (private.all_permissions() <@ permissions);

-- Nạp danh sách = mọi tài khoản đang hoạt động. Trùng tên hiển thị → "Tên (mã NV)" để không ai bị bỏ sót.
create or replace function private.duty_load_active()
returns void
language sql
set search_path = ''
as $$
  insert into public.duty_members (name, user_id, sort_order)
  select case when count(*) over (partition by lower(p.display_name)) > 1
              then p.display_name || ' (' || p.employee_code || ')' else p.display_name end,
         p.id, row_number() over (order by p.employee_code, p.id)
  from public.profiles p
  where p.status = 'ACTIVE'
  on conflict do nothing;
$$;

-- Danh sách ban đầu (chỉ khi đang trống)
do $$
begin
  if not exists (select 1 from public.duty_members) then
    perform private.duty_load_active();
  end if;
end;
$$;

-- ───────────────────────── Đọc ─────────────────────────
create or replace function private.duty_members_json()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name) order by m.sort_order, m.created_at), '[]'::jsonb)
  from public.duty_members m;
$$;

-- Mọi người: lịch sử quay; người có duty.manage: thêm danh sách vòng quay
create or replace function api.duty_state(p_limit int default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.profiles := private.require_user();
  v_manage boolean := 'duty.manage' = any (private.user_permissions(v.id));
begin
  return jsonb_build_object(
    'can_manage', v_manage,
    'members', case when v_manage then private.duty_members_json() end,
    'total_spins', (select count(*) from public.duty_spins),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'spun_at', s.spun_at) order by s.spun_at desc, s.id desc)
      from (select * from public.duty_spins order by spun_at desc, id desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) s
    ), '[]'::jsonb)
  );
end;
$$;

-- ───────────────────────── Quay ─────────────────────────
-- Chọn ngẫu nhiên 1 người; p_remove: xoá người đó khỏi vòng quay. Trả về danh sách TRƯỚC khi xoá + vị trí người trúng
create or replace function api.admin_duty_spin(p_remove boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
  v_before jsonb;
  w public.duty_members;
  v_idx int;
begin
  perform pg_advisory_xact_lock(hashtext('duty_spin'));
  v_before := private.duty_members_json();
  if jsonb_array_length(v_before) < 2 then
    perform private.raise_err('INVALID_INPUT', 'Cần ít nhất 2 người trong vòng quay');
  end if;
  select * into w from public.duty_members order by random() limit 1;
  select (x.ord - 1)::int into v_idx
  from jsonb_array_elements(v_before) with ordinality as x (item, ord) where (x.item ->> 'id')::uuid = w.id;
  insert into public.duty_spins (name, user_id, spun_by) values (w.name, w.user_id, v_admin.id);
  if coalesce(p_remove, false) then
    delete from public.duty_members where id = w.id;
  end if;
  perform private.audit(v_admin.id, 'duty.spin', 'duty', w.id::text, null,
    jsonb_build_object('name', w.name, 'removed', coalesce(p_remove, false)));
  return jsonb_build_object('winner', jsonb_build_object('id', w.id, 'name', w.name), 'index', v_idx,
    'members_before', v_before, 'members', private.duty_members_json());
end;
$$;

-- ───────────────────────── Sửa danh sách ─────────────────────────
create or replace function api.admin_duty_add(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
  v_name text := private.clean_text(p_name);
begin
  if v_name is null or length(v_name) > 60 then
    perform private.raise_err('INVALID_INPUT', 'Tên 1–60 ký tự');
  end if;
  if exists (select 1 from public.duty_members where lower(name) = lower(v_name)) then
    perform private.raise_err('DUPLICATE_REFERENCE', v_name || ' đã có trong danh sách');
  end if;
  insert into public.duty_members (name, user_id, sort_order)
  values (v_name, (select id from public.profiles where lower(display_name) = lower(v_name) and status = 'ACTIVE' limit 1),
    coalesce((select max(sort_order) + 1 from public.duty_members), 1));
  return private.duty_members_json();
end;
$$;

create or replace function api.admin_duty_rename(p_id uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
  v_name text := private.clean_text(p_name);
begin
  if v_name is null or length(v_name) > 60 then
    perform private.raise_err('INVALID_INPUT', 'Tên 1–60 ký tự');
  end if;
  if exists (select 1 from public.duty_members where lower(name) = lower(v_name) and id <> p_id) then
    perform private.raise_err('DUPLICATE_REFERENCE', v_name || ' đã có trong danh sách');
  end if;
  update public.duty_members set name = v_name where id = p_id;
  if not found then
    perform private.raise_err('INVALID_INPUT', 'Không tìm thấy người trong danh sách');
  end if;
  return private.duty_members_json();
end;
$$;

create or replace function api.admin_duty_delete(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
begin
  delete from public.duty_members where id = p_id;
  return private.duty_members_json();
end;
$$;

-- Nạp lại: danh sách = mọi tài khoản đang hoạt động
create or replace function api.admin_duty_reset()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
begin
  delete from public.duty_members;
  perform private.duty_load_active();
  return private.duty_members_json();
end;
$$;

grant execute on function api.duty_state(int) to authenticated;
grant execute on function api.admin_duty_spin(boolean) to authenticated;
grant execute on function api.admin_duty_add(text) to authenticated;
grant execute on function api.admin_duty_rename(uuid, text) to authenticated;
grant execute on function api.admin_duty_delete(uuid) to authenticated;
grant execute on function api.admin_duty_reset() to authenticated;
revoke all on function private.duty_members_json(), private.duty_load_active() from public, anon, authenticated;


commit;

notify pgrst, 'reload schema';

-- Kiểm tra: các dòng đều true
select 'bảng duty_members / duty_spins' as muc, to_regclass('public.duty_members') is not null and to_regclass('public.duty_spins') is not null as co
union all select 'api.admin_duty_spin', to_regprocedure('api.admin_duty_spin(boolean)') is not null
union all select 'Quản trị viên có quyền Trực nhật', exists (select 1 from public.roles where is_system and 'duty.manage' = any (permissions));
