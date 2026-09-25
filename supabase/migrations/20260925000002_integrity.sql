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
