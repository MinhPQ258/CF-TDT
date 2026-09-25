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
