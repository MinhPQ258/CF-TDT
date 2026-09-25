-- API vote pha chung. Trạng thái "đang mở" suy ra theo giờ (quyết định 13a), không cần cron.
-- Mọi tài khoản ACTIVE được vote; kết quả hiện tên (quyết định 7A). Vote không sinh ledger.

create or replace function private.vote_state(s public.vote_sessions)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when s.status = 'CANCELLED' then 'CANCELLED'
    when s.status = 'DRAFT' then 'DRAFT'
    when s.closed_early_at is not null then 'CLOSED'
    when now() < s.opens_at then 'UPCOMING'
    when now() >= s.cutoff_at then 'CLOSED'
    else 'OPEN'
  end;
$$;

create or replace function private.vote_session_json(s public.vote_sessions, p_viewer uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id, 'name', s.name, 'service_date', s.service_date, 'opens_at', s.opens_at,
    'cutoff_at', s.cutoff_at, 'planned_brew_at', s.planned_brew_at, 'status', s.status,
    'state', private.vote_state(s), 'closed_early_at', s.closed_early_at, 'cancel_reason', s.cancel_reason,
    'closed_at', case when s.closed_early_at is not null then least(s.closed_early_at, s.cutoff_at) else s.cutoff_at end,
    'yes_count', (select count(*) from public.votes v where v.vote_session_id = s.id and not v.is_withdrawn and v.choice = 'YES'),
    'no_count', (select count(*) from public.votes v where v.vote_session_id = s.id and not v.is_withdrawn and v.choice = 'NO'),
    'cups_total', (select coalesce(sum(v.cups), 0) from public.votes v where v.vote_session_id = s.id and not v.is_withdrawn and v.choice = 'YES'),
    'my_vote', (select jsonb_build_object('choice', v.choice, 'coffee_type', v.coffee_type, 'cups', v.cups,
                  'note', v.note, 'updated_at', v.updated_at)
                from public.votes v where v.vote_session_id = s.id and v.user_id = p_viewer and not v.is_withdrawn)
  );
$$;

create or replace function api.list_vote_sessions(p_from date default null, p_to date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.profiles := private.require_user();
  v_from date := coalesce(p_from, private.vn_today() - 7);
  v_to date := coalesce(p_to, private.vn_today() + 14);
begin
  if v_to - v_from > 366 then
    perform private.raise_err('INVALID_INPUT', 'khoảng ngày tối đa 1 năm');
  end if;
  return coalesce((
    select jsonb_agg(private.vote_session_json(s, v.id) order by s.service_date desc, s.opens_at desc)
    from public.vote_sessions s
    where s.service_date between v_from and v_to
      and (v.role = 'ADMIN' or s.status <> 'DRAFT')
  ), '[]'::jsonb);
end;
$$;

create or replace function api.vote_session_detail(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.profiles := private.require_user();
  s public.vote_sessions;
begin
  select * into s from public.vote_sessions where id = p_session_id;
  if not found or (s.status = 'DRAFT' and v.role <> 'ADMIN') then
    perform private.raise_err('INVALID_INPUT', 'không tìm thấy đợt vote');
  end if;
  return private.vote_session_json(s, v.id) || jsonb_build_object(
    'by_type', (
      select jsonb_object_agg(t.coffee_type, jsonb_build_object('people', t.people, 'cups', t.cups))
      from (
        select vv.coffee_type::text as coffee_type, count(*) as people, sum(vv.cups) as cups
        from public.votes vv where vv.vote_session_id = s.id and not vv.is_withdrawn and vv.choice = 'YES'
        group by vv.coffee_type
      ) t
    ),
    'votes', coalesce((
      select jsonb_agg(jsonb_build_object('display_name', p.display_name, 'employee_code', p.employee_code,
        'choice', vv.choice, 'coffee_type', vv.coffee_type, 'cups', vv.cups, 'note', vv.note,
        'updated_at', vv.updated_at, 'is_me', vv.user_id = v.id)
        order by vv.choice desc, p.display_name)
      from public.votes vv join public.profiles p on p.id = vv.user_id
      where vv.vote_session_id = s.id and not vv.is_withdrawn), '[]'::jsonb)
  );
end;
$$;

create or replace function private.lock_open_session(p_session_id uuid)
returns public.vote_sessions
language plpgsql
set search_path = ''
as $$
declare
  s public.vote_sessions;
  v_state text;
begin
  -- FOR SHARE: nhiều người vote song song được, nhưng chờ close_vote_early (FOR UPDATE)
  select * into s from public.vote_sessions where id = p_session_id for share;
  if not found or s.status = 'DRAFT' then
    perform private.raise_err('INVALID_INPUT', 'không tìm thấy đợt vote');
  end if;
  v_state := private.vote_state(s);
  if v_state = 'UPCOMING' then
    perform private.raise_err('VOTE_NOT_OPEN', s.opens_at::text);
  elsif v_state <> 'OPEN' then
    perform private.raise_err('VOTE_CLOSED',
      coalesce(least(s.closed_early_at, s.cutoff_at), s.cutoff_at)::text);
  end if;
  return s;
end;
$$;

create or replace function api.cast_vote(
  p_session_id uuid, p_choice text, p_coffee_type text default null, p_cups int default null, p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.profiles := private.require_user();
  s public.vote_sessions := private.lock_open_session(p_session_id);
  v_choice text := upper(coalesce(p_choice, ''));
  v_type text := case when upper(coalesce(p_choice, '')) = 'YES' then upper(coalesce(p_coffee_type, 'UNDECIDED')) end;
  v_cups int := case when upper(coalesce(p_choice, '')) = 'YES' then p_cups end;
  v_note text := private.clean_text(p_note);
begin
  if v_choice not in ('YES', 'NO') then
    perform private.raise_err('INVALID_INPUT', 'choice');
  end if;
  if v_choice = 'YES' and (v_type not in ('MACHINE', 'PHIN', 'UNDECIDED') or v_cups is null or v_cups not between 1 and 20) then
    perform private.raise_err('INVALID_INPUT', 'chọn loại pha và số cốc 1–20');
  end if;
  if v_note is not null and length(v_note) > 200 then
    perform private.raise_err('INVALID_INPUT', 'ghi chú tối đa 200 ký tự');
  end if;
  insert into public.votes (vote_session_id, user_id, choice, coffee_type, cups, note, is_withdrawn)
  values (s.id, v.id, v_choice::public.vote_choice, v_type::public.coffee_type, v_cups, v_note, false)
  on conflict (vote_session_id, user_id) do update
    set choice = excluded.choice, coffee_type = excluded.coffee_type, cups = excluded.cups,
        note = excluded.note, is_withdrawn = false;
  return private.vote_session_json(s, v.id);
end;
$$;

create or replace function api.withdraw_vote(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.profiles := private.require_user();
  s public.vote_sessions := private.lock_open_session(p_session_id);
begin
  update public.votes set is_withdrawn = true where vote_session_id = s.id and user_id = v.id;
  return private.vote_session_json(s, v.id);
end;
$$;

create or replace function api.admin_create_vote_session(
  p_name text, p_service_date date, p_opens_at timestamptz, p_cutoff_at timestamptz,
  p_planned_brew_at timestamptz default null, p_publish boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
  v_name text := private.clean_text(p_name);
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
  insert into public.vote_sessions (name, service_date, opens_at, cutoff_at, planned_brew_at, status, created_by)
  values (v_name, p_service_date, p_opens_at, p_cutoff_at, p_planned_brew_at,
    case when coalesce(p_publish, true) then 'PUBLISHED' else 'DRAFT' end::public.vote_session_status, v_admin.id)
  returning * into s;
  perform private.audit(v_admin.id, 'vote.create', 'vote_session', s.id::text, null, to_jsonb(s));
  return private.vote_session_json(s, v_admin.id);
end;
$$;

create or replace function api.admin_publish_vote_session(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
  s public.vote_sessions;
begin
  select * into s from public.vote_sessions where id = p_session_id for update;
  if not found or s.status <> 'DRAFT' then
    perform private.raise_err('INVALID_INPUT', 'chỉ đăng được đợt nháp');
  end if;
  if s.cutoff_at <= now() then
    perform private.raise_err('INVALID_INPUT', 'giờ chốt đã qua');
  end if;
  update public.vote_sessions set status = 'PUBLISHED' where id = s.id returning * into s;
  perform private.audit(v_admin.id, 'vote.publish', 'vote_session', s.id::text);
  return private.vote_session_json(s, v_admin.id);
end;
$$;

create or replace function api.admin_cancel_vote_session(p_session_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
  s public.vote_sessions;
begin
  if private.clean_text(p_reason) is null then
    perform private.raise_err('INVALID_INPUT', 'lý do hủy bắt buộc');
  end if;
  select * into s from public.vote_sessions where id = p_session_id for update;
  if not found or s.status = 'CANCELLED' then
    perform private.raise_err('INVALID_INPUT', 'đợt không tồn tại hoặc đã hủy');
  end if;
  update public.vote_sessions set status = 'CANCELLED', cancel_reason = private.clean_text(p_reason)
  where id = s.id returning * into s;
  perform private.audit(v_admin.id, 'vote.cancel', 'vote_session', s.id::text, null, null, private.clean_text(p_reason));
  return private.vote_session_json(s, v_admin.id);
end;
$$;

create or replace function api.close_vote_early(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
  s public.vote_sessions;
begin
  -- FOR UPDATE: chờ các cast_vote đang giữ FOR SHARE xong rồi mới chốt
  select * into s from public.vote_sessions where id = p_session_id for update;
  if not found or private.vote_state(s) not in ('OPEN', 'UPCOMING') then
    perform private.raise_err('VOTE_CLOSED', 'đợt không ở trạng thái mở');
  end if;
  update public.vote_sessions set closed_early_at = now() where id = s.id returning * into s;
  perform private.audit(v_admin.id, 'vote.close_early', 'vote_session', s.id::text);
  return private.vote_session_json(s, v_admin.id);
end;
$$;
