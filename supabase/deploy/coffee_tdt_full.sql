-- ============================================================================
-- Coffee TDT — toàn bộ schema + hàm RPC + bảo mật (SINH TỰ ĐỘNG, đừng sửa tay)
-- Nguồn: supabase/migrations/*.sql · Sinh lại: npm run db:bundle
--
-- CÁCH DÙNG (project Supabase MỚI, chạy 1 lần):
--   1. Supabase Dashboard → SQL Editor → New query → dán toàn bộ file → Run.
--      Chạy trong 1 transaction: lỗi ở đâu thì không có gì được tạo.
--   2. Settings → API → "Exposed schemas": thêm  api   (giữ public, graphql_public).
--   3. Authentication → Sign In / Providers: tắt "Allow new users to sign up",
--      Email: tắt "Confirm email"; đặt độ dài mật khẩu tối thiểu ≥ 8.
--   4. Tạo admin đầu tiên: xem supabase/deploy/seed_first_admin.sql.
-- ============================================================================

begin;

-- ────────────────────────────────────────────────────────────────────────────
-- 20260925000001_schema.sql
-- ────────────────────────────────────────────────────────────────────────────
-- Coffee TDT — schema dữ liệu (DEV plan v2 §3, sổ quyết định v2 #1-#13)
-- Tiền: bigint VND. Ngày nghiệp vụ: date theo giờ Việt Nam. Thời điểm: timestamptz.

create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;

create schema if not exists api;
create schema if not exists private;

-- ───────────────────────── Enum ─────────────────────────
create type public.user_role as enum ('MEMBER', 'ADMIN');
create type public.user_status as enum ('ACTIVE', 'DISABLED');
create type public.fund_event_kind as enum ('DEPOSIT', 'GIFT', 'PURCHASE_FUND', 'PURCHASE_MEMBER', 'REIMBURSEMENT', 'REVERSAL');
create type public.fund_event_status as enum ('POSTED', 'REVERSED');
create type public.purchase_paid_by as enum ('FUND', 'MEMBER');
create type public.purchase_line_type as enum ('ITEM', 'FEE', 'DISCOUNT');
-- Dòng đảo giữ entry_type gốc, ngược dấu (quyết định 9A) → không có giá trị REVERSAL.
create type public.member_entry_type as enum ('DEPOSIT_CREDIT', 'GIFT_SHARE', 'PURCHASE_SHARE', 'PURCHASE_CREDIT', 'REIMBURSEMENT_DEBIT');
create type public.cash_entry_type as enum ('DEPOSIT_IN', 'GIFT_IN', 'PURCHASE_OUT', 'REIMBURSEMENT_OUT');
create type public.vote_session_status as enum ('DRAFT', 'PUBLISHED', 'CANCELLED');
create type public.vote_choice as enum ('YES', 'NO');
create type public.coffee_type as enum ('MACHINE', 'PHIN', 'UNDECIDED');
create type public.import_kind as enum ('MEMBERS', 'DEPOSITS', 'GIFTS', 'PURCHASES', 'REIMBURSEMENTS');
create type public.import_status as enum ('UPLOADED', 'HAS_ERRORS', 'READY', 'STALE', 'COMMITTED', 'DISCARDED');

-- ───────────────────────── Tài khoản ─────────────────────────
-- profiles.id = auth.users.id (quyết định 11A: Supabase Auth, không lưu password_hash)
create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  employee_code text not null unique check (employee_code ~ '^[A-Za-z0-9._-]{1,32}$'),
  username text not null unique check (username ~ '^[a-z0-9._-]{3,32}$'),
  display_name text not null check (length(btrim(display_name)) between 1 and 100),
  role public.user_role not null default 'MEMBER',
  status public.user_status not null default 'ACTIVE',
  must_change_password boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Membership theo NGÀY, khoảng nửa mở [start_date, end_date) (quyết định 3C)
create table public.fund_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete restrict,
  start_date date not null,
  end_date date null,
  reason text not null check (length(btrim(reason)) > 0),
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles (id) on delete restrict,
  updated_at timestamptz not null default now(),
  constraint fund_memberships_dates_chk check (end_date is null or end_date > start_date),
  constraint fund_memberships_no_overlap exclude using gist (
    user_id with =,
    daterange(start_date, end_date, '[)') with &&
  )
);
create index fund_memberships_dates_idx on public.fund_memberships (start_date, end_date);

-- ───────────────────────── Import (staging) ─────────────────────────
create table public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  kind public.import_kind not null,
  file_name text not null,
  file_checksum text not null check (file_checksum ~ '^[0-9a-f]{64}$'),
  status public.import_status not null default 'UPLOADED',
  row_count int not null default 0,
  error_count int not null default 0,
  preview_hash text null,
  summary jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  committed_at timestamptz null
);
-- Một file chỉ được commit một lần cho mỗi loại import
create unique index import_jobs_committed_file_uq on public.import_jobs (kind, file_checksum) where status = 'COMMITTED';

create table public.import_rows (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.import_jobs (id) on delete cascade,
  row_no int not null check (row_no > 0),
  data jsonb not null,
  normalized jsonb null,
  errors jsonb not null default '[]'::jsonb,
  unique (job_id, row_no)
);

-- ───────────────────────── Sổ quỹ ─────────────────────────
create table public.fund_events (
  id uuid primary key default gen_random_uuid(),
  kind public.fund_event_kind not null,
  amount_vnd bigint not null check (amount_vnd > 0 and amount_vnd <= 1000000000000),
  occurred_on date not null,
  actor_user_id uuid not null references public.profiles (id) on delete restrict,
  subject_user_id uuid null references public.profiles (id) on delete restrict,
  idempotency_key uuid not null unique,
  external_ref text null check (external_ref is null or length(btrim(external_ref)) between 1 and 64),
  status public.fund_event_status not null default 'POSTED',
  reverses_event_id uuid null unique references public.fund_events (id) on delete restrict,
  reason text null,
  note text null check (note is null or length(note) <= 500),
  share_count int null check (share_count is null or share_count > 0),
  payload_hash text null,
  import_job_id uuid null references public.import_jobs (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint fund_events_reversal_chk check (
    (kind = 'REVERSAL' and reverses_event_id is not null and reason is not null and length(btrim(reason)) > 0)
    or (kind <> 'REVERSAL' and reverses_event_id is null)
  ),
  constraint fund_events_subject_chk check (
    kind not in ('DEPOSIT', 'PURCHASE_MEMBER', 'REIMBURSEMENT') or subject_user_id is not null
  )
);
create unique index fund_events_kind_ref_uq on public.fund_events (kind, external_ref) where external_ref is not null;
create index fund_events_occurred_idx on public.fund_events (occurred_on, kind);

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  fund_event_id uuid not null unique references public.fund_events (id) on delete restrict,
  external_ref text null,
  purchased_on date not null,
  paid_by public.purchase_paid_by not null,
  payer_user_id uuid null references public.profiles (id) on delete restrict,
  shop text null check (shop is null or length(shop) <= 200),
  total_amount_vnd bigint not null check (total_amount_vnd > 0),
  notes text null check (notes is null or length(notes) <= 500),
  created_at timestamptz not null default now(),
  constraint purchases_payer_chk check ((paid_by = 'MEMBER') = (payer_user_id is not null))
);
create unique index purchases_external_ref_uq on public.purchases (external_ref) where external_ref is not null;
create index purchases_purchased_on_idx on public.purchases (purchased_on);

create table public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases (id) on delete restrict,
  line_no int not null check (line_no > 0),
  line_type public.purchase_line_type not null,
  item_name text not null check (length(btrim(item_name)) between 1 and 200),
  quantity numeric(18, 3) null check (quantity is null or quantity > 0),
  unit text null check (unit is null or length(unit) <= 32),
  line_amount_vnd bigint not null,
  unique (purchase_id, line_no),
  constraint purchase_items_sign_chk check (
    (line_type = 'DISCOUNT' and line_amount_vnd < 0)
    or (line_type <> 'DISCOUNT' and line_amount_vnd >= 0)
  )
);

create table public.cash_ledger (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.fund_events (id) on delete restrict,
  entry_type public.cash_entry_type not null,
  amount_vnd bigint not null check (amount_vnd <> 0),
  occurred_on date not null,
  reverses_entry_id uuid null unique references public.cash_ledger (id) on delete restrict,
  created_at timestamptz not null default now()
);
-- Mỗi event có 0 hoặc 1 dòng cash
create unique index cash_ledger_event_uq on public.cash_ledger (event_id);
create index cash_ledger_occurred_idx on public.cash_ledger (occurred_on, id);

create table public.member_ledger (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.fund_events (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete restrict,
  entry_type public.member_entry_type not null,
  amount_vnd bigint not null check (amount_vnd <> 0),
  occurred_on date not null,
  reverses_entry_id uuid null unique references public.member_ledger (id) on delete restrict,
  created_at timestamptz not null default now()
);
create index member_ledger_user_idx on public.member_ledger (user_id, occurred_on, id);
create index member_ledger_event_idx on public.member_ledger (event_id);

-- ───────────────────────── Vote ─────────────────────────
create table public.vote_sessions (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 100),
  service_date date not null,
  opens_at timestamptz not null,
  cutoff_at timestamptz not null,
  planned_brew_at timestamptz null,
  status public.vote_session_status not null default 'DRAFT',
  closed_early_at timestamptz null,
  cancel_reason text null,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vote_sessions_window_chk check (cutoff_at > opens_at)
);
create index vote_sessions_service_idx on public.vote_sessions (service_date, opens_at);
create index vote_sessions_status_idx on public.vote_sessions (status, cutoff_at);

create table public.votes (
  id uuid primary key default gen_random_uuid(),
  vote_session_id uuid not null references public.vote_sessions (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete restrict,
  choice public.vote_choice not null,
  coffee_type public.coffee_type null,
  cups int null check (cups is null or cups between 1 and 20),
  is_withdrawn boolean not null default false,
  note text null check (note is null or length(note) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (vote_session_id, user_id),
  constraint votes_choice_chk check (
    (choice = 'NO' and coffee_type is null and cups is null)
    or (choice = 'YES' and coffee_type is not null and cups is not null)
  )
);

-- ───────────────────────── Audit & đối soát ─────────────────────────
create table public.audit_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_user_id uuid null references public.profiles (id) on delete restrict,
  action text not null,
  entity_type text not null,
  entity_id text null,
  before jsonb null,
  after jsonb null,
  reason text null,
  request_id text null
);
create index audit_events_occurred_idx on public.audit_events (occurred_at desc);

create table public.reconciliation_runs (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default now(),
  source text not null,
  cash_total bigint not null,
  member_total bigint not null,
  diff bigint not null,
  bad_events jsonb not null default '[]'::jsonb
);

-- ────────────────────────────────────────────────────────────────────────────
-- 20260925000002_integrity.sql
-- ────────────────────────────────────────────────────────────────────────────
-- Ràng buộc toàn vẹn sổ: bất biến Σmember = Σcash mỗi event, sổ chỉ ghi thêm.

create or replace function private.raise_err(p_code text, p_detail text default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'P0001', message = p_code, detail = coalesce(p_detail, '');
end;
$$;

-- Chặn UPDATE/DELETE trên bảng chỉ-ghi-thêm
create or replace function private.forbid_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'P0001', message = 'LEDGER_IMMUTABLE',
    detail = format('%s trên %s bị cấm', tg_op, tg_table_name);
end;
$$;

create trigger cash_ledger_immutable before update or delete on public.cash_ledger
  for each row execute function private.forbid_mutation();
create trigger member_ledger_immutable before update or delete on public.member_ledger
  for each row execute function private.forbid_mutation();
create trigger purchases_immutable before update or delete on public.purchases
  for each row execute function private.forbid_mutation();
create trigger purchase_items_immutable before update or delete on public.purchase_items
  for each row execute function private.forbid_mutation();
create trigger audit_events_immutable before update or delete on public.audit_events
  for each row execute function private.forbid_mutation();
create trigger reconciliation_runs_immutable before update or delete on public.reconciliation_runs
  for each row execute function private.forbid_mutation();

-- fund_events: chỉ cho phép chuyển status POSTED → REVERSED, mọi cột khác giữ nguyên
create or replace function private.fund_events_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = 'P0001', message = 'LEDGER_IMMUTABLE', detail = 'DELETE fund_events bị cấm';
  end if;
  if old.status = 'POSTED' and new.status = 'REVERSED'
     and (to_jsonb(new) - 'status') = (to_jsonb(old) - 'status') then
    return new;
  end if;
  raise exception using errcode = 'P0001', message = 'LEDGER_IMMUTABLE', detail = 'Chỉ được đổi status POSTED → REVERSED';
end;
$$;

create trigger fund_events_guard before update or delete on public.fund_events
  for each row execute function private.fund_events_guard();

-- Bất biến: mỗi event có ≥1 dòng member và Σmember = Σcash. Kiểm lúc COMMIT.
create or replace function private.check_event_balance(p_event_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_member bigint;
  v_member_rows int;
  v_cash bigint;
begin
  select coalesce(sum(amount_vnd), 0), count(*) into v_member, v_member_rows
    from public.member_ledger where event_id = p_event_id;
  select coalesce(sum(amount_vnd), 0) into v_cash
    from public.cash_ledger where event_id = p_event_id;
  if v_member_rows = 0 or v_member <> v_cash then
    raise exception using errcode = 'P0001', message = 'INVARIANT_VIOLATION',
      detail = format('event %s: member=%s (%s dòng), cash=%s', p_event_id, v_member, v_member_rows, v_cash);
  end if;
end;
$$;

create or replace function private.check_event_balance_trg()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'fund_events' then
    perform private.check_event_balance(new.id);
  else
    perform private.check_event_balance(new.event_id);
  end if;
  return null;
end;
$$;

create constraint trigger fund_events_balance after insert on public.fund_events
  deferrable initially deferred for each row execute function private.check_event_balance_trg();
create constraint trigger cash_ledger_balance after insert on public.cash_ledger
  deferrable initially deferred for each row execute function private.check_event_balance_trg();
create constraint trigger member_ledger_balance after insert on public.member_ledger
  deferrable initially deferred for each row execute function private.check_event_balance_trg();

-- updated_at tự động cho bảng có sửa
create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_updated_at();
create trigger fund_memberships_touch before update on public.fund_memberships
  for each row execute function private.touch_updated_at();
create trigger vote_sessions_touch before update on public.vote_sessions
  for each row execute function private.touch_updated_at();
create trigger votes_touch before update on public.votes
  for each row execute function private.touch_updated_at();
create trigger import_jobs_touch before update on public.import_jobs
  for each row execute function private.touch_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- 20260925000003_private_helpers.sql
-- ────────────────────────────────────────────────────────────────────────────
-- Hàm nội bộ (schema private, không expose qua API). Logic tiền chỉ nằm ở đây.

create or replace function private.vn_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Asia/Ho_Chi_Minh')::date;
$$;

create or replace function private.request_id()
returns text
language plpgsql
stable
set search_path = ''
as $$
begin
  return nullif(current_setting('request.headers', true), '')::json ->> 'x-request-id';
exception when others then
  return null;
end;
$$;

create or replace function private.audit(
  p_actor uuid, p_action text, p_entity_type text, p_entity_id text,
  p_before jsonb default null, p_after jsonb default null, p_reason text default null
)
returns void
language sql
set search_path = ''
as $$
  insert into public.audit_events (actor_user_id, action, entity_type, entity_id, before, after, reason, request_id)
  values (p_actor, p_action, p_entity_type, p_entity_id, p_before, p_after, p_reason, private.request_id());
$$;

-- Người gọi hiện tại: phải đăng nhập, ACTIVE, đã đổi mật khẩu (trừ khi cho phép)
create or replace function private.require_user(p_allow_must_change boolean default false)
returns public.profiles
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v public.profiles;
begin
  if v_uid is null then
    perform private.raise_err('INSUFFICIENT_PERMISSION', 'chưa đăng nhập');
  end if;
  select * into v from public.profiles where id = v_uid;
  if not found then
    perform private.raise_err('INSUFFICIENT_PERMISSION', 'không có hồ sơ');
  end if;
  if v.status = 'DISABLED' then
    perform private.raise_err('ACCOUNT_DISABLED');
  end if;
  if v.must_change_password and not p_allow_must_change then
    perform private.raise_err('MUST_CHANGE_PASSWORD');
  end if;
  return v;
end;
$$;

create or replace function private.require_admin()
returns public.profiles
language plpgsql
stable
set search_path = ''
as $$
declare
  v public.profiles := private.require_user();
begin
  if v.role <> 'ADMIN' then
    perform private.raise_err('INSUFFICIENT_PERMISSION', 'cần quyền quản trị');
  end if;
  return v;
end;
$$;

-- Ngày nghiệp vụ hợp lệ: không null, không ở tương lai (giờ VN) — quyết định 13b
create or replace function private.validate_business_date(p_date date)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_date is null then
    perform private.raise_err('INVALID_INPUT', 'occurred_on bắt buộc');
  end if;
  if p_date > private.vn_today() then
    perform private.raise_err('FUTURE_DATE', p_date::text);
  end if;
  if p_date < date '2000-01-01' then
    perform private.raise_err('INVALID_INPUT', 'ngày quá xa');
  end if;
end;
$$;

create or replace function private.validate_amount(p_amount bigint)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_amount is null or p_amount <= 0 or p_amount > 1000000000000 then
    perform private.raise_err('INVALID_INPUT', 'amount_vnd phải là số nguyên dương');
  end if;
end;
$$;

create or replace function private.clean_text(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(p), '');
$$;

-- Thành viên quỹ hiệu lực tại ngày d, thứ tự ổn định employee_code, id
create or replace function private.members_on(p_date date)
returns uuid[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(p.id order by p.employee_code, p.id), '{}'::uuid[])
  from public.fund_memberships m
  join public.profiles p on p.id = m.user_id
  where m.start_date <= p_date and (m.end_date is null or p_date < m.end_date);
$$;

-- Chia đều: q = floor(x/N), r = x mod N, r người đầu +1đ. Tổng luôn đúng bằng x.
create or replace function private.allocate(p_total bigint, p_members uuid[])
returns table (user_id uuid, ord int, amount bigint)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_n bigint := coalesce(cardinality(p_members), 0);
begin
  if v_n = 0 then
    perform private.raise_err('NO_ACTIVE_MEMBERS');
  end if;
  if p_total is null or p_total <= 0 then
    perform private.raise_err('INVALID_INPUT', 'tổng phải > 0');
  end if;
  return query
    select t.m, t.i::int, (p_total / v_n) + case when t.i <= p_total % v_n then 1 else 0 end
    from unnest(p_members) with ordinality as t (m, i)
    order by t.i;
end;
$$;

create or replace function private.balance_of(p_user uuid, p_as_of date default null)
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(amount_vnd), 0)::bigint from public.member_ledger
  where user_id = p_user and (p_as_of is null or occurred_on <= p_as_of);
$$;

-- Chuẩn hóa dòng phiếu mua. Trả mảng jsonb có line_no, lỗi → INVALID_INPUT.
create or replace function private.normalize_lines(p_lines jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_line jsonb;
  v_idx int := 0;
  v_type text;
  v_name text;
  v_qty numeric;
  v_unit text;
  v_amount numeric;
  v_out jsonb := '[]'::jsonb;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    perform private.raise_err('INVALID_INPUT', 'phiếu phải có ít nhất 1 dòng');
  end if;
  if jsonb_array_length(p_lines) > 100 then
    perform private.raise_err('INVALID_INPUT', 'tối đa 100 dòng');
  end if;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_idx := v_idx + 1;
    if jsonb_typeof(v_line) <> 'object' then
      perform private.raise_err('INVALID_INPUT', format('dòng %s không hợp lệ', v_idx));
    end if;
    v_type := upper(coalesce(v_line ->> 'line_type', 'ITEM'));
    if v_type not in ('ITEM', 'FEE', 'DISCOUNT') then
      perform private.raise_err('INVALID_INPUT', format('dòng %s: loại dòng không hợp lệ', v_idx));
    end if;
    v_name := private.clean_text(v_line ->> 'item_name');
    if v_name is null or length(v_name) > 200 then
      perform private.raise_err('INVALID_INPUT', format('dòng %s: thiếu tên mặt hàng', v_idx));
    end if;
    if jsonb_typeof(v_line -> 'line_amount_vnd') is distinct from 'number' then
      perform private.raise_err('INVALID_INPUT', format('dòng %s: số tiền phải là số', v_idx));
    end if;
    v_amount := (v_line ->> 'line_amount_vnd')::numeric;
    if v_amount <> trunc(v_amount) or abs(v_amount) > 1000000000000 then
      perform private.raise_err('INVALID_INPUT', format('dòng %s: số tiền phải là số nguyên VND', v_idx));
    end if;
    if (v_type = 'DISCOUNT' and v_amount >= 0) or (v_type <> 'DISCOUNT' and v_amount < 0) then
      perform private.raise_err('INVALID_INPUT', format('dòng %s: giảm giá phải âm, các dòng khác không âm', v_idx));
    end if;
    v_qty := null;
    if v_line ? 'quantity' and jsonb_typeof(v_line -> 'quantity') = 'number' then
      v_qty := round((v_line ->> 'quantity')::numeric, 3);
      if v_qty <= 0 then
        perform private.raise_err('INVALID_INPUT', format('dòng %s: số lượng phải > 0', v_idx));
      end if;
    elsif v_line ? 'quantity' and jsonb_typeof(v_line -> 'quantity') not in ('null') then
      perform private.raise_err('INVALID_INPUT', format('dòng %s: số lượng phải là số', v_idx));
    end if;
    v_unit := private.clean_text(v_line ->> 'unit');
    if v_unit is not null and length(v_unit) > 32 then
      perform private.raise_err('INVALID_INPUT', format('dòng %s: đơn vị quá dài', v_idx));
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'line_no', v_idx, 'line_type', v_type, 'item_name', v_name,
      'quantity', v_qty, 'unit', v_unit, 'line_amount_vnd', v_amount::bigint
    ));
  end loop;
  return v_out;
end;
$$;

create or replace function private.lines_total(p_lines jsonb)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select coalesce(sum((l ->> 'line_amount_vnd')::bigint), 0)::bigint from jsonb_array_elements(p_lines) l;
$$;

-- Hash của bản preview đã xác nhận. Đổi membership/dòng/ngày → hash khác → MEMBERSHIP_CHANGED.
create or replace function private.purchase_hash(
  p_occurred_on date, p_paid_by text, p_payer uuid, p_members uuid[], p_lines jsonb
)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(concat_ws('|',
    'PURCHASE', p_occurred_on::text, p_paid_by, coalesce(p_payer::text, '-'),
    array_to_string(p_members, ','), p_lines::text), 'UTF8')), 'hex');
$$;

create or replace function private.gift_hash(p_occurred_on date, p_amount bigint, p_members uuid[])
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(concat_ws('|',
    'GIFT', p_occurred_on::text, p_amount::text, array_to_string(p_members, ',')), 'UTF8')), 'hex');
$$;

-- Khóa theo idempotency key; trả event đã có (nếu cùng loại) hoặc null
create or replace function private.idem_lookup(p_idem uuid, p_kind public.fund_event_kind)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_kind public.fund_event_kind;
begin
  if p_idem is null then
    perform private.raise_err('INVALID_INPUT', 'idempotency_key bắt buộc');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_idem::text, 0));
  select id, kind into v_id, v_kind from public.fund_events where idempotency_key = p_idem;
  if v_id is null then
    return null;
  end if;
  if v_kind <> p_kind and not (p_kind in ('PURCHASE_FUND', 'PURCHASE_MEMBER') and v_kind in ('PURCHASE_FUND', 'PURCHASE_MEMBER')) then
    perform private.raise_err('DUPLICATE_REFERENCE', 'idempotency_key đã dùng cho giao dịch khác');
  end if;
  return v_id;
end;
$$;

create or replace function private.check_external_ref(p_kind public.fund_event_kind, p_ref text)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_ref is null then
    return;
  end if;
  if length(p_ref) > 64 then
    perform private.raise_err('INVALID_INPUT', 'mã chứng từ tối đa 64 ký tự');
  end if;
  if p_kind in ('PURCHASE_FUND', 'PURCHASE_MEMBER') then
    if exists (select 1 from public.purchases where external_ref = p_ref) then
      perform private.raise_err('DUPLICATE_REFERENCE', p_ref);
    end if;
  elsif exists (select 1 from public.fund_events where kind = p_kind and external_ref = p_ref) then
    perform private.raise_err('DUPLICATE_REFERENCE', p_ref);
  end if;
end;
$$;

create or replace function private.require_profile(p_user uuid, p_field text)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_user is null or not exists (select 1 from public.profiles where id = p_user) then
    perform private.raise_err('INVALID_INPUT', format('%s không tồn tại', p_field));
  end if;
end;
$$;

create or replace function private.event_result(p_event_id uuid, p_replayed boolean)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('event_id', e.id, 'kind', e.kind, 'amount_vnd', e.amount_vnd,
    'occurred_on', e.occurred_on, 'status', e.status, 'replayed', p_replayed,
    'purchase_id', (select p.id from public.purchases p where p.fund_event_id = e.id))
  from public.fund_events e where e.id = p_event_id;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 20260925000004_private_posting.sql
-- ────────────────────────────────────────────────────────────────────────────
-- Posting nội bộ: mỗi hàm chạy trong transaction của lệnh RPC gọi nó.
-- Được dùng chung bởi api.* (form) và import_commit (Excel) — không có bản sao logic tiền.

create or replace function private.post_deposit(
  p_actor uuid, p_idem uuid, p_user uuid, p_amount bigint, p_occurred_on date,
  p_external_ref text default null, p_note text default null, p_import_job uuid default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid := private.idem_lookup(p_idem, 'DEPOSIT');
  v_ref text := private.clean_text(p_external_ref);
begin
  if v_id is not null then
    return private.event_result(v_id, true);
  end if;
  perform private.validate_business_date(p_occurred_on);
  perform private.validate_amount(p_amount);
  perform private.require_profile(p_user, 'người nộp');
  perform private.check_external_ref('DEPOSIT', v_ref);

  insert into public.fund_events (kind, amount_vnd, occurred_on, actor_user_id, subject_user_id,
    idempotency_key, external_ref, note, import_job_id)
  values ('DEPOSIT', p_amount, p_occurred_on, p_actor, p_user, p_idem, v_ref, private.clean_text(p_note), p_import_job)
  returning id into v_id;

  insert into public.cash_ledger (event_id, entry_type, amount_vnd, occurred_on)
  values (v_id, 'DEPOSIT_IN', p_amount, p_occurred_on);
  insert into public.member_ledger (event_id, user_id, entry_type, amount_vnd, occurred_on)
  values (v_id, p_user, 'DEPOSIT_CREDIT', p_amount, p_occurred_on);

  perform private.audit(p_actor, 'fund.deposit', 'fund_event', v_id::text, null,
    jsonb_build_object('user_id', p_user, 'amount_vnd', p_amount, 'occurred_on', p_occurred_on, 'external_ref', v_ref));
  return private.event_result(v_id, false);
end;
$$;

create or replace function private.post_reimbursement(
  p_actor uuid, p_idem uuid, p_user uuid, p_amount bigint, p_occurred_on date,
  p_external_ref text default null, p_note text default null, p_import_job uuid default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid := private.idem_lookup(p_idem, 'REIMBURSEMENT');
  v_ref text := private.clean_text(p_external_ref);
begin
  if v_id is not null then
    return private.event_result(v_id, true);
  end if;
  perform private.validate_business_date(p_occurred_on);
  perform private.validate_amount(p_amount);
  perform private.require_profile(p_user, 'người nhận hoàn');
  perform private.check_external_ref('REIMBURSEMENT', v_ref);

  insert into public.fund_events (kind, amount_vnd, occurred_on, actor_user_id, subject_user_id,
    idempotency_key, external_ref, note, import_job_id)
  values ('REIMBURSEMENT', p_amount, p_occurred_on, p_actor, p_user, p_idem, v_ref, private.clean_text(p_note), p_import_job)
  returning id into v_id;

  insert into public.cash_ledger (event_id, entry_type, amount_vnd, occurred_on)
  values (v_id, 'REIMBURSEMENT_OUT', -p_amount, p_occurred_on);
  insert into public.member_ledger (event_id, user_id, entry_type, amount_vnd, occurred_on)
  values (v_id, p_user, 'REIMBURSEMENT_DEBIT', -p_amount, p_occurred_on);

  perform private.audit(p_actor, 'fund.reimbursement', 'fund_event', v_id::text, null,
    jsonb_build_object('user_id', p_user, 'amount_vnd', p_amount, 'occurred_on', p_occurred_on, 'external_ref', v_ref));
  return private.event_result(v_id, false);
end;
$$;

create or replace function private.post_gift(
  p_actor uuid, p_idem uuid, p_amount bigint, p_occurred_on date, p_preview_hash text,
  p_external_ref text default null, p_note text default null, p_import_job uuid default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid := private.idem_lookup(p_idem, 'GIFT');
  v_ref text := private.clean_text(p_external_ref);
  v_members uuid[];
  v_hash text;
begin
  if v_id is not null then
    return private.event_result(v_id, true);
  end if;
  perform private.validate_business_date(p_occurred_on);
  perform private.validate_amount(p_amount);
  perform private.check_external_ref('GIFT', v_ref);
  v_members := private.members_on(p_occurred_on);
  if cardinality(v_members) = 0 then
    perform private.raise_err('NO_ACTIVE_MEMBERS', p_occurred_on::text);
  end if;
  v_hash := private.gift_hash(p_occurred_on, p_amount, v_members);
  if p_preview_hash is null or p_preview_hash <> v_hash then
    perform private.raise_err('MEMBERSHIP_CHANGED');
  end if;

  insert into public.fund_events (kind, amount_vnd, occurred_on, actor_user_id, idempotency_key,
    external_ref, note, share_count, payload_hash, import_job_id)
  values ('GIFT', p_amount, p_occurred_on, p_actor, p_idem, v_ref, private.clean_text(p_note),
    cardinality(v_members), v_hash, p_import_job)
  returning id into v_id;

  insert into public.cash_ledger (event_id, entry_type, amount_vnd, occurred_on)
  values (v_id, 'GIFT_IN', p_amount, p_occurred_on);
  insert into public.member_ledger (event_id, user_id, entry_type, amount_vnd, occurred_on)
  select v_id, a.user_id, 'GIFT_SHARE', a.amount, p_occurred_on
  from private.allocate(p_amount, v_members) a
  where a.amount <> 0;

  perform private.audit(p_actor, 'fund.gift', 'fund_event', v_id::text, null,
    jsonb_build_object('amount_vnd', p_amount, 'occurred_on', p_occurred_on, 'share_count', cardinality(v_members), 'external_ref', v_ref));
  return private.event_result(v_id, false);
end;
$$;

-- Tính preview phiếu mua (dùng chung cho api.preview_purchase, post và import)
create or replace function private.purchase_plan(
  p_occurred_on date, p_paid_by text, p_payer uuid, p_lines jsonb
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_lines jsonb;
  v_total bigint;
  v_members uuid[];
  v_paid_by text := upper(coalesce(p_paid_by, ''));
begin
  perform private.validate_business_date(p_occurred_on);
  if v_paid_by not in ('FUND', 'MEMBER') then
    perform private.raise_err('INVALID_INPUT', 'paid_by phải là FUND hoặc MEMBER');
  end if;
  if v_paid_by = 'MEMBER' and p_payer is null then
    perform private.raise_err('INVALID_INPUT', 'cần chọn người mua hộ');
  end if;
  if v_paid_by = 'FUND' and p_payer is not null then
    perform private.raise_err('INVALID_INPUT', 'quỹ trả thì không có người mua hộ');
  end if;
  v_lines := private.normalize_lines(p_lines);
  v_total := private.lines_total(v_lines);
  if v_total <= 0 then
    perform private.raise_err('INVALID_INPUT', 'tổng phiếu phải > 0');
  end if;
  if v_total > 1000000000000 then
    perform private.raise_err('INVALID_INPUT', 'tổng phiếu quá lớn');
  end if;
  v_members := private.members_on(p_occurred_on);
  if cardinality(v_members) = 0 then
    perform private.raise_err('NO_ACTIVE_MEMBERS', p_occurred_on::text);
  end if;
  if v_paid_by = 'MEMBER' and not (p_payer = any (v_members)) then
    perform private.raise_err('PAYER_NOT_MEMBER');
  end if;
  return jsonb_build_object(
    'occurred_on', p_occurred_on,
    'paid_by', v_paid_by,
    'payer_user_id', p_payer,
    'lines', v_lines,
    'total', v_total,
    'members', to_jsonb(v_members),
    'preview_hash', private.purchase_hash(p_occurred_on, v_paid_by, p_payer, v_members, v_lines)
  );
end;
$$;

create or replace function private.post_purchase(
  p_actor uuid, p_idem uuid, p_occurred_on date, p_paid_by text, p_payer uuid, p_lines jsonb,
  p_preview_hash text, p_shop text default null, p_external_ref text default null,
  p_notes text default null, p_import_job uuid default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_kind public.fund_event_kind := case when upper(p_paid_by) = 'MEMBER' then 'PURCHASE_MEMBER' else 'PURCHASE_FUND' end;
  v_id uuid := private.idem_lookup(p_idem, v_kind);
  v_ref text := private.clean_text(p_external_ref);
  v_plan jsonb;
  v_members uuid[];
  v_total bigint;
  v_purchase_id uuid;
begin
  if v_id is not null then
    return private.event_result(v_id, true);
  end if;
  v_plan := private.purchase_plan(p_occurred_on, p_paid_by, p_payer, p_lines);
  perform private.check_external_ref(v_kind, v_ref);
  if p_preview_hash is null or p_preview_hash <> (v_plan ->> 'preview_hash') then
    perform private.raise_err('MEMBERSHIP_CHANGED');
  end if;
  v_total := (v_plan ->> 'total')::bigint;
  select array_agg(value::uuid order by ordinality) into v_members
    from jsonb_array_elements_text(v_plan -> 'members') with ordinality;

  insert into public.fund_events (kind, amount_vnd, occurred_on, actor_user_id, subject_user_id,
    idempotency_key, external_ref, note, share_count, payload_hash, import_job_id)
  values (v_kind, v_total, p_occurred_on, p_actor, p_payer, p_idem, v_ref, private.clean_text(p_notes),
    cardinality(v_members), v_plan ->> 'preview_hash', p_import_job)
  returning id into v_id;

  insert into public.purchases (fund_event_id, external_ref, purchased_on, paid_by, payer_user_id, shop, total_amount_vnd, notes)
  values (v_id, v_ref, p_occurred_on, (v_plan ->> 'paid_by')::public.purchase_paid_by, p_payer,
    private.clean_text(p_shop), v_total, private.clean_text(p_notes))
  returning id into v_purchase_id;

  insert into public.purchase_items (purchase_id, line_no, line_type, item_name, quantity, unit, line_amount_vnd)
  select v_purchase_id, (l ->> 'line_no')::int, (l ->> 'line_type')::public.purchase_line_type, l ->> 'item_name',
    (l ->> 'quantity')::numeric, l ->> 'unit', (l ->> 'line_amount_vnd')::bigint
  from jsonb_array_elements(v_plan -> 'lines') l;

  if v_kind = 'PURCHASE_FUND' then
    insert into public.cash_ledger (event_id, entry_type, amount_vnd, occurred_on)
    values (v_id, 'PURCHASE_OUT', -v_total, p_occurred_on);
  else
    insert into public.member_ledger (event_id, user_id, entry_type, amount_vnd, occurred_on)
    values (v_id, p_payer, 'PURCHASE_CREDIT', v_total, p_occurred_on);
  end if;

  insert into public.member_ledger (event_id, user_id, entry_type, amount_vnd, occurred_on)
  select v_id, a.user_id, 'PURCHASE_SHARE', -a.amount, p_occurred_on
  from private.allocate(v_total, v_members) a
  where a.amount <> 0;

  perform private.audit(p_actor, 'fund.purchase', 'fund_event', v_id::text, null,
    jsonb_build_object('purchase_id', v_purchase_id, 'paid_by', v_plan ->> 'paid_by', 'payer_user_id', p_payer,
      'total', v_total, 'occurred_on', p_occurred_on, 'share_count', cardinality(v_members), 'external_ref', v_ref));
  return private.event_result(v_id, false);
end;
$$;

-- Đảo: dòng đảo giữ entry_type gốc, ngược dấu, trỏ reverses_entry_id. Không đọc membership hiện tại.
create or replace function private.reverse_event(p_actor uuid, p_event_id uuid, p_reason text, p_idem uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid := private.idem_lookup(p_idem, 'REVERSAL');
  v_reason text := private.clean_text(p_reason);
  v_orig public.fund_events;
  v_today date := private.vn_today();
begin
  if v_id is not null then
    return private.event_result(v_id, true);
  end if;
  if v_reason is null or length(v_reason) > 500 then
    perform private.raise_err('INVALID_INPUT', 'lý do đảo bắt buộc (≤ 500 ký tự)');
  end if;
  select * into v_orig from public.fund_events where id = p_event_id for update;
  if not found then
    perform private.raise_err('INVALID_INPUT', 'không tìm thấy giao dịch');
  end if;
  if v_orig.status = 'REVERSED' then
    perform private.raise_err('ALREADY_REVERSED');
  end if;

  insert into public.fund_events (kind, amount_vnd, occurred_on, actor_user_id, subject_user_id,
    idempotency_key, status, reverses_event_id, reason)
  values ('REVERSAL', v_orig.amount_vnd, v_today, p_actor, v_orig.subject_user_id, p_idem, 'POSTED', v_orig.id, v_reason)
  returning id into v_id;

  insert into public.cash_ledger (event_id, entry_type, amount_vnd, occurred_on, reverses_entry_id)
  select v_id, c.entry_type, -c.amount_vnd, v_today, c.id
  from public.cash_ledger c where c.event_id = v_orig.id;

  insert into public.member_ledger (event_id, user_id, entry_type, amount_vnd, occurred_on, reverses_entry_id)
  select v_id, m.user_id, m.entry_type, -m.amount_vnd, v_today, m.id
  from public.member_ledger m where m.event_id = v_orig.id;

  update public.fund_events set status = 'REVERSED' where id = v_orig.id;

  perform private.audit(p_actor, 'fund.reverse', 'fund_event', v_orig.id::text,
    jsonb_build_object('status', 'POSTED', 'kind', v_orig.kind),
    jsonb_build_object('status', 'REVERSED', 'reversal_event_id', v_id), v_reason);
  return private.event_result(v_id, false);
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 20260925000005_api_accounts.sql
-- ────────────────────────────────────────────────────────────────────────────
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

-- ────────────────────────────────────────────────────────────────────────────
-- 20260925000006_api_fund.sql
-- ────────────────────────────────────────────────────────────────────────────
-- API: ghi tiền nộp / tiền cho thêm / hoàn tiền / mua đồ / đảo giao dịch (chỉ ADMIN).

-- Bảng phân bổ để hiển thị preview: ai chịu bao nhiêu, ai nhận +1đ, số dư trước/sau
create or replace function private.allocation_view(
  p_total bigint, p_members uuid[], p_sign int, p_payer uuid default null, p_as_of date default null
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', a.user_id, 'ord', a.ord, 'employee_code', p.employee_code,
      'display_name', p.display_name, 'share_vnd', p_sign * a.amount,
      'gets_extra_one', a.amount > (p_total / cardinality(p_members)),
      'credit_vnd', case when a.user_id = p_payer then p_total else 0 end,
      'balance_before_vnd', private.balance_of(a.user_id),
      'balance_after_vnd', private.balance_of(a.user_id) + p_sign * a.amount
        + case when a.user_id = p_payer then p_total else 0 end
    ) order by a.ord), '[]'::jsonb)
  from private.allocate(p_total, p_members) a
  join public.profiles p on p.id = a.user_id;
$$;

create or replace function private.split_info(p_total bigint, p_n int)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('n', p_n, 'base_share_vnd', p_total / p_n, 'remainder', p_total % p_n);
$$;

create or replace function api.post_deposit(
  p_idem_key uuid, p_user_id uuid, p_amount_vnd bigint, p_occurred_on date,
  p_external_ref text default null, p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
begin
  return private.post_deposit(v_admin.id, p_idem_key, p_user_id, p_amount_vnd, p_occurred_on, p_external_ref, p_note);
end;
$$;

create or replace function api.post_reimbursement(
  p_idem_key uuid, p_user_id uuid, p_amount_vnd bigint, p_occurred_on date,
  p_external_ref text default null, p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
begin
  return private.post_reimbursement(v_admin.id, p_idem_key, p_user_id, p_amount_vnd, p_occurred_on, p_external_ref, p_note);
end;
$$;

create or replace function api.preview_gift(p_amount_vnd bigint, p_occurred_on date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_members uuid[];
begin
  perform private.require_admin();
  perform private.validate_business_date(p_occurred_on);
  perform private.validate_amount(p_amount_vnd);
  v_members := private.members_on(p_occurred_on);
  if cardinality(v_members) = 0 then
    perform private.raise_err('NO_ACTIVE_MEMBERS', p_occurred_on::text);
  end if;
  return jsonb_build_object(
    'total_vnd', p_amount_vnd,
    'occurred_on', p_occurred_on,
    'split', private.split_info(p_amount_vnd, cardinality(v_members)),
    'members', private.allocation_view(p_amount_vnd, v_members, 1),
    'preview_hash', private.gift_hash(p_occurred_on, p_amount_vnd, v_members)
  );
end;
$$;

create or replace function api.post_gift(
  p_idem_key uuid, p_amount_vnd bigint, p_occurred_on date, p_preview_hash text,
  p_external_ref text default null, p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
begin
  return private.post_gift(v_admin.id, p_idem_key, p_amount_vnd, p_occurred_on, p_preview_hash, p_external_ref, p_note);
end;
$$;

create or replace function api.preview_purchase(
  p_occurred_on date, p_paid_by text, p_payer_user_id uuid, p_lines jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_plan jsonb;
  v_members uuid[];
  v_total bigint;
begin
  perform private.require_admin();
  v_plan := private.purchase_plan(p_occurred_on, p_paid_by, p_payer_user_id, p_lines);
  v_total := (v_plan ->> 'total')::bigint;
  select array_agg(value::uuid order by ordinality) into v_members
    from jsonb_array_elements_text(v_plan -> 'members') with ordinality;
  return jsonb_build_object(
    'occurred_on', p_occurred_on,
    'paid_by', v_plan ->> 'paid_by',
    'payer_user_id', p_payer_user_id,
    'lines', v_plan -> 'lines',
    'total_vnd', v_total,
    'split', private.split_info(v_total, cardinality(v_members)),
    'members', private.allocation_view(v_total, v_members, -1, p_payer_user_id),
    'fund_cash_change_vnd', case when v_plan ->> 'paid_by' = 'FUND' then -v_total else 0 end,
    'preview_hash', v_plan ->> 'preview_hash'
  );
end;
$$;

create or replace function api.post_purchase(
  p_idem_key uuid, p_occurred_on date, p_paid_by text, p_payer_user_id uuid, p_lines jsonb,
  p_preview_hash text, p_shop text default null, p_external_ref text default null, p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
begin
  return private.post_purchase(v_admin.id, p_idem_key, p_occurred_on, p_paid_by, p_payer_user_id, p_lines,
    p_preview_hash, p_shop, p_external_ref, p_notes);
end;
$$;

create or replace function api.reverse_event(p_event_id uuid, p_reason text, p_idem_key uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
begin
  return private.reverse_event(v_admin.id, p_event_id, p_reason, p_idem_key);
end;
$$;

-- Mô tả ngắn cho một event (dùng trong danh sách)
create or replace function private.event_json(e public.fund_events)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', e.id, 'kind', e.kind, 'amount_vnd', e.amount_vnd, 'occurred_on', e.occurred_on,
    'status', e.status, 'external_ref', e.external_ref, 'note', e.note, 'reason', e.reason,
    'share_count', e.share_count, 'created_at', e.created_at,
    'actor', (select p.display_name from public.profiles p where p.id = e.actor_user_id),
    'subject_user_id', e.subject_user_id,
    'subject', (select p.display_name from public.profiles p where p.id = e.subject_user_id),
    'reverses_event_id', e.reverses_event_id,
    'reverses_kind', (select o.kind from public.fund_events o where o.id = e.reverses_event_id),
    'reversed_by_event_id', (select r.id from public.fund_events r where r.reverses_event_id = e.id),
    'purchase_id', (select pu.id from public.purchases pu where pu.fund_event_id = e.id),
    'cash_delta_vnd', coalesce((select sum(c.amount_vnd) from public.cash_ledger c where c.event_id = e.id), 0),
    'import_job_id', e.import_job_id
  );
$$;

create or replace function api.admin_list_events(
  p_from date default null, p_to date default null, p_kind text default null,
  p_user_id uuid default null, p_limit int default 50, p_offset int default 0
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
      select e.* from public.fund_events e
      where (p_from is null or e.occurred_on >= p_from)
        and (p_to is null or e.occurred_on <= p_to)
        and (p_kind is null or e.kind::text = upper(p_kind))
        and (p_user_id is null or e.subject_user_id = p_user_id
             or exists (select 1 from public.member_ledger m where m.event_id = e.id and m.user_id = p_user_id))
    )
    select jsonb_build_object(
      'total', (select count(*) from f),
      'rows', coalesce((
        select jsonb_agg(private.event_json(x) order by x.occurred_on desc, x.created_at desc)
        from (select * from f order by occurred_on desc, created_at desc limit v_limit offset v_offset) x
      ), '[]'::jsonb)
    )
  );
end;
$$;

create or replace function api.admin_event_detail(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.fund_events;
begin
  perform private.require_admin();
  select * into v from public.fund_events where id = p_event_id;
  if not found then
    perform private.raise_err('INVALID_INPUT', 'không tìm thấy giao dịch');
  end if;
  return private.event_json(v) || jsonb_build_object(
    'cash_entries', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'entry_type', c.entry_type, 'amount_vnd', c.amount_vnd,
        'occurred_on', c.occurred_on, 'reverses_entry_id', c.reverses_entry_id))
      from public.cash_ledger c where c.event_id = v.id), '[]'::jsonb),
    'member_entries', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'user_id', m.user_id, 'employee_code', p.employee_code,
        'display_name', p.display_name, 'entry_type', m.entry_type, 'amount_vnd', m.amount_vnd,
        'reverses_entry_id', m.reverses_entry_id) order by p.employee_code, m.entry_type)
      from public.member_ledger m join public.profiles p on p.id = m.user_id where m.event_id = v.id), '[]'::jsonb)
  );
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 20260925000007_api_member_views.sql
-- ────────────────────────────────────────────────────────────────────────────
-- API cho thành viên: số dư, lịch sử, tổng quỹ, danh sách phiếu mua (quyết định 6A).

create or replace function private.cash_total(p_as_of date default null)
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(amount_vnd), 0)::bigint from public.cash_ledger
  where p_as_of is null or occurred_on <= p_as_of;
$$;

create or replace function private.breakdown(p_user uuid, p_from date default null, p_to date default null)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'DEPOSIT_CREDIT', coalesce(sum(amount_vnd) filter (where entry_type = 'DEPOSIT_CREDIT'), 0),
    'PURCHASE_CREDIT', coalesce(sum(amount_vnd) filter (where entry_type = 'PURCHASE_CREDIT'), 0),
    'GIFT_SHARE', coalesce(sum(amount_vnd) filter (where entry_type = 'GIFT_SHARE'), 0),
    'PURCHASE_SHARE', coalesce(sum(amount_vnd) filter (where entry_type = 'PURCHASE_SHARE'), 0),
    'REIMBURSEMENT_DEBIT', coalesce(sum(amount_vnd) filter (where entry_type = 'REIMBURSEMENT_DEBIT'), 0)
  )
  from public.member_ledger
  where user_id = p_user
    and (p_from is null or occurred_on >= p_from)
    and (p_to is null or occurred_on <= p_to);
$$;

create or replace function api.my_balance()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.profiles := private.require_user();
  v_today date := private.vn_today();
begin
  return jsonb_build_object(
    'balance_vnd', private.balance_of(v.id),
    'breakdown', private.breakdown(v.id),
    'is_member_today', v.id = any (private.members_on(v_today)),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object('start_date', m.start_date, 'end_date', m.end_date) order by m.start_date desc)
      from public.fund_memberships m where m.user_id = v.id), '[]'::jsonb),
    'as_of', v_today
  );
end;
$$;

create or replace function api.my_ledger(
  p_from date default null, p_to date default null, p_limit int default 50, p_offset int default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.profiles := private.require_user();
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
begin
  return (
    with f as (
      select m.*, e.kind, e.status as event_status, e.reason, e.note, e.reverses_event_id, e.share_count,
        coalesce(pu.id, opu.id) as purchase_id, coalesce(pu.shop, opu.shop) as shop
      from public.member_ledger m
      join public.fund_events e on e.id = m.event_id
      left join public.purchases pu on pu.fund_event_id = e.id
      left join public.purchases opu on opu.fund_event_id = e.reverses_event_id
      where m.user_id = v.id
        and (p_from is null or m.occurred_on >= p_from)
        and (p_to is null or m.occurred_on <= p_to)
    )
    select jsonb_build_object(
      'total', (select count(*) from f),
      'opening_balance_vnd', case when p_from is null then 0 else private.balance_of(v.id, p_from - 1) end,
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', x.id, 'event_id', x.event_id, 'entry_type', x.entry_type, 'amount_vnd', x.amount_vnd,
          'occurred_on', x.occurred_on, 'event_kind', x.kind, 'event_status', x.event_status,
          'is_reversal', x.reverses_entry_id is not null, 'reason', x.reason, 'note', x.note,
          'share_count', x.share_count, 'purchase_id', x.purchase_id, 'shop', x.shop
        ) order by x.occurred_on desc, x.created_at desc, x.id)
        from (select * from f order by occurred_on desc, created_at desc, id limit v_limit offset v_offset) x
      ), '[]'::jsonb)
    )
  );
end;
$$;

-- Tổng quỹ thực: thành viên được xem (6A)
create or replace function api.fund_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_user();
  return jsonb_build_object('cash_balance_vnd', private.cash_total(), 'as_of', private.vn_today());
end;
$$;

create or replace function private.purchase_json(pu public.purchases, p_viewer uuid, p_full boolean)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', pu.id, 'fund_event_id', pu.fund_event_id, 'external_ref', pu.external_ref,
    'purchased_on', pu.purchased_on, 'paid_by', pu.paid_by, 'payer_user_id', pu.payer_user_id,
    'payer', (select p.display_name from public.profiles p where p.id = pu.payer_user_id),
    'shop', pu.shop, 'total_vnd', pu.total_amount_vnd, 'notes', pu.notes,
    'share_count', e.share_count, 'status', e.status,
    'item_summary', (select string_agg(i.item_name, ', ' order by i.line_no) from public.purchase_items i
                     where i.purchase_id = pu.id and i.line_type = 'ITEM'),
    'my_share_vnd', coalesce((select sum(m.amount_vnd) from public.member_ledger m
      where m.event_id = e.id and m.user_id = p_viewer and m.entry_type = 'PURCHASE_SHARE'), 0),
    'my_credit_vnd', coalesce((select sum(m.amount_vnd) from public.member_ledger m
      where m.event_id = e.id and m.user_id = p_viewer and m.entry_type = 'PURCHASE_CREDIT'), 0)
  )
  from public.fund_events e where e.id = pu.fund_event_id;
$$;

create or replace function api.list_purchases(
  p_from date default null, p_to date default null, p_limit int default 50, p_offset int default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.profiles := private.require_user();
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
begin
  return (
    with f as (
      select pu.* from public.purchases pu
      where (p_from is null or pu.purchased_on >= p_from) and (p_to is null or pu.purchased_on <= p_to)
    )
    select jsonb_build_object(
      'total', (select count(*) from f),
      'rows', coalesce((
        select jsonb_agg(private.purchase_json(x, v.id, false) order by x.purchased_on desc, x.created_at desc)
        from (select * from f order by purchased_on desc, created_at desc limit v_limit offset v_offset) x
      ), '[]'::jsonb)
    )
  );
end;
$$;

-- Chi tiết phiếu: thành viên thấy dòng hàng, N người, phần của mình; admin thấy thêm bảng phân bổ
create or replace function api.purchase_detail(p_purchase_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.profiles := private.require_user();
  v_pu public.purchases;
  v_result jsonb;
begin
  select * into v_pu from public.purchases where id = p_purchase_id;
  if not found then
    perform private.raise_err('INVALID_INPUT', 'không tìm thấy phiếu');
  end if;
  v_result := private.purchase_json(v_pu, v.id, true) || jsonb_build_object(
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object('line_no', i.line_no, 'line_type', i.line_type, 'item_name', i.item_name,
        'quantity', i.quantity, 'unit', i.unit, 'line_amount_vnd', i.line_amount_vnd) order by i.line_no)
      from public.purchase_items i where i.purchase_id = v_pu.id), '[]'::jsonb),
    'split', (select private.split_info(v_pu.total_amount_vnd, e.share_count) from public.fund_events e where e.id = v_pu.fund_event_id),
    'reversal', (select jsonb_build_object('event_id', r.id, 'occurred_on', r.occurred_on, 'reason', r.reason)
                 from public.fund_events r where r.reverses_event_id = v_pu.fund_event_id)
  );
  if v.role = 'ADMIN' then
    v_result := v_result || jsonb_build_object('allocations', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'employee_code', p.employee_code,
        'display_name', p.display_name, 'entry_type', m.entry_type, 'amount_vnd', m.amount_vnd)
        order by m.entry_type desc, p.employee_code)
      from public.member_ledger m join public.profiles p on p.id = m.user_id
      where m.event_id = v_pu.fund_event_id), '[]'::jsonb));
  end if;
  return v_result;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 20260925000008_api_votes.sql
-- ────────────────────────────────────────────────────────────────────────────
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

-- ────────────────────────────────────────────────────────────────────────────
-- 20260925000009_api_reports.sql
-- ────────────────────────────────────────────────────────────────────────────
-- API báo cáo quản trị, đối soát, dữ liệu xuất Excel.

create or replace function private.bad_events()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('event_id', x.id, 'member_vnd', x.m, 'cash_vnd', x.c)), '[]'::jsonb)
  from (
    select e.id,
      coalesce((select sum(amount_vnd) from public.member_ledger m where m.event_id = e.id), 0) as m,
      coalesce((select sum(amount_vnd) from public.cash_ledger c where c.event_id = e.id), 0) as c
    from public.fund_events e
  ) x
  where x.m <> x.c;
$$;

create or replace function private.member_balance_rows(p_from date, p_to date)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with today as (select private.vn_today() as d),
  users as (
    select p.* from public.profiles p
    where exists (select 1 from public.member_ledger m where m.user_id = p.id)
       or exists (select 1 from public.fund_memberships fm where fm.user_id = p.id)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', u.id, 'employee_code', u.employee_code, 'display_name', u.display_name, 'status', u.status,
    'opening_vnd', case when p_from is null then 0 else private.balance_of(u.id, p_from - 1) end,
    'movement', private.breakdown(u.id, p_from, p_to),
    'closing_vnd', private.balance_of(u.id, p_to),
    'balance_now_vnd', private.balance_of(u.id),
    'is_member_today', u.id = any (private.members_on((select d from today))),
    'left_unsettled', not (u.id = any (private.members_on((select d from today)))) and private.balance_of(u.id) <> 0
  ) order by u.employee_code), '[]'::jsonb)
  from users u;
$$;

-- Dashboard (quyết định 12A: "Chi phí phát sinh" và "Quỹ đã chi" là 2 số riêng)
create or replace function api.admin_overview(p_from date default null, p_to date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from date := coalesce(p_from, date_trunc('month', private.vn_today())::date);
  v_to date := coalesce(p_to, private.vn_today());
  v_cash bigint;
  v_member bigint;
begin
  perform private.require_admin();
  if v_to < v_from then
    perform private.raise_err('INVALID_INPUT', 'kỳ không hợp lệ');
  end if;
  v_cash := private.cash_total();
  select coalesce(sum(amount_vnd), 0) into v_member from public.member_ledger;
  return jsonb_build_object(
    'period', jsonb_build_object('from', v_from, 'to', v_to),
    'cash_balance_vnd', v_cash,
    'cash_opening_vnd', private.cash_total(v_from - 1),
    'cash_closing_vnd', private.cash_total(v_to),
    'costs_incurred_vnd', coalesce((select -sum(amount_vnd) from public.member_ledger
      where entry_type = 'PURCHASE_SHARE' and occurred_on between v_from and v_to), 0),
    'fund_spent_vnd', coalesce((select -sum(amount_vnd) from public.cash_ledger
      where entry_type in ('PURCHASE_OUT', 'REIMBURSEMENT_OUT') and occurred_on between v_from and v_to), 0),
    'deposits_vnd', coalesce((select sum(amount_vnd) from public.cash_ledger
      where entry_type = 'DEPOSIT_IN' and occurred_on between v_from and v_to), 0),
    'gifts_vnd', coalesce((select sum(amount_vnd) from public.cash_ledger
      where entry_type = 'GIFT_IN' and occurred_on between v_from and v_to), 0),
    'owing', (
      select jsonb_build_object('people', count(*), 'total_vnd', coalesce(-sum(b), 0))
      from (select sum(amount_vnd) as b from public.member_ledger group by user_id) t where b < 0
    ),
    'left_unsettled', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', p.id, 'display_name', p.display_name,
        'employee_code', p.employee_code, 'balance_vnd', private.balance_of(p.id)))
      from public.profiles p
      where not (p.id = any (private.members_on(private.vn_today())))
        and private.balance_of(p.id) <> 0), '[]'::jsonb),
    'active_members', cardinality(private.members_on(private.vn_today())),
    'invariant', jsonb_build_object('cash_vnd', v_cash, 'member_vnd', v_member, 'diff_vnd', v_member - v_cash),
    'last_reconciliation', (select to_jsonb(r) from public.reconciliation_runs r order by r.ran_at desc limit 1)
  );
end;
$$;

create or replace function api.admin_member_balances(p_from date default null, p_to date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  if p_from is not null and p_to is not null and p_to < p_from then
    perform private.raise_err('INVALID_INPUT', 'kỳ không hợp lệ');
  end if;
  return private.member_balance_rows(p_from, p_to);
end;
$$;

-- Chi tiết số dư một người (admin) — dùng khi đóng membership để gợi ý tất toán
create or replace function api.admin_member_statement(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  perform private.require_profile(p_user_id, 'thành viên');
  return jsonb_build_object(
    'user_id', p_user_id,
    'balance_vnd', private.balance_of(p_user_id),
    'breakdown', private.breakdown(p_user_id),
    'recent', coalesce((
      select jsonb_agg(x order by (x ->> 'occurred_on') desc) from (
        select jsonb_build_object('event_id', m.event_id, 'entry_type', m.entry_type, 'amount_vnd', m.amount_vnd,
          'occurred_on', m.occurred_on, 'event_kind', e.kind, 'is_reversal', m.reverses_entry_id is not null) as x
        from public.member_ledger m join public.fund_events e on e.id = m.event_id
        where m.user_id = p_user_id order by m.occurred_on desc, m.created_at desc limit 50
      ) t), '[]'::jsonb)
  );
end;
$$;

-- Đối soát: gọi bởi cron (service_role) hoặc admin. Ghi kết quả, không tự sửa.
create or replace function api.reconcile(p_source text default 'manual')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_cash bigint;
  v_member bigint;
  v_bad jsonb;
  v_run public.reconciliation_runs;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    v_actor := (private.require_admin()).id;
  end if;
  v_cash := private.cash_total();
  select coalesce(sum(amount_vnd), 0) into v_member from public.member_ledger;
  v_bad := private.bad_events();
  insert into public.reconciliation_runs (source, cash_total, member_total, diff, bad_events)
  values (left(coalesce(p_source, 'manual'), 32), v_cash, v_member, v_member - v_cash, v_bad)
  returning * into v_run;
  if v_member <> v_cash or v_cash < 0 or jsonb_array_length(v_bad) > 0 then
    perform private.audit(v_actor, 'reconcile.alert', 'reconciliation_run', v_run.id::text, null, to_jsonb(v_run));
  end if;
  return to_jsonb(v_run) || jsonb_build_object('ok', v_member = v_cash and v_cash >= 0 and jsonb_array_length(v_bad) = 0);
end;
$$;

-- Trang "Sức khỏe sổ"
create or replace function api.admin_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cash bigint;
  v_member bigint;
begin
  perform private.require_admin();
  v_cash := private.cash_total();
  select coalesce(sum(amount_vnd), 0) into v_member from public.member_ledger;
  return jsonb_build_object(
    'cash_vnd', v_cash, 'member_vnd', v_member, 'diff_vnd', v_member - v_cash,
    'cash_negative', v_cash < 0,
    'bad_events', private.bad_events(),
    'event_count', (select count(*) from public.fund_events),
    'last_runs', coalesce((select jsonb_agg(to_jsonb(r) order by r.ran_at desc)
      from (select * from public.reconciliation_runs order by ran_at desc limit 10) r), '[]'::jsonb),
    'recent_audit', coalesce((select jsonb_agg(jsonb_build_object('occurred_at', a.occurred_at, 'action', a.action,
        'entity_type', a.entity_type, 'entity_id', a.entity_id, 'reason', a.reason,
        'actor', (select p.display_name from public.profiles p where p.id = a.actor_user_id)) order by a.occurred_at desc)
      from (select * from public.audit_events order by occurred_at desc limit 30) a), '[]'::jsonb)
  );
end;
$$;

-- Dữ liệu 6 sheet Excel. Giới hạn 12 tháng / 20.000 dòng.
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
        'choice', v.choice, 'coffee_type', v.coffee_type, 'cups', v.cups, 'note', v.note)
        order by s.service_date, s.opens_at, p.employee_code)
      from public.votes v join public.vote_sessions s on s.id = v.vote_session_id
      join public.profiles p on p.id = v.user_id
      where not v.is_withdrawn and s.service_date between p_from and p_to), '[]'::jsonb)
  );
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 20260925000010_api_import.sql
-- ────────────────────────────────────────────────────────────────────────────
-- Import Excel: stage từng dòng + lỗi → preview → commit nguyên khối (một transaction).
-- Server Next.js chỉ đọc file .xlsx thành JSON; mọi kiểm tra nghiệp vụ và posting nằm ở đây.

create or replace function private.try_date(p text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p is null or p !~ '^\d{4}-\d{2}-\d{2}$' then
    return null;
  end if;
  return p::date;
exception when others then
  return null;
end;
$$;

create or replace function private.try_amount(p jsonb)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v numeric;
begin
  if p is null or jsonb_typeof(p) <> 'number' then
    return null;
  end if;
  v := (p #>> '{}')::numeric;
  if v <> trunc(v) or abs(v) > 1000000000000 then
    return null;
  end if;
  return v::bigint;
end;
$$;

create or replace function private.import_key(p_job public.import_jobs, p_ref text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select md5(p_job.file_checksum || ':' || p_job.kind::text || ':' || p_ref)::uuid;
$$;

-- Kiểm tra + chuẩn hóa mọi dòng của job. Ghi errors/normalized, cập nhật status/summary/preview_hash.
-- p_for_commit = true: tài khoản trong import MEMBERS phải đã tồn tại.
create or replace function private.import_validate(p_job_id uuid, p_for_commit boolean default false)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_job public.import_jobs;
  r record;
  g record;
  v_err text[];
  v_n jsonb;
  v_ref text;
  v_date date;
  v_amount bigint;
  v_user uuid;
  v_profile public.profiles;
  v_members uuid[];
  v_lines jsonb;
  v_plan jsonb;
  v_hash_parts text[] := '{}';
  v_errors int;
  v_summary jsonb;
  v_hash text;
  v_detail text;
  v_today date := private.vn_today();
begin
  select * into v_job from public.import_jobs where id = p_job_id for update;
  update public.import_rows set errors = '[]'::jsonb, normalized = null where job_id = p_job_id;

  if v_job.kind in ('DEPOSITS', 'REIMBURSEMENTS', 'GIFTS') then
    for r in select * from public.import_rows where job_id = p_job_id order by row_no loop
      v_err := '{}';
      v_ref := private.clean_text(r.data ->> 'external_ref');
      v_date := private.try_date(r.data ->> 'occurred_on');
      v_amount := private.try_amount(r.data -> 'amount_vnd');
      v_user := null;
      if v_ref is null then v_err := array_append(v_err, 'Thiếu mã chứng từ (external_ref)'); end if;
      if v_ref is not null and length(v_ref) > 64 then v_err := array_append(v_err, 'Mã chứng từ tối đa 64 ký tự'); end if;
      if v_date is null then v_err := array_append(v_err, 'Ngày không hợp lệ (YYYY-MM-DD)');
      elsif v_date > v_today then v_err := array_append(v_err, 'Ngày ở tương lai'); end if;
      if v_amount is null or v_amount <= 0 then v_err := array_append(v_err, 'Số tiền phải là số nguyên dương'); end if;
      if v_ref is not null and exists (select 1 from public.import_rows o where o.job_id = p_job_id
          and o.row_no < r.row_no and private.clean_text(o.data ->> 'external_ref') = v_ref) then
        v_err := array_append(v_err, 'Trùng mã chứng từ trong file');
      end if;
      if v_ref is not null and exists (select 1 from public.fund_events e where e.external_ref = v_ref
          and e.kind = case v_job.kind when 'DEPOSITS' then 'DEPOSIT' when 'GIFTS' then 'GIFT' else 'REIMBURSEMENT' end::public.fund_event_kind) then
        v_err := array_append(v_err, 'Mã chứng từ đã được ghi trước đó');
      end if;
      if v_job.kind <> 'GIFTS' then
        select id into v_user from public.profiles where username = lower(coalesce(private.clean_text(r.data ->> 'username'), ''));
        if v_user is null then v_err := array_append(v_err, 'Không tìm thấy username'); end if;
      elsif v_date is not null and cardinality(private.members_on(v_date)) = 0 then
        v_err := array_append(v_err, 'Không có thành viên quỹ tại ngày này');
      end if;
      v_n := jsonb_build_object('external_ref', v_ref, 'occurred_on', v_date, 'amount_vnd', v_amount,
        'user_id', v_user, 'note', private.clean_text(r.data ->> 'note'));
      if v_job.kind = 'GIFTS' and v_date is not null and v_amount is not null and v_amount > 0 then
        v_members := private.members_on(v_date);
        if cardinality(v_members) > 0 then
          v_n := v_n || jsonb_build_object('preview_hash', private.gift_hash(v_date, v_amount, v_members),
            'split', private.split_info(v_amount, cardinality(v_members)));
          v_hash_parts := v_hash_parts || (v_n ->> 'preview_hash');
        end if;
      end if;
      update public.import_rows set errors = to_jsonb(v_err), normalized = v_n where id = r.id;
      v_hash_parts := v_hash_parts || (r.row_no::text || '=' || v_n::text);
    end loop;

  elsif v_job.kind = 'PURCHASES' then
    -- Mỗi phiếu = nhóm các dòng cùng external_ref
    for r in select * from public.import_rows where job_id = p_job_id and private.clean_text(data ->> 'external_ref') is null loop
      update public.import_rows set errors = '["Thiếu mã phiếu (external_ref)"]'::jsonb where id = r.id;
    end loop;
    for g in
      select private.clean_text(data ->> 'external_ref') as ref, array_agg(id order by row_no) as ids,
        count(distinct coalesce(data ->> 'occurred_on', '')) as n_dates,
        count(distinct upper(coalesce(data ->> 'paid_by', ''))) as n_paid,
        count(distinct lower(coalesce(data ->> 'payer_username', ''))) as n_payer,
        min(data ->> 'occurred_on') as occurred_on, min(upper(data ->> 'paid_by')) as paid_by,
        min(lower(private.clean_text(data ->> 'payer_username'))) as payer_username,
        min(private.clean_text(data ->> 'shop')) as shop, min(private.clean_text(data ->> 'notes')) as notes,
        jsonb_agg(jsonb_build_object('line_type', upper(coalesce(private.clean_text(data ->> 'line_type'), 'ITEM')),
          'item_name', data ->> 'item_name', 'quantity', data -> 'quantity', 'unit', data ->> 'unit',
          'line_amount_vnd', data -> 'line_amount_vnd') order by row_no) as lines
      from public.import_rows
      where job_id = p_job_id and private.clean_text(data ->> 'external_ref') is not null
      group by 1 order by min(row_no)
    loop
      v_err := '{}';
      v_plan := null;
      v_user := null;
      v_date := private.try_date(g.occurred_on);
      if length(g.ref) > 64 then v_err := array_append(v_err, 'Mã phiếu tối đa 64 ký tự'); end if;
      if g.n_dates > 1 or g.n_paid > 1 or g.n_payer > 1 then
        v_err := array_append(v_err, 'Các dòng cùng mã phiếu phải cùng ngày, nguồn trả và người mua');
      end if;
      if exists (select 1 from public.purchases p where p.external_ref = g.ref) then
        v_err := array_append(v_err, 'Mã phiếu đã được ghi trước đó');
      end if;
      if g.paid_by = 'MEMBER' then
        select id into v_user from public.profiles where username = coalesce(g.payer_username, '');
        if v_user is null then v_err := array_append(v_err, 'Không tìm thấy người mua hộ'); end if;
      end if;
      if cardinality(v_err) = 0 then
        begin
          v_plan := private.purchase_plan(v_date, g.paid_by, v_user, g.lines);
        exception when others then
          get stacked diagnostics v_detail = pg_exception_detail;
          v_err := array_append(v_err, (sqlerrm || coalesce(': ' || nullif(v_detail, ''), '')));
        end;
      end if;
      if v_plan is null and cardinality(v_err) = 0 then
        v_err := array_append(v_err, 'Phiếu không hợp lệ');
      end if;
      v_n := case when v_plan is null then null else jsonb_build_object(
        'external_ref', g.ref, 'occurred_on', v_date, 'paid_by', v_plan ->> 'paid_by', 'payer_user_id', v_user,
        'shop', g.shop, 'notes', g.notes, 'lines', v_plan -> 'lines', 'total_vnd', (v_plan ->> 'total')::bigint,
        'preview_hash', v_plan ->> 'preview_hash',
        'split', private.split_info((v_plan ->> 'total')::bigint, jsonb_array_length(v_plan -> 'members'))) end;
      -- normalized của phiếu gắn vào dòng đầu tiên của nhóm
      update public.import_rows set errors = to_jsonb(v_err),
        normalized = case when id = g.ids[1] then v_n else null end
      where id = any (g.ids);
      v_hash_parts := v_hash_parts || (g.ref || '=' || coalesce(v_n::text, 'ERR'));
    end loop;

  elsif v_job.kind = 'MEMBERS' then
    for r in select * from public.import_rows where job_id = p_job_id order by row_no loop
      v_err := '{}';
      v_date := private.try_date(r.data ->> 'start_date');
      v_n := jsonb_build_object(
        'employee_code', private.clean_text(r.data ->> 'employee_code'),
        'username', lower(coalesce(private.clean_text(r.data ->> 'username'), '')),
        'display_name', private.clean_text(r.data ->> 'display_name'),
        'role', upper(coalesce(private.clean_text(r.data ->> 'role'), 'MEMBER')),
        'start_date', v_date,
        'end_date', private.try_date(r.data ->> 'end_date'),
        'reason', coalesce(private.clean_text(r.data ->> 'reason'), 'Import Excel: ' || v_job.file_name));
      if coalesce(v_n ->> 'employee_code', '') !~ '^[A-Za-z0-9._-]{1,32}$' then v_err := array_append(v_err, 'Mã nhân viên không hợp lệ'); end if;
      if (v_n ->> 'username') !~ '^[a-z0-9._-]{3,32}$' then v_err := array_append(v_err, 'Username 3–32 ký tự a-z 0-9 . _ -'); end if;
      if v_n ->> 'display_name' is null or length(v_n ->> 'display_name') > 100 then v_err := array_append(v_err, 'Thiếu tên hiển thị'); end if;
      if (v_n ->> 'role') not in ('MEMBER', 'ADMIN') then v_err := array_append(v_err, 'Vai trò phải là MEMBER hoặc ADMIN'); end if;
      if v_date is null then v_err := array_append(v_err, 'Ngày bắt đầu không hợp lệ (YYYY-MM-DD)'); end if;
      if private.clean_text(r.data ->> 'end_date') is not null and (v_n ->> 'end_date' is null or (v_n ->> 'end_date')::date <= v_date) then
        v_err := array_append(v_err, 'Ngày kết thúc phải sau ngày bắt đầu');
      end if;
      if exists (select 1 from public.import_rows o where o.job_id = p_job_id and o.row_no < r.row_no
          and (lower(o.data ->> 'username') = v_n ->> 'username' or o.data ->> 'employee_code' = v_n ->> 'employee_code')) then
        v_err := array_append(v_err, 'Trùng username/mã nhân viên trong file');
      end if;
      select * into v_profile from public.profiles where username = v_n ->> 'username';
      if found then
        if v_profile.employee_code <> v_n ->> 'employee_code' then
          v_err := array_append(v_err, 'Username đã tồn tại với mã nhân viên khác');
        end if;
        if v_date is not null and exists (select 1 from public.fund_memberships m where m.user_id = v_profile.id
            and daterange(m.start_date, m.end_date, '[)') && daterange(v_date, (v_n ->> 'end_date')::date, '[)')) then
          v_err := array_append(v_err, 'Trùng khoảng thời gian tham gia quỹ đã có');
        end if;
        v_n := v_n || jsonb_build_object('user_id', v_profile.id, 'exists', true);
      else
        if exists (select 1 from public.profiles p where p.employee_code = v_n ->> 'employee_code') then
          v_err := array_append(v_err, 'Mã nhân viên đã thuộc tài khoản khác');
        end if;
        if p_for_commit then v_err := array_append(v_err, 'Tài khoản chưa được tạo'); end if;
        v_n := v_n || jsonb_build_object('exists', false);
      end if;
      update public.import_rows set errors = to_jsonb(v_err), normalized = v_n where id = r.id;
      v_hash_parts := v_hash_parts || (r.row_no::text || '=' || (v_n - 'user_id' - 'exists')::text);
    end loop;
  end if;

  select count(*) into v_errors from public.import_rows where job_id = p_job_id and jsonb_array_length(errors) > 0;
  v_hash := encode(sha256(convert_to(v_job.kind::text || '|' || array_to_string(v_hash_parts, '|'), 'UTF8')), 'hex');

  select jsonb_build_object(
    'rows', count(*),
    'error_rows', v_errors,
    'total_vnd', coalesce(sum(coalesce((normalized ->> 'amount_vnd')::bigint, (normalized ->> 'total_vnd')::bigint, 0)), 0),
    'documents', count(*) filter (where normalized is not null),
    'new_accounts', count(*) filter (where normalized ->> 'exists' = 'false')
  ) into v_summary
  from public.import_rows where job_id = p_job_id;

  update public.import_jobs
  set error_count = v_errors, summary = v_summary, preview_hash = v_hash,
      status = case when v_errors > 0 then 'HAS_ERRORS' else 'READY' end::public.import_status
  where id = p_job_id;
  return v_hash;
end;
$$;

create or replace function private.import_job_json(p_job_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select to_jsonb(j) || jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_object('row_no', r.row_no, 'data', r.data,
      'normalized', r.normalized, 'errors', r.errors) order by r.row_no)
      from public.import_rows r where r.job_id = j.id), '[]'::jsonb))
  from public.import_jobs j where j.id = p_job_id;
$$;

create or replace function api.import_stage(p_kind text, p_file_name text, p_checksum text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
  v_kind text := upper(coalesce(p_kind, ''));
  v_job_id uuid;
  v_dup uuid;
begin
  if v_kind not in ('MEMBERS', 'DEPOSITS', 'GIFTS', 'PURCHASES', 'REIMBURSEMENTS') then
    perform private.raise_err('INVALID_INPUT', 'loại import');
  end if;
  if p_checksum is null or p_checksum !~ '^[0-9a-f]{64}$' then
    perform private.raise_err('INVALID_INPUT', 'checksum');
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    perform private.raise_err('INVALID_INPUT', 'file không có dòng dữ liệu');
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    perform private.raise_err('INVALID_INPUT', 'tối đa 5.000 dòng mỗi file');
  end if;
  select id into v_dup from public.import_jobs
  where kind = v_kind::public.import_kind and file_checksum = p_checksum and status = 'COMMITTED';
  if v_dup is not null then
    perform private.raise_err('IMPORT_DUPLICATE_FILE', v_dup::text);
  end if;
  -- Job cũ chưa commit của cùng file → bỏ
  update public.import_jobs set status = 'DISCARDED'
  where kind = v_kind::public.import_kind and file_checksum = p_checksum and status not in ('COMMITTED', 'DISCARDED');

  insert into public.import_jobs (kind, file_name, file_checksum, row_count, created_by)
  values (v_kind::public.import_kind, left(coalesce(private.clean_text(p_file_name), 'import.xlsx'), 200),
    p_checksum, jsonb_array_length(p_rows), v_admin.id)
  returning id into v_job_id;

  insert into public.import_rows (job_id, row_no, data)
  select v_job_id, coalesce((x ->> 'row_no')::int, ord::int + 1), x - 'row_no'
  from jsonb_array_elements(p_rows) with ordinality as t (x, ord);

  perform private.import_validate(v_job_id);
  perform private.audit(v_admin.id, 'import.stage', 'import_job', v_job_id::text, null,
    jsonb_build_object('kind', v_kind, 'file_name', p_file_name, 'rows', jsonb_array_length(p_rows)));
  return private.import_job_json(v_job_id);
end;
$$;

-- Xem lại preview (tính lại theo dữ liệu hiện tại)
create or replace function api.import_preview(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.import_jobs;
begin
  perform private.require_admin();
  select * into v_job from public.import_jobs where id = p_job_id;
  if not found then
    perform private.raise_err('INVALID_INPUT', 'không tìm thấy job');
  end if;
  if v_job.status not in ('COMMITTED', 'DISCARDED') then
    perform private.import_validate(p_job_id);
  end if;
  return private.import_job_json(p_job_id);
end;
$$;

-- Commit nguyên khối. Trả status HAS_ERRORS/STALE (và lưu trạng thái) thay vì raise để trạng thái được giữ lại.
create or replace function api.import_commit(p_job_id uuid, p_preview_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
  v_job public.import_jobs;
  v_hash text;
  r record;
  v_n jsonb;
  v_count int := 0;
begin
  select * into v_job from public.import_jobs where id = p_job_id for update;
  if not found then
    perform private.raise_err('INVALID_INPUT', 'không tìm thấy job');
  end if;
  if v_job.status = 'COMMITTED' then
    return jsonb_build_object('status', 'COMMITTED', 'job_id', v_job.id, 'replayed', true);
  end if;
  if v_job.status = 'DISCARDED' then
    perform private.raise_err('INVALID_INPUT', 'job đã bị hủy');
  end if;
  if exists (select 1 from public.import_jobs where kind = v_job.kind and file_checksum = v_job.file_checksum
             and status = 'COMMITTED') then
    perform private.raise_err('IMPORT_DUPLICATE_FILE');
  end if;

  v_hash := private.import_validate(p_job_id, true);
  select * into v_job from public.import_jobs where id = p_job_id;
  if v_job.status = 'HAS_ERRORS' then
    return jsonb_build_object('status', 'HAS_ERRORS', 'job_id', v_job.id, 'error_count', v_job.error_count);
  end if;
  if p_preview_hash is null or v_hash <> p_preview_hash then
    update public.import_jobs set status = 'STALE' where id = p_job_id;
    return jsonb_build_object('status', 'STALE', 'job_id', v_job.id);
  end if;

  for r in select * from public.import_rows where job_id = p_job_id and normalized is not null order by row_no loop
    v_n := r.normalized;
    if v_job.kind = 'DEPOSITS' then
      perform private.post_deposit(v_admin.id, private.import_key(v_job, v_n ->> 'external_ref'), (v_n ->> 'user_id')::uuid,
        (v_n ->> 'amount_vnd')::bigint, (v_n ->> 'occurred_on')::date, v_n ->> 'external_ref', v_n ->> 'note', v_job.id);
    elsif v_job.kind = 'REIMBURSEMENTS' then
      perform private.post_reimbursement(v_admin.id, private.import_key(v_job, v_n ->> 'external_ref'), (v_n ->> 'user_id')::uuid,
        (v_n ->> 'amount_vnd')::bigint, (v_n ->> 'occurred_on')::date, v_n ->> 'external_ref', v_n ->> 'note', v_job.id);
    elsif v_job.kind = 'GIFTS' then
      perform private.post_gift(v_admin.id, private.import_key(v_job, v_n ->> 'external_ref'), (v_n ->> 'amount_vnd')::bigint,
        (v_n ->> 'occurred_on')::date, v_n ->> 'preview_hash', v_n ->> 'external_ref', v_n ->> 'note', v_job.id);
    elsif v_job.kind = 'PURCHASES' then
      perform private.post_purchase(v_admin.id, private.import_key(v_job, v_n ->> 'external_ref'), (v_n ->> 'occurred_on')::date,
        v_n ->> 'paid_by', (v_n ->> 'payer_user_id')::uuid, v_n -> 'lines', v_n ->> 'preview_hash',
        v_n ->> 'shop', v_n ->> 'external_ref', v_n ->> 'notes', v_job.id);
    elsif v_job.kind = 'MEMBERS' then
      insert into public.fund_memberships (user_id, start_date, end_date, reason, created_by, updated_by)
      values ((v_n ->> 'user_id')::uuid, (v_n ->> 'start_date')::date, (v_n ->> 'end_date')::date,
        v_n ->> 'reason', v_admin.id, v_admin.id);
    end if;
    v_count := v_count + 1;
  end loop;

  update public.import_jobs set status = 'COMMITTED', committed_at = now() where id = p_job_id;
  perform private.audit(v_admin.id, 'import.commit', 'import_job', p_job_id::text, null,
    jsonb_build_object('kind', v_job.kind, 'documents', v_count, 'file_name', v_job.file_name));
  return jsonb_build_object('status', 'COMMITTED', 'job_id', p_job_id, 'documents', v_count, 'replayed', false);
end;
$$;

create or replace function api.import_discard(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
begin
  update public.import_jobs set status = 'DISCARDED' where id = p_job_id and status not in ('COMMITTED', 'DISCARDED');
  perform private.audit(v_admin.id, 'import.discard', 'import_job', p_job_id::text);
end;
$$;

create or replace function api.import_list_jobs(p_limit int default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return coalesce((
    select jsonb_agg(to_jsonb(j) || jsonb_build_object('created_by_name',
      (select p.display_name from public.profiles p where p.id = j.created_by)) order by j.created_at desc)
    from (select * from public.import_jobs order by created_at desc limit least(greatest(coalesce(p_limit, 20), 1), 100)) j
  ), '[]'::jsonb);
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 20260925000011_security.sql
-- ────────────────────────────────────────────────────────────────────────────
-- Bảo mật: RLS bật trên mọi bảng, không có policy ghi. Mọi thao tác đi qua api.* (SECURITY DEFINER).
-- Chỉ đọc trực tiếp: hồ sơ của mình, ledger của mình (phòng thủ thêm; app dùng RPC).

do $$
declare
  t text;
begin
  foreach t in array array['profiles', 'fund_memberships', 'import_jobs', 'import_rows', 'fund_events',
    'purchases', 'purchase_items', 'cash_ledger', 'member_ledger', 'vote_sessions', 'votes',
    'audit_events', 'reconciliation_runs']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end;
$$;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

grant select on public.profiles, public.member_ledger to authenticated;

create policy profiles_select_own on public.profiles
  for select to authenticated using (id = auth.uid());
create policy member_ledger_select_own on public.member_ledger
  for select to authenticated using (user_id = auth.uid());

-- Ledger không bao giờ được UPDATE/DELETE bởi role ứng dụng (ngoài trigger chặn)
revoke update, delete, truncate on public.cash_ledger, public.member_ledger, public.fund_events,
  public.purchases, public.purchase_items, public.audit_events from anon, authenticated, service_role;

-- Schema private: không ai ngoài owner được gọi
revoke all on schema private from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;

-- Schema api: chỉ người đã đăng nhập (hàm tự kiểm quyền chi tiết)
revoke all on all functions in schema api from public, anon;
grant usage on schema api to authenticated, service_role;
grant execute on all functions in schema api to authenticated;
grant execute on function api.reconcile(text) to service_role;

alter default privileges in schema api revoke execute on functions from public;
alter default privileges in schema private revoke execute on functions from public;

-- Báo PostgREST nạp lại schema cache để thấy các hàm api.*
notify pgrst, 'reload schema';

commit;
