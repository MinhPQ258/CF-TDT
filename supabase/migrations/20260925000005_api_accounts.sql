-- API: tài khoản, hồ sơ, membership. Mọi hàm SECURITY DEFINER, search_path rỗng, tự kiểm quyền.

-- Hồ sơ của người đang đăng nhập. Không raise khi DISABLED/must_change để middleware đọc được trạng thái.
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
    'is_member_today', v.id = any (private.members_on(private.vn_today()))
  );
end;
$$;

-- Gọi sau khi supabase.auth.updateUser({ password }) thành công
create or replace function api.complete_password_change()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.profiles := private.require_user(true);
begin
  update public.profiles set must_change_password = false where id = v.id;
  perform private.audit(v.id, 'auth.password_changed', 'profile', v.id::text);
end;
$$;

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

-- Tạo hồ sơ sau khi server đã tạo auth user bằng service key
create or replace function api.admin_create_profile(
  p_user_id uuid, p_employee_code text, p_username text, p_display_name text, p_role text default 'MEMBER'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
  v_code text := private.clean_text(p_employee_code);
  v_username text := lower(private.clean_text(p_username));
  v_name text := private.clean_text(p_display_name);
  v_role text := upper(coalesce(p_role, 'MEMBER'));
begin
  if p_user_id is null or not exists (select 1 from auth.users where id = p_user_id) then
    perform private.raise_err('INVALID_INPUT', 'auth user không tồn tại');
  end if;
  if v_code is null or v_code !~ '^[A-Za-z0-9._-]{1,32}$' then
    perform private.raise_err('INVALID_INPUT', 'employee_code');
  end if;
  if v_username is null or v_username !~ '^[a-z0-9._-]{3,32}$' then
    perform private.raise_err('INVALID_INPUT', 'username');
  end if;
  if v_name is null or length(v_name) > 100 then
    perform private.raise_err('INVALID_INPUT', 'display_name');
  end if;
  if v_role not in ('MEMBER', 'ADMIN') then
    perform private.raise_err('INVALID_INPUT', 'role');
  end if;
  if exists (select 1 from public.profiles where employee_code = v_code) then
    perform private.raise_err('DUPLICATE_REFERENCE', 'employee_code');
  end if;
  if exists (select 1 from public.profiles where username = v_username) then
    perform private.raise_err('DUPLICATE_REFERENCE', 'username');
  end if;
  insert into public.profiles (id, employee_code, username, display_name, role, status, must_change_password)
  values (p_user_id, v_code, v_username, v_name, v_role::public.user_role, 'ACTIVE', true);
  perform private.audit(v_admin.id, 'user.create', 'profile', p_user_id::text, null,
    jsonb_build_object('employee_code', v_code, 'username', v_username, 'display_name', v_name, 'role', v_role));
  return jsonb_build_object('id', p_user_id);
end;
$$;

create or replace function api.admin_set_user_status(p_user_id uuid, p_status text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
  v_old public.profiles;
  v_status text := upper(coalesce(p_status, ''));
begin
  if v_status not in ('ACTIVE', 'DISABLED') then
    perform private.raise_err('INVALID_INPUT', 'status');
  end if;
  if private.clean_text(p_reason) is null then
    perform private.raise_err('INVALID_INPUT', 'lý do bắt buộc');
  end if;
  if p_user_id = v_admin.id then
    perform private.raise_err('INVALID_INPUT', 'không thể tự khóa tài khoản của mình');
  end if;
  select * into v_old from public.profiles where id = p_user_id for update;
  if not found then
    perform private.raise_err('INVALID_INPUT', 'không tìm thấy tài khoản');
  end if;
  update public.profiles set status = v_status::public.user_status where id = p_user_id;
  perform private.audit(v_admin.id, case when v_status = 'DISABLED' then 'user.disable' else 'user.enable' end,
    'profile', p_user_id::text, jsonb_build_object('status', v_old.status), jsonb_build_object('status', v_status),
    private.clean_text(p_reason));
end;
$$;

create or replace function api.admin_set_user_role(p_user_id uuid, p_role text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
  v_old public.profiles;
  v_role text := upper(coalesce(p_role, ''));
begin
  if v_role not in ('MEMBER', 'ADMIN') then
    perform private.raise_err('INVALID_INPUT', 'role');
  end if;
  if private.clean_text(p_reason) is null then
    perform private.raise_err('INVALID_INPUT', 'lý do bắt buộc');
  end if;
  if p_user_id = v_admin.id then
    perform private.raise_err('INVALID_INPUT', 'không thể tự đổi vai trò của mình');
  end if;
  select * into v_old from public.profiles where id = p_user_id for update;
  if not found then
    perform private.raise_err('INVALID_INPUT', 'không tìm thấy tài khoản');
  end if;
  update public.profiles set role = v_role::public.user_role where id = p_user_id;
  perform private.audit(v_admin.id, 'user.role', 'profile', p_user_id::text,
    jsonb_build_object('role', v_old.role), jsonb_build_object('role', v_role), private.clean_text(p_reason));
end;
$$;

-- Server đã đặt mật khẩu tạm qua auth admin API → bật cờ bắt buộc đổi mật khẩu
create or replace function api.admin_mark_password_reset(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
begin
  update public.profiles set must_change_password = true where id = p_user_id;
  if not found then
    perform private.raise_err('INVALID_INPUT', 'không tìm thấy tài khoản');
  end if;
  perform private.audit(v_admin.id, 'user.password_reset', 'profile', p_user_id::text);
end;
$$;

-- ───────────────────────── Membership ─────────────────────────

-- Số phiếu GIFT/PURCHASE đã post mà phân bổ cũ khác với membership mới (quyết định 3′)
create or replace function private.membership_impact(
  p_user uuid, p_old daterange, p_new daterange
)
returns int
language sql
stable
set search_path = ''
as $$
  select count(*)::int
  from public.fund_events e
  where e.kind in ('GIFT', 'PURCHASE_FUND', 'PURCHASE_MEMBER')
    and ((p_old is not null and p_old @> e.occurred_on) or p_new @> e.occurred_on)
    and (p_new @> e.occurred_on) <> exists (
      select 1 from public.member_ledger ml
      where ml.event_id = e.id and ml.user_id = p_user
        and ml.entry_type in ('GIFT_SHARE', 'PURCHASE_SHARE') and ml.reverses_entry_id is null
    );
$$;

create or replace function api.admin_list_memberships(p_user_id uuid default null)
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
      'id', m.id, 'user_id', m.user_id, 'employee_code', p.employee_code, 'username', p.username::text,
      'display_name', p.display_name, 'start_date', m.start_date, 'end_date', m.end_date,
      'reason', m.reason, 'updated_at', m.updated_at,
      'is_active_today', m.start_date <= v_today and (m.end_date is null or v_today < m.end_date)
    ) order by p.employee_code, m.start_date desc)
    from public.fund_memberships m join public.profiles p on p.id = m.user_id
    where p_user_id is null or m.user_id = p_user_id
  ), '[]'::jsonb);
end;
$$;

create or replace function api.admin_membership_impact(
  p_membership_id uuid, p_user_id uuid, p_start_date date, p_end_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_old public.fund_memberships;
  v_user uuid := p_user_id;
begin
  perform private.require_admin();
  if p_start_date is null or (p_end_date is not null and p_end_date <= p_start_date) then
    perform private.raise_err('INVALID_INPUT', 'khoảng ngày không hợp lệ');
  end if;
  if p_membership_id is not null then
    select * into v_old from public.fund_memberships where id = p_membership_id;
    if not found then
      perform private.raise_err('INVALID_INPUT', 'không tìm thấy membership');
    end if;
    v_user := v_old.user_id;
  end if;
  return jsonb_build_object(
    'affected_posted_events', private.membership_impact(v_user,
      case when p_membership_id is null then null else daterange(v_old.start_date, v_old.end_date, '[)') end,
      daterange(p_start_date, p_end_date, '[)')),
    'balance_vnd', private.balance_of(v_user)
  );
end;
$$;

-- Tạo (p_membership_id null) hoặc sửa membership; lý do bắt buộc; trả số phiếu bị "lệch lịch sử"
create or replace function api.admin_upsert_membership(
  p_membership_id uuid, p_user_id uuid, p_start_date date, p_end_date date, p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
  v_reason text := private.clean_text(p_reason);
  v_old public.fund_memberships;
  v_user uuid := p_user_id;
  v_id uuid := p_membership_id;
  v_overlap public.fund_memberships;
  v_affected int;
begin
  if v_reason is null or length(v_reason) > 500 then
    perform private.raise_err('INVALID_INPUT', 'lý do bắt buộc');
  end if;
  if p_start_date is null or (p_end_date is not null and p_end_date <= p_start_date) then
    perform private.raise_err('INVALID_INPUT', 'ngày kết thúc phải sau ngày bắt đầu');
  end if;
  if p_membership_id is not null then
    select * into v_old from public.fund_memberships where id = p_membership_id for update;
    if not found then
      perform private.raise_err('INVALID_INPUT', 'không tìm thấy membership');
    end if;
    v_user := v_old.user_id;
  else
    perform private.require_profile(v_user, 'thành viên');
  end if;

  select * into v_overlap from public.fund_memberships
  where user_id = v_user and id is distinct from p_membership_id
    and daterange(start_date, end_date, '[)') && daterange(p_start_date, p_end_date, '[)')
  limit 1;
  if found then
    perform private.raise_err('MEMBERSHIP_OVERLAP',
      format('%s → %s', v_overlap.start_date, coalesce(v_overlap.end_date::text, 'nay')));
  end if;

  v_affected := private.membership_impact(v_user,
    case when p_membership_id is null then null else daterange(v_old.start_date, v_old.end_date, '[)') end,
    daterange(p_start_date, p_end_date, '[)'));

  begin
    if p_membership_id is null then
      insert into public.fund_memberships (user_id, start_date, end_date, reason, created_by, updated_by)
      values (v_user, p_start_date, p_end_date, v_reason, v_admin.id, v_admin.id)
      returning id into v_id;
    else
      update public.fund_memberships
      set start_date = p_start_date, end_date = p_end_date, reason = v_reason, updated_by = v_admin.id
      where id = p_membership_id;
    end if;
  exception when exclusion_violation then
    perform private.raise_err('MEMBERSHIP_OVERLAP');
  end;

  perform private.audit(v_admin.id, case when p_membership_id is null then 'membership.create' else 'membership.update' end,
    'fund_membership', v_id::text,
    case when p_membership_id is null then null
      else jsonb_build_object('start_date', v_old.start_date, 'end_date', v_old.end_date) end,
    jsonb_build_object('user_id', v_user, 'start_date', p_start_date, 'end_date', p_end_date,
      'affected_posted_events', v_affected),
    v_reason);

  return jsonb_build_object('membership_id', v_id, 'affected_posted_events', v_affected,
    'balance_vnd', private.balance_of(v_user));
end;
$$;
