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
