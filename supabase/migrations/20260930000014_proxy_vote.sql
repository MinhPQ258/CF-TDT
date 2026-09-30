-- 000014: Đặt hộ (vote hộ) — một người đặt cà phê cho người khác.
-- Mỗi người được đặt hộ có phiếu riêng (không còn nằm trong "chưa vote"), ghi votes.voted_by = người đặt.
-- Người được đặt hộ vẫn tự sửa/rút được; tự vote lại thì phiếu thành của họ (voted_by = null).
-- Không đặt hộ đè lên phiếu người đó đã tự vote. Tương thích ngược: cast_vote giữ nguyên chữ ký.

alter table public.votes add column if not exists voted_by uuid null references public.profiles (id) on delete restrict;
create index if not exists votes_voted_by_idx on public.votes (vote_session_id, voted_by) where voted_by is not null;

-- Kiểm tra + ghi một phiếu (dùng chung cho tự vote và đặt hộ)
create or replace function private.upsert_vote(
  s public.vote_sessions, p_target uuid, p_actor uuid, p_choice text, p_coffee_type text, p_cups int, p_note text,
  p_style_option_id uuid, p_addon_ids uuid[]
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_choice text := upper(coalesce(p_choice, ''));
  v_has_styles boolean;
  v_type text;
  v_style uuid;
  v_cups int;
  v_note text := private.clean_text(p_note);
  v_addons uuid[] := '{}';
  v_vote_id uuid;
begin
  if v_choice not in ('YES', 'NO') then
    perform private.raise_err('INVALID_INPUT', 'choice');
  end if;
  if v_note is not null and length(v_note) > 200 then
    perform private.raise_err('INVALID_INPUT', 'ghi chú tối đa 200 ký tự');
  end if;
  if v_choice = 'YES' then
    v_has_styles := exists (select 1 from public.vote_session_options where vote_session_id = s.id and kind = 'STYLE');
    if v_has_styles then
      if p_style_option_id is null or not exists (select 1 from public.vote_session_options
          where id = p_style_option_id and vote_session_id = s.id and kind = 'STYLE' and not is_hidden) then
        perform private.raise_err('INVALID_INPUT', 'Chọn kiểu pha của đợt này');
      end if;
      v_style := p_style_option_id;
    else
      v_type := upper(coalesce(p_coffee_type, 'UNDECIDED'));
      if v_type not in ('MACHINE', 'PHIN', 'UNDECIDED') then
        perform private.raise_err('INVALID_INPUT', 'kiểu pha');
      end if;
    end if;
    if s.allow_cups then
      v_cups := coalesce(p_cups, 1);
      if v_cups not between 1 and 20 then
        perform private.raise_err('INVALID_INPUT', 'số cốc 1–20');
      end if;
    elsif not v_has_styles then
      v_cups := 1; -- đợt cũ: ràng buộc cũ cần số cốc
    end if;
    if p_addon_ids is not null and cardinality(p_addon_ids) > 0 then
      select coalesce(array_agg(distinct x), '{}') into v_addons from unnest(p_addon_ids) x;
      if (select count(*) from public.vote_session_options
          where id = any (v_addons) and vote_session_id = s.id and kind = 'ADDON' and not is_hidden) <> cardinality(v_addons) then
        perform private.raise_err('INVALID_INPUT', 'Đồ đi kèm không thuộc đợt này');
      end if;
    end if;
  end if;

  insert into public.votes (vote_session_id, user_id, choice, coffee_type, cups, note, is_withdrawn, style_option_id, voted_by)
  values (s.id, p_target, v_choice::public.vote_choice, v_type::public.coffee_type, v_cups, v_note, false, v_style,
    case when p_target = p_actor then null else p_actor end)
  on conflict (vote_session_id, user_id) do update
    set choice = excluded.choice, coffee_type = excluded.coffee_type, cups = excluded.cups,
        note = excluded.note, is_withdrawn = false, style_option_id = excluded.style_option_id, voted_by = excluded.voted_by
  returning id into v_vote_id;
  delete from public.vote_addons where vote_id = v_vote_id;
  insert into public.vote_addons (vote_id, option_id) select v_vote_id, x from unnest(v_addons) x;
end;
$$;

create or replace function api.cast_vote(
  p_session_id uuid, p_choice text, p_coffee_type text default null, p_cups int default null, p_note text default null,
  p_style_option_id uuid default null, p_addon_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.profiles := private.require_user();
  s public.vote_sessions := private.lock_open_session(p_session_id);
begin
  perform private.upsert_vote(s, v.id, v.id, p_choice, p_coffee_type, p_cups, p_note, p_style_option_id, p_addon_ids);
  return private.vote_session_json(s, v.id);
end;
$$;

-- Đặt hộ một người (luôn là "có uống")
create or replace function api.cast_vote_for(
  p_session_id uuid, p_user_id uuid, p_style_option_id uuid default null, p_addon_ids uuid[] default null,
  p_cups int default null, p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.profiles := private.require_user();
  s public.vote_sessions := private.lock_open_session(p_session_id);
  t public.profiles;
  cur public.votes;
begin
  if p_user_id is null or p_user_id = v.id then
    perform private.raise_err('INVALID_INPUT', 'Chọn người được đặt hộ');
  end if;
  select * into t from public.profiles where id = p_user_id and status = 'ACTIVE';
  if not found then
    perform private.raise_err('INVALID_INPUT', 'Không tìm thấy người được đặt hộ');
  end if;
  select * into cur from public.votes where vote_session_id = s.id and user_id = t.id for update;
  if found and not cur.is_withdrawn and cur.voted_by is null then
    perform private.raise_err('INVALID_INPUT', t.display_name || ' đã tự vote đợt này');
  end if;
  perform private.upsert_vote(s, t.id, v.id, 'YES', null, p_cups, p_note, p_style_option_id, p_addon_ids);
  return private.vote_session_json(s, v.id);
end;
$$;

-- Bỏ đặt hộ: chỉ phiếu do chính mình đặt hộ
create or replace function api.withdraw_vote_for(p_session_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.profiles := private.require_user();
  s public.vote_sessions := private.lock_open_session(p_session_id);
begin
  update public.votes set is_withdrawn = true
  where vote_session_id = s.id and user_id = p_user_id and voted_by = v.id and not is_withdrawn;
  return private.vote_session_json(s, v.id);
end;
$$;

-- Danh sách người có thể đặt hộ trong đợt (trừ mình): trạng thái SELF = đã tự vote, MINE = mình đặt hộ, OTHER = người khác đặt hộ
create or replace function api.vote_people(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.profiles := private.require_user();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'display_name', p.display_name, 'employee_code', p.employee_code,
      'status', case when vv.id is null then null when vv.voted_by is null then 'SELF' when vv.voted_by = v.id then 'MINE' else 'OTHER' end)
      order by p.display_name)
    from public.profiles p
    left join public.votes vv on vv.vote_session_id = p_session_id and vv.user_id = p.id and not vv.is_withdrawn
    where p.status = 'ACTIVE' and p.id <> v.id
  ), '[]'::jsonb);
end;
$$;

-- Session JSON: thêm my_proxies (phiếu mình đặt hộ) và my_vote_by (ai đặt hộ mình)
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
    'allow_cups', s.allow_cups,
    'options', private.vote_options_json(s.id),
    'yes_count', (select count(*) from public.votes v where v.vote_session_id = s.id and not v.is_withdrawn and v.choice = 'YES'),
    'no_count', (select count(*) from public.votes v where v.vote_session_id = s.id and not v.is_withdrawn and v.choice = 'NO'),
    'cups_total', (select coalesce(sum(coalesce(v.cups, 1)), 0) from public.votes v where v.vote_session_id = s.id and not v.is_withdrawn and v.choice = 'YES'),
    'my_vote', private.my_vote_json(s.id, p_viewer),
    'my_vote_by', (select b.display_name from public.votes v join public.profiles b on b.id = v.voted_by
      where v.vote_session_id = s.id and v.user_id = p_viewer and not v.is_withdrawn),
    'my_proxies', coalesce((
      select jsonb_agg(private.my_vote_json(s.id, v.user_id) || jsonb_build_object(
        'user_id', v.user_id, 'display_name', p.display_name, 'employee_code', p.employee_code) order by p.display_name)
      from public.votes v join public.profiles p on p.id = v.user_id
      where v.vote_session_id = s.id and v.voted_by = p_viewer and not v.is_withdrawn), '[]'::jsonb)
  );
$$;

-- Chi tiết đợt: mỗi phiếu thêm voted_by_name (bản 000012 + 1 trường)
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
    'options_all', case when v.role = 'ADMIN' then private.vote_options_json(s.id, true) end,
    'by_style', coalesce((
      select jsonb_agg(jsonb_build_object('label', t.label, 'people', t.people, 'cups', t.cups) order by t.cups desc, t.label)
      from (
        select private.vote_style_label(vv) as label, count(*) as people, sum(coalesce(vv.cups, 1)) as cups
        from public.votes vv where vv.vote_session_id = s.id and not vv.is_withdrawn and vv.choice = 'YES'
        group by 1
      ) t), '[]'::jsonb),
    'by_addon', coalesce((
      select jsonb_agg(jsonb_build_object('label', t.label, 'people', t.people) order by t.people desc, t.label)
      from (
        select o.label, count(*) as people
        from public.vote_addons a
        join public.votes vv on vv.id = a.vote_id
        join public.vote_session_options o on o.id = a.option_id
        where vv.vote_session_id = s.id and not vv.is_withdrawn and vv.choice = 'YES'
        group by o.label
      ) t), '[]'::jsonb),
    'votes', coalesce((
      select jsonb_agg(jsonb_build_object('display_name', p.display_name, 'employee_code', p.employee_code,
        'choice', vv.choice, 'style_label', private.vote_style_label(vv), 'addon_labels', private.vote_addon_labels(vv.id),
        'cups', vv.cups, 'note', vv.note, 'updated_at', vv.updated_at, 'is_me', vv.user_id = v.id,
        'voted_by_name', b.display_name)
        order by vv.choice desc, vv.updated_at)
      from public.votes vv join public.profiles p on p.id = vv.user_id
      left join public.profiles b on b.id = vv.voted_by
      where vv.vote_session_id = s.id and not vv.is_withdrawn), '[]'::jsonb),
    'not_voted', case when v.role = 'ADMIN' then coalesce((
      select jsonb_agg(jsonb_build_object('display_name', p.display_name, 'employee_code', p.employee_code) order by p.employee_code)
      from public.profiles p
      where p.status = 'ACTIVE'
        and not exists (select 1 from public.votes vv where vv.vote_session_id = s.id and vv.user_id = p.id and not vv.is_withdrawn)
    ), '[]'::jsonb) end
  );
end;
$$;

grant execute on function api.cast_vote_for(uuid, uuid, uuid, uuid[], int, text) to authenticated;
grant execute on function api.withdraw_vote_for(uuid, uuid) to authenticated;
grant execute on function api.vote_people(uuid) to authenticated;
revoke all on function private.upsert_vote(public.vote_sessions, uuid, uuid, text, text, int, text, uuid, uuid[]) from public, anon, authenticated;

notify pgrst, 'reload schema';
