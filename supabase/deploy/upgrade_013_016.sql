-- ============================================================================
-- Coffee TDT — NÂNG CẤP DB production từ migration 12 lên 16 (chạy tay, Supabase SQL Editor → Run)
--
--   013  Mọi người tạo được đợt vote (nút ＋)
--   014  Đặt hộ (vote hộ người khác)
--   015  Chỉnh sửa đợt (tên, ngày, giờ, lựa chọn)
--   016  Bỏ "Thành viên quỹ": mọi tài khoản ACTIVE chia đều quỹ; màn Quỹ (đã đóng / đã chi / tiền đóng từng người)
--
-- THỨ TỰ: chạy file này TRƯỚC, rồi mới Redeploy Vercel (code mới cần các hàm mới).
-- Một transaction: lỗi thì không đổi gì. Chạy lại nhiều lần vẫn an toàn (create or replace / if not exists),
-- kể cả khi trước đây đã chạy upgrade_013_member_create_vote.sql.
-- Nội dung = nguyên văn migrations 000013–000016 (không sửa tay; tạo lại khi các file đó đổi).
-- ============================================================================

begin;

-- ─────────────────────────── 20260930000013_member_create_vote.sql ───────────────────────────
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


-- ─────────────────────────── 20260930000014_proxy_vote.sql ───────────────────────────
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


-- ─────────────────────────── 20260930000015_update_vote_session.sql ───────────────────────────
-- 000015: Chỉnh sửa đợt (màn giống Tạo đợt): tên, ngày, giờ mở/chốt, cho nhập số cốc, danh sách kiểu pha / đồ đi kèm.
-- Đồng bộ lựa chọn theo danh sách mới: có sẵn → hiện lại + xếp thứ tự; mới → thêm;
-- bỏ khỏi danh sách → đã có người chọn thì ẩn (phiếu cũ giữ nguyên), chưa ai chọn thì xóa hẳn.
-- Giờ pha = giờ chốt. Chỉ đợt chưa chốt/chưa hủy.

create or replace function private.sync_vote_options(p_session_id uuid, p_kind public.vote_option_kind, p_labels text[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  i int := 0;
  v_label text;
  o public.vote_session_options;
begin
  foreach v_label in array p_labels loop
    i := i + 1;
    update public.vote_session_options set is_hidden = false, sort_order = i, label = v_label
    where vote_session_id = p_session_id and kind = p_kind and lower(label) = lower(v_label);
    if not found then
      insert into public.vote_session_options (vote_session_id, kind, label, sort_order) values (p_session_id, p_kind, v_label, i);
    end if;
  end loop;
  for o in select * from public.vote_session_options
      where vote_session_id = p_session_id and kind = p_kind
        and lower(label) not in (select lower(x) from unnest(p_labels) x) loop
    if exists (select 1 from public.votes where style_option_id = o.id)
       or exists (select 1 from public.vote_addons where option_id = o.id) then
      update public.vote_session_options set is_hidden = true where id = o.id;
    else
      delete from public.vote_session_options where id = o.id;
    end if;
  end loop;
end;
$$;

create or replace function api.admin_update_vote_session(
  p_session_id uuid, p_name text, p_service_date date, p_opens_at timestamptz, p_cutoff_at timestamptz,
  p_allow_cups boolean, p_styles text[], p_addons text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
  s public.vote_sessions;
  v_name text := private.clean_text(p_name);
  v_styles text[] := private.clean_labels(p_styles, 10, 'Kiểu pha');
  v_addons text[] := private.clean_labels(p_addons, 20, 'Đồ đi kèm');
begin
  select * into s from public.vote_sessions where id = p_session_id for update;
  if not found or private.vote_state(s) not in ('OPEN', 'UPCOMING', 'DRAFT') then
    perform private.raise_err('VOTE_CLOSED', 'đợt đã chốt hoặc đã hủy');
  end if;
  if v_name is null or length(v_name) > 100 then
    perform private.raise_err('INVALID_INPUT', 'tên đợt 1–100 ký tự');
  end if;
  if p_service_date is null or p_opens_at is null or p_cutoff_at is null or p_cutoff_at <= p_opens_at then
    perform private.raise_err('INVALID_INPUT', 'Giờ chốt phải sau giờ mở');
  end if;
  if p_cutoff_at <= now() then
    perform private.raise_err('INVALID_INPUT', 'Giờ chốt phải ở tương lai');
  end if;
  if cardinality(v_styles) = 0 then
    perform private.raise_err('INVALID_INPUT', 'Cần ít nhất 1 kiểu pha');
  end if;

  update public.vote_sessions
  set name = v_name, service_date = p_service_date, opens_at = p_opens_at, cutoff_at = p_cutoff_at,
      planned_brew_at = p_cutoff_at, allow_cups = coalesce(p_allow_cups, allow_cups), updated_at = now()
  where id = s.id returning * into s;
  perform private.sync_vote_options(s.id, 'STYLE', v_styles);
  perform private.sync_vote_options(s.id, 'ADDON', v_addons);
  perform private.audit(v_admin.id, 'vote.update', 'vote_session', s.id::text, null,
    jsonb_build_object('name', v_name, 'opens_at', p_opens_at, 'cutoff_at', p_cutoff_at, 'styles', v_styles, 'addons', v_addons));
  return private.vote_session_json(s, v_admin.id);
end;
$$;

grant execute on function api.admin_update_vote_session(uuid, text, date, timestamptz, timestamptz, boolean, text[], text[]) to authenticated;
revoke all on function private.sync_vote_options(uuid, public.vote_option_kind, text[]) from public, anon, authenticated;


-- ─────────────────────────── 20260930000016_everyone_shares.sql ───────────────────────────
-- 000016: Bỏ khái niệm "Thành viên quỹ" — mọi tài khoản ACTIVE đều được chia đều phiếu mua / tiền cho thêm.
-- Bảng fund_memberships giữ lại (dữ liệu cũ), không còn ảnh hưởng tới phân bổ.
-- Các bút toán đã ghi không đổi; chỉ giao dịch mới chia theo danh sách tài khoản ACTIVE tại lúc ghi.

create or replace function private.members_on(p_date date)
returns uuid[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(p.id order by p.employee_code, p.id), '{}'::uuid[])
  from public.profiles p
  where p.status = 'ACTIVE';
$$;

-- Tổng quan quỹ cho mọi người: đã đóng, đã chi, còn lại + số tiền đóng của từng người
create or replace function api.fund_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.profiles := private.require_user();
begin
  return jsonb_build_object(
    'cash_balance_vnd', private.cash_total(),
    'as_of', private.vn_today(),
    -- tiền nộp (đã trừ các khoản đảo)
    'deposits_vnd', coalesce((select sum(amount_vnd) from public.cash_ledger where entry_type = 'DEPOSIT_IN'), 0),
    'gifts_vnd', coalesce((select sum(amount_vnd) from public.cash_ledger where entry_type = 'GIFT_IN'), 0),
    -- đã chi = tiền thực ra khỏi quỹ (phiếu quỹ trả + hoàn tiền) → đã đóng − đã chi = quỹ còn
    'spent_vnd', coalesce((select -sum(amount_vnd) from public.cash_ledger where entry_type in ('PURCHASE_OUT', 'REIMBURSEMENT_OUT')), 0),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', t.id, 'display_name', t.display_name, 'employee_code', t.employee_code,
        'deposited_vnd', t.deposited, 'is_me', t.id = v.id) order by t.deposited desc, t.employee_code)
      from (
        select p.id, p.display_name, p.employee_code,
          coalesce((select sum(m.amount_vnd) from public.member_ledger m where m.user_id = p.id and m.entry_type = 'DEPOSIT_CREDIT'), 0) as deposited
        from public.profiles p
        where p.status = 'ACTIVE'
           or exists (select 1 from public.member_ledger m where m.user_id = p.id and m.entry_type = 'DEPOSIT_CREDIT')
      ) t
    ), '[]'::jsonb)
  );
end;
$$;


commit;

-- Cho Data API nạp lại danh sách hàm
notify pgrst, 'reload schema';

-- Kiểm tra: 4 dòng đều phải là true
select 'vote_templates (013)' as ham, to_regprocedure('api.vote_templates()') is not null as co
union all select 'cast_vote_for (014)', to_regprocedure('api.cast_vote_for(uuid,uuid,uuid,uuid[],integer,text)') is not null
union all select 'admin_update_vote_session (015)', to_regprocedure('api.admin_update_vote_session(uuid,text,date,timestamptz,timestamptz,boolean,text[],text[])') is not null
union all select 'members_on = mọi tài khoản ACTIVE (016)', pg_get_functiondef('private.members_on(date)'::regprocedure) like '%status = ''ACTIVE''%';
