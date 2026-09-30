-- ============================================================================
-- Coffee TDT — NÂNG CẤP DB đã chạy 11 migration đầu (bản 25/09) lên migration 12
-- Lựa chọn vote theo từng đợt: kiểu pha / đồ đi kèm, api.home(), kết quả theo lựa chọn.
-- Chạy MỘT LẦN trong Supabase SQL Editor. Một transaction: lỗi ở đâu thì không có gì được ghi.
-- Project mới thì KHÔNG cần file này — dùng coffee_tdt_full.sql.
-- ============================================================================

begin;

-- Lựa chọn vote theo từng đợt (tài liệu thiết kế 30/09 §6.1, §8): admin tự thêm kiểu pha (chọn 1)
-- và đồ đi kèm (chọn nhiều). Chỉ thêm, không xóa: dữ liệu cũ dùng coffee_type vẫn đọc được.

create type public.vote_option_kind as enum ('STYLE', 'ADDON');

alter table public.vote_sessions add column allow_cups boolean not null default true;

create table public.vote_session_options (
  id uuid primary key default gen_random_uuid(),
  vote_session_id uuid not null references public.vote_sessions (id) on delete restrict,
  kind public.vote_option_kind not null,
  label text not null check (length(btrim(label)) between 1 and 40),
  sort_order int not null default 0,
  is_hidden boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, vote_session_id)
);
create unique index vote_session_options_label_uq on public.vote_session_options (vote_session_id, kind, lower(label));
create index vote_session_options_session_idx on public.vote_session_options (vote_session_id, kind, sort_order);

alter table public.votes add column style_option_id uuid null;
-- Kiểu pha phải thuộc đúng đợt của phiếu
alter table public.votes add constraint votes_style_option_fk
  foreign key (style_option_id, vote_session_id) references public.vote_session_options (id, vote_session_id) on delete restrict;
alter table public.votes drop constraint votes_choice_chk;
alter table public.votes add constraint votes_choice_chk check (
  (choice = 'NO' and coffee_type is null and cups is null and style_option_id is null)
  or (choice = 'YES' and (coffee_type is not null or style_option_id is not null))
);

create table public.vote_addons (
  vote_id uuid not null references public.votes (id) on delete cascade,
  option_id uuid not null references public.vote_session_options (id) on delete restrict,
  primary key (vote_id, option_id)
);

alter table public.vote_session_options enable row level security;
alter table public.vote_addons enable row level security;
revoke all on public.vote_session_options, public.vote_addons from anon, authenticated;

-- ───────────────────────── Helpers ─────────────────────────

-- Chuẩn hóa danh sách nhãn: trim, bỏ trống, bỏ trùng (không phân biệt hoa thường), giữ thứ tự
create or replace function private.clean_labels(p_labels text[], p_max int, p_field text)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_out text[] := '{}';
  v text;
  v_clean text;
begin
  foreach v in array coalesce(p_labels, '{}') loop
    v_clean := private.clean_text(v);
    if v_clean is null then
      continue;
    end if;
    if length(v_clean) > 40 then
      perform private.raise_err('INVALID_INPUT', format('%s: "%s" dài quá 40 ký tự', p_field, left(v_clean, 20)));
    end if;
    if not exists (select 1 from unnest(v_out) x where lower(x) = lower(v_clean)) then
      v_out := array_append(v_out, v_clean);
    end if;
  end loop;
  if cardinality(v_out) > p_max then
    perform private.raise_err('INVALID_INPUT', format('%s: tối đa %s lựa chọn', p_field, p_max));
  end if;
  return v_out;
end;
$$;

create or replace function private.vote_options_json(p_session_id uuid, p_include_hidden boolean default false)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'styles', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label, 'hidden', o.is_hidden) order by o.sort_order, o.created_at)
      from public.vote_session_options o where o.vote_session_id = p_session_id and o.kind = 'STYLE' and (p_include_hidden or not o.is_hidden)), '[]'::jsonb),
    'addons', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label, 'hidden', o.is_hidden) order by o.sort_order, o.created_at)
      from public.vote_session_options o where o.vote_session_id = p_session_id and o.kind = 'ADDON' and (p_include_hidden or not o.is_hidden)), '[]'::jsonb)
  );
$$;

-- Nhãn kiểu pha của một phiếu (lựa chọn của đợt, hoặc coffee_type cũ)
create or replace function private.vote_style_label(v public.votes)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when v.choice <> 'YES' then null
    when v.style_option_id is not null then (select o.label from public.vote_session_options o where o.id = v.style_option_id)
    when v.coffee_type = 'MACHINE' then 'Máy'
    when v.coffee_type = 'PHIN' then 'Phin'
    when v.coffee_type = 'UNDECIDED' then 'Chưa chọn'
  end;
$$;

create or replace function private.vote_addon_labels(p_vote_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(o.label order by o.sort_order, o.created_at), '[]'::jsonb)
  from public.vote_addons a join public.vote_session_options o on o.id = a.option_id
  where a.vote_id = p_vote_id;
$$;

create or replace function private.my_vote_json(p_session_id uuid, p_user uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('choice', v.choice, 'coffee_type', v.coffee_type, 'cups', v.cups, 'note', v.note,
    'updated_at', v.updated_at, 'style_option_id', v.style_option_id, 'style_label', private.vote_style_label(v),
    'addon_ids', coalesce((select jsonb_agg(a.option_id) from public.vote_addons a where a.vote_id = v.id), '[]'::jsonb),
    'addon_labels', private.vote_addon_labels(v.id))
  from public.votes v where v.vote_session_id = p_session_id and v.user_id = p_user and not v.is_withdrawn;
$$;

-- Session JSON: thêm allow_cups, options và phiếu của tôi có lựa chọn
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
    'my_vote', private.my_vote_json(s.id, p_viewer)
  );
$$;

-- Tạo lựa chọn cho đợt: danh sách truyền vào, hoặc chép từ đợt khác / đợt gần nhất có lựa chọn, hoặc mặc định
create or replace function private.seed_vote_options(
  p_session_id uuid, p_styles text[], p_addons text[], p_copy_from uuid
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_styles text[];
  v_addons text[];
  v_src uuid := p_copy_from;
begin
  if p_styles is null and v_src is null then
    select o.vote_session_id into v_src
    from public.vote_session_options o join public.vote_sessions s on s.id = o.vote_session_id
    where o.vote_session_id <> p_session_id
    order by s.created_at desc limit 1;
  end if;
  if p_styles is not null then
    v_styles := private.clean_labels(p_styles, 10, 'Kiểu pha');
  elsif v_src is not null then
    select coalesce(array_agg(label order by sort_order, created_at), '{}') into v_styles
    from public.vote_session_options where vote_session_id = v_src and kind = 'STYLE' and not is_hidden;
  else
    v_styles := array['Phin', 'Máy'];
  end if;
  if p_addons is not null then
    v_addons := private.clean_labels(p_addons, 20, 'Đồ đi kèm');
  elsif v_src is not null then
    select coalesce(array_agg(label order by sort_order, created_at), '{}') into v_addons
    from public.vote_session_options where vote_session_id = v_src and kind = 'ADDON' and not is_hidden;
  else
    v_addons := '{}';
  end if;
  if cardinality(v_styles) = 0 then
    perform private.raise_err('INVALID_INPUT', 'Cần ít nhất 1 kiểu pha');
  end if;
  insert into public.vote_session_options (vote_session_id, kind, label, sort_order)
  select p_session_id, 'STYLE', x.label, x.ord::int from unnest(v_styles) with ordinality as x (label, ord);
  insert into public.vote_session_options (vote_session_id, kind, label, sort_order)
  select p_session_id, 'ADDON', x.label, x.ord::int from unnest(v_addons) with ordinality as x (label, ord);
end;
$$;

-- ───────────────────────── Admin ─────────────────────────

drop function api.admin_create_vote_session(text, date, timestamptz, timestamptz, timestamptz, boolean);

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
declare
  v_admin public.profiles := private.require_admin();
  v_name text := private.clean_text(p_name);
  v_allow boolean := p_allow_cups;
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
    case when coalesce(p_publish, true) then 'PUBLISHED' else 'DRAFT' end::public.vote_session_status, v_admin.id, v_allow)
  returning * into s;
  perform private.seed_vote_options(s.id, p_styles, p_addons, p_copy_from);
  perform private.audit(v_admin.id, 'vote.create', 'vote_session', s.id::text, null,
    to_jsonb(s) || jsonb_build_object('options', private.vote_options_json(s.id)));
  return private.vote_session_json(s, v_admin.id);
end;
$$;

-- Thêm một lựa chọn (được cả khi đợt đã có phiếu, trừ khi đã chốt/hủy)
create or replace function api.admin_add_vote_option(p_session_id uuid, p_kind text, p_label text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
  s public.vote_sessions;
  v_kind text := upper(coalesce(p_kind, ''));
  v_label text := private.clean_text(p_label);
  v_max int;
begin
  select * into s from public.vote_sessions where id = p_session_id for update;
  if not found or private.vote_state(s) in ('CLOSED', 'CANCELLED') then
    perform private.raise_err('VOTE_CLOSED', 'đợt đã chốt hoặc đã hủy');
  end if;
  if v_kind not in ('STYLE', 'ADDON') then
    perform private.raise_err('INVALID_INPUT', 'loại lựa chọn');
  end if;
  if v_label is null or length(v_label) > 40 then
    perform private.raise_err('INVALID_INPUT', 'tên lựa chọn 1–40 ký tự');
  end if;
  if exists (select 1 from public.vote_session_options where vote_session_id = s.id and kind = v_kind::public.vote_option_kind and lower(label) = lower(v_label)) then
    perform private.raise_err('DUPLICATE_REFERENCE', v_label);
  end if;
  v_max := case when v_kind = 'STYLE' then 10 else 20 end;
  if (select count(*) from public.vote_session_options where vote_session_id = s.id and kind = v_kind::public.vote_option_kind) >= v_max then
    perform private.raise_err('INVALID_INPUT', 'đã đủ số lựa chọn tối đa');
  end if;
  insert into public.vote_session_options (vote_session_id, kind, label, sort_order)
  values (s.id, v_kind::public.vote_option_kind, v_label,
    coalesce((select max(sort_order) + 1 from public.vote_session_options where vote_session_id = s.id and kind = v_kind::public.vote_option_kind), 1));
  perform private.audit(v_admin.id, 'vote.option_add', 'vote_session', s.id::text, null, jsonb_build_object('kind', v_kind, 'label', v_label));
  return private.vote_options_json(s.id, true);
end;
$$;

-- Ẩn/hiện lựa chọn. Lựa chọn chưa ai chọn thì xóa hẳn khi p_hidden = true.
create or replace function api.admin_set_vote_option_hidden(p_option_id uuid, p_hidden boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
  o public.vote_session_options;
  s public.vote_sessions;
  v_used boolean;
begin
  select * into o from public.vote_session_options where id = p_option_id for update;
  if not found then
    perform private.raise_err('INVALID_INPUT', 'không tìm thấy lựa chọn');
  end if;
  select * into s from public.vote_sessions where id = o.vote_session_id for update;
  if private.vote_state(s) in ('CLOSED', 'CANCELLED') then
    perform private.raise_err('VOTE_CLOSED', 'đợt đã chốt hoặc đã hủy');
  end if;
  v_used := exists (select 1 from public.votes where style_option_id = o.id)
         or exists (select 1 from public.vote_addons where option_id = o.id);
  if coalesce(p_hidden, true) then
    if o.kind = 'STYLE' and (select count(*) from public.vote_session_options
        where vote_session_id = s.id and kind = 'STYLE' and not is_hidden and id <> o.id) = 0 then
      perform private.raise_err('INVALID_INPUT', 'Cần giữ ít nhất 1 kiểu pha');
    end if;
    if v_used then
      update public.vote_session_options set is_hidden = true where id = o.id;
    else
      delete from public.vote_session_options where id = o.id;
    end if;
  else
    update public.vote_session_options set is_hidden = false where id = o.id;
  end if;
  perform private.audit(v_admin.id, case when coalesce(p_hidden, true) then 'vote.option_hide' else 'vote.option_show' end,
    'vote_session', s.id::text, null, jsonb_build_object('label', o.label, 'kind', o.kind, 'used', v_used));
  return private.vote_options_json(s.id, true);
end;
$$;

-- Kéo dài / đổi giờ chốt của đợt chưa chốt
create or replace function api.admin_set_vote_cutoff(p_session_id uuid, p_cutoff_at timestamptz)
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
  if not found or private.vote_state(s) not in ('OPEN', 'UPCOMING', 'DRAFT') then
    perform private.raise_err('VOTE_CLOSED', 'đợt đã chốt hoặc đã hủy');
  end if;
  if p_cutoff_at is null or p_cutoff_at <= now() or p_cutoff_at <= s.opens_at then
    perform private.raise_err('INVALID_INPUT', 'giờ chốt mới phải ở tương lai và sau giờ mở');
  end if;
  update public.vote_sessions set cutoff_at = p_cutoff_at where id = s.id returning * into s;
  perform private.audit(v_admin.id, 'vote.cutoff', 'vote_session', s.id::text, null, jsonb_build_object('cutoff_at', p_cutoff_at));
  return private.vote_session_json(s, v_admin.id);
end;
$$;

-- "Dùng lại lựa chọn từ": 10 đợt gần nhất
create or replace function api.admin_vote_templates()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'service_date', s.service_date,
      'opens_at', s.opens_at, 'cutoff_at', s.cutoff_at, 'planned_brew_at', s.planned_brew_at,
      'allow_cups', s.allow_cups, 'options', private.vote_options_json(s.id)) order by s.created_at desc)
    from (select * from public.vote_sessions
          where exists (select 1 from public.vote_session_options o where o.vote_session_id = vote_sessions.id)
          order by created_at desc limit 10) s
  ), '[]'::jsonb);
end;
$$;

-- ───────────────────────── Vote ─────────────────────────

drop function api.cast_vote(uuid, text, text, int, text);

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

  insert into public.votes (vote_session_id, user_id, choice, coffee_type, cups, note, is_withdrawn, style_option_id)
  values (s.id, v.id, v_choice::public.vote_choice, v_type::public.coffee_type, v_cups, v_note, false, v_style)
  on conflict (vote_session_id, user_id) do update
    set choice = excluded.choice, coffee_type = excluded.coffee_type, cups = excluded.cups,
        note = excluded.note, is_withdrawn = false, style_option_id = excluded.style_option_id
  returning id into v_vote_id;
  delete from public.vote_addons where vote_id = v_vote_id;
  insert into public.vote_addons (vote_id, option_id) select v_vote_id, x from unnest(v_addons) x;
  return private.vote_session_json(s, v.id);
end;
$$;

-- Kết quả đợt: đếm theo lựa chọn, danh sách có tên (7A); admin thấy thêm người chưa vote
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
        'cups', vv.cups, 'note', vv.note, 'updated_at', vv.updated_at, 'is_me', vv.user_id = v.id)
        order by vv.choice desc, vv.updated_at)
      from public.votes vv join public.profiles p on p.id = vv.user_id
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

-- Home thành viên: đợt đang mở/sắp mở hôm nay + gợi ý điền sẵn từ phiếu gần nhất + đợt kế tiếp
create or replace function api.home()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.profiles := private.require_user();
  v_last public.votes;
  v_last_style text;
  v_last_addons jsonb;
begin
  select vv.* into v_last from public.votes vv
  where vv.user_id = v.id and not vv.is_withdrawn
  order by vv.updated_at desc limit 1;
  if found then
    v_last_style := private.vote_style_label(v_last);
    v_last_addons := private.vote_addon_labels(v_last.id);
  end if;

  return jsonb_build_object(
    'sessions', coalesce((
      select jsonb_agg(private.vote_session_json(s, v.id) || jsonb_build_object(
        'prefill', case when v_last.id is null then null else jsonb_build_object(
          'choice', v_last.choice,
          'cups', coalesce(v_last.cups, 1),
          'style_option_id', (select o.id from public.vote_session_options o
              where o.vote_session_id = s.id and o.kind = 'STYLE' and not o.is_hidden and lower(o.label) = lower(v_last_style) limit 1),
          'addon_ids', coalesce((select jsonb_agg(o.id) from public.vote_session_options o
              where o.vote_session_id = s.id and o.kind = 'ADDON' and not o.is_hidden
                and lower(o.label) in (select lower(x) from jsonb_array_elements_text(v_last_addons) x)), '[]'::jsonb)
        ) end
      ) order by s.cutoff_at)
      from public.vote_sessions s
      where s.status = 'PUBLISHED' and private.vote_state(s) in ('OPEN', 'UPCOMING')
        and s.opens_at < now() + interval '12 hours'
    ), '[]'::jsonb),
    'next', (
      select jsonb_build_object('id', s.id, 'name', s.name, 'opens_at', s.opens_at, 'cutoff_at', s.cutoff_at)
      from public.vote_sessions s
      where s.status = 'PUBLISHED' and s.closed_early_at is null and s.opens_at >= now() + interval '12 hours'
      order by s.opens_at limit 1
    ),
    'last_closed', (
      select private.vote_session_json(s, v.id)
      from public.vote_sessions s
      where s.status = 'PUBLISHED' and private.vote_state(s) = 'CLOSED' and s.service_date >= private.vn_today() - 1
      order by coalesce(s.closed_early_at, s.cutoff_at) desc limit 1
    )
  );
end;
$$;

grant execute on function api.admin_create_vote_session(text, date, timestamptz, timestamptz, timestamptz, boolean, text[], text[], boolean, uuid) to authenticated;
grant execute on function api.cast_vote(uuid, text, text, int, text, uuid, uuid[]) to authenticated;
grant execute on function api.admin_add_vote_option(uuid, text, text) to authenticated;
grant execute on function api.admin_set_vote_option_hidden(uuid, boolean) to authenticated;
grant execute on function api.admin_set_vote_cutoff(uuid, timestamptz) to authenticated;
grant execute on function api.admin_vote_templates() to authenticated;
grant execute on function api.home() to authenticated;
revoke all on function private.clean_labels(text[], int, text), private.vote_options_json(uuid, boolean),
  private.vote_style_label(public.votes), private.vote_addon_labels(uuid), private.my_vote_json(uuid, uuid),
  private.seed_vote_options(uuid, text[], text[], uuid) from public, anon, authenticated;

-- Xuất Excel: sheet Vote có thêm Kiểu pha, Đồ đi kèm (phần còn lại giữ nguyên bản 000009)
create or replace function api.admin_export_data(p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
  v_rows bigint;
begin
  if p_from is null or p_to is null or p_to < p_from then
    perform private.raise_err('INVALID_INPUT', 'kỳ không hợp lệ');
  end if;
  if p_to > (p_from + interval '12 months')::date then
    perform private.raise_err('INVALID_INPUT', 'kỳ tối đa 12 tháng');
  end if;
  select count(*) into v_rows from public.member_ledger where occurred_on between p_from and p_to;
  if v_rows > 20000 then
    perform private.raise_err('INVALID_INPUT', 'quá 20.000 dòng, hãy thu hẹp kỳ');
  end if;
  perform private.audit(v_admin.id, 'export.xlsx', 'report', null, null,
    jsonb_build_object('from', p_from, 'to', p_to));
  return jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'overview', api.admin_overview(p_from, p_to),
    'members', private.member_balance_rows(p_from, p_to),
    'deposits', coalesce((
      select jsonb_agg(jsonb_build_object('occurred_on', e.occurred_on, 'employee_code', p.employee_code,
        'display_name', p.display_name, 'amount_vnd', c.amount_vnd, 'external_ref', coalesce(e.external_ref, o.external_ref),
        'kind', e.kind, 'status', e.status, 'note', coalesce(e.note, e.reason)) order by e.occurred_on, e.created_at)
      from public.cash_ledger c join public.fund_events e on e.id = c.event_id
      left join public.fund_events o on o.id = e.reverses_event_id
      left join public.profiles p on p.id = e.subject_user_id
      where c.entry_type in ('DEPOSIT_IN', 'REIMBURSEMENT_OUT') and c.occurred_on between p_from and p_to), '[]'::jsonb),
    'gifts', coalesce((
      select jsonb_agg(jsonb_build_object('occurred_on', e.occurred_on, 'amount_vnd', c.amount_vnd,
        'share_count', coalesce(e.share_count, o.share_count), 'external_ref', coalesce(e.external_ref, o.external_ref),
        'kind', e.kind, 'status', e.status, 'note', coalesce(e.note, e.reason)) order by e.occurred_on, e.created_at)
      from public.cash_ledger c join public.fund_events e on e.id = c.event_id
      left join public.fund_events o on o.id = e.reverses_event_id
      where c.entry_type = 'GIFT_IN' and c.occurred_on between p_from and p_to), '[]'::jsonb),
    'purchases', coalesce((
      select jsonb_agg(jsonb_build_object('occurred_on', m.occurred_on, 'external_ref', pu.external_ref,
        'shop', pu.shop, 'paid_by', pu.paid_by, 'payer', (select x.display_name from public.profiles x where x.id = pu.payer_user_id),
        'total_vnd', pu.total_amount_vnd, 'employee_code', p.employee_code, 'display_name', p.display_name,
        'entry_type', m.entry_type, 'amount_vnd', m.amount_vnd, 'is_reversal', m.reverses_entry_id is not null)
        order by m.occurred_on, pu.external_ref, m.entry_type, p.employee_code)
      from public.member_ledger m
      join public.fund_events e on e.id = m.event_id
      join public.purchases pu on pu.fund_event_id = coalesce(e.reverses_event_id, e.id)
      join public.profiles p on p.id = m.user_id
      where m.entry_type in ('PURCHASE_SHARE', 'PURCHASE_CREDIT') and m.occurred_on between p_from and p_to), '[]'::jsonb),
    'purchase_lines', coalesce((
      select jsonb_agg(jsonb_build_object('purchased_on', pu.purchased_on, 'external_ref', pu.external_ref,
        'line_no', i.line_no, 'line_type', i.line_type, 'item_name', i.item_name, 'quantity', i.quantity,
        'unit', i.unit, 'line_amount_vnd', i.line_amount_vnd) order by pu.purchased_on, pu.external_ref, i.line_no)
      from public.purchase_items i join public.purchases pu on pu.id = i.purchase_id
      where pu.purchased_on between p_from and p_to), '[]'::jsonb),
    'votes', coalesce((
      select jsonb_agg(jsonb_build_object('service_date', s.service_date, 'session', s.name,
        'state', private.vote_state(s), 'employee_code', p.employee_code, 'display_name', p.display_name,
        'choice', v.choice, 'coffee_type', v.coffee_type, 'style', private.vote_style_label(v),
        'addons', private.vote_addon_labels(v.id), 'cups', v.cups, 'note', v.note)
        order by s.service_date, s.opens_at, p.employee_code)
      from public.votes v join public.vote_sessions s on s.id = v.vote_session_id
      join public.profiles p on p.id = v.user_id
      where not v.is_withdrawn and s.service_date between p_from and p_to), '[]'::jsonb)
  );
end;
$$;

notify pgrst, 'reload schema';

commit;
