-- Mọi tài khoản ACTIVE được tạo đợt vote (nút ＋ trên thanh menu, 30/09).
-- Điều khiển đợt (chốt sớm, hủy, sửa lựa chọn, đổi giờ chốt) vẫn chỉ admin.
-- Chỉ thêm / thay thân hàm, giữ nguyên chữ ký cũ.

-- Thân chung: api.create_vote_session (mọi người) và api.admin_create_vote_session (admin, giữ tương thích)
create or replace function private.create_vote_session(
  p_actor public.profiles, p_name text, p_service_date date, p_opens_at timestamptz, p_cutoff_at timestamptz,
  p_planned_brew_at timestamptz, p_publish boolean, p_styles text[], p_addons text[], p_allow_cups boolean, p_copy_from uuid
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_name text := private.clean_text(p_name);
  v_allow boolean := p_allow_cups;
  -- Thành viên không tạo được nháp (nháp chỉ admin thấy)
  v_publish boolean := coalesce(p_publish, true) or p_actor.role <> 'ADMIN';
  s public.vote_sessions;
begin
  if v_name is null or length(v_name) > 100 then
    perform private.raise_err('INVALID_INPUT', 'tên đợt');
  end if;
  if p_service_date is null or p_opens_at is null or p_cutoff_at is null or p_cutoff_at <= p_opens_at then
    perform private.raise_err('INVALID_INPUT', 'giờ chốt phải sau giờ mở');
  end if;
  if p_cutoff_at <= now() then
    perform private.raise_err('INVALID_INPUT', 'giờ chốt phải ở tương lai');
  end if;
  if p_copy_from is not null and not exists (select 1 from public.vote_sessions where id = p_copy_from) then
    perform private.raise_err('INVALID_INPUT', 'đợt dùng lại không tồn tại');
  end if;
  if v_allow is null then
    v_allow := coalesce((select allow_cups from public.vote_sessions where id = p_copy_from), true);
  end if;
  insert into public.vote_sessions (name, service_date, opens_at, cutoff_at, planned_brew_at, status, created_by, allow_cups)
  values (v_name, p_service_date, p_opens_at, p_cutoff_at, p_planned_brew_at,
    case when v_publish then 'PUBLISHED' else 'DRAFT' end::public.vote_session_status, p_actor.id, v_allow)
  returning * into s;
  perform private.seed_vote_options(s.id, p_styles, p_addons, p_copy_from);
  perform private.audit(p_actor.id, 'vote.create', 'vote_session', s.id::text, null,
    to_jsonb(s) || jsonb_build_object('options', private.vote_options_json(s.id), 'by_role', p_actor.role));
  return private.vote_session_json(s, p_actor.id);
end;
$$;

create or replace function api.create_vote_session(
  p_name text, p_service_date date, p_opens_at timestamptz, p_cutoff_at timestamptz,
  p_planned_brew_at timestamptz default null, p_publish boolean default true,
  p_styles text[] default null, p_addons text[] default null, p_allow_cups boolean default null,
  p_copy_from uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.create_vote_session(private.require_user(), p_name, p_service_date, p_opens_at, p_cutoff_at,
    p_planned_brew_at, p_publish, p_styles, p_addons, p_allow_cups, p_copy_from);
end;
$$;

create or replace function api.admin_create_vote_session(
  p_name text, p_service_date date, p_opens_at timestamptz, p_cutoff_at timestamptz,
  p_planned_brew_at timestamptz default null, p_publish boolean default true,
  p_styles text[] default null, p_addons text[] default null, p_allow_cups boolean default null,
  p_copy_from uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.create_vote_session(private.require_admin(), p_name, p_service_date, p_opens_at, p_cutoff_at,
    p_planned_brew_at, p_publish, p_styles, p_addons, p_allow_cups, p_copy_from);
end;
$$;

-- "Dùng lại lựa chọn từ" cho mọi người: 10 đợt đã đăng gần nhất
create or replace function api.vote_templates()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_user();
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'service_date', s.service_date,
      'opens_at', s.opens_at, 'cutoff_at', s.cutoff_at, 'planned_brew_at', s.planned_brew_at,
      'allow_cups', s.allow_cups, 'options', private.vote_options_json(s.id)) order by s.created_at desc)
    from (select * from public.vote_sessions
          where status <> 'DRAFT'
            and exists (select 1 from public.vote_session_options o where o.vote_session_id = vote_sessions.id)
          order by created_at desc limit 10) s
  ), '[]'::jsonb);
end;
$$;

grant execute on function api.create_vote_session(text, date, timestamptz, timestamptz, timestamptz, boolean, text[], text[], boolean, uuid) to authenticated;
grant execute on function api.vote_templates() to authenticated;
revoke all on function private.create_vote_session(public.profiles, text, date, timestamptz, timestamptz, timestamptz, boolean, text[], text[], boolean, uuid)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
