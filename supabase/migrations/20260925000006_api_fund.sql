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
