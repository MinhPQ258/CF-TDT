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
