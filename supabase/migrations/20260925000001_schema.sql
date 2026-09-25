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
