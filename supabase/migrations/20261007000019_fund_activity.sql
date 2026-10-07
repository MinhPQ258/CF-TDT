-- 000019: Màn Quỹ mới — "Gần đây" cho mọi người (trước chỉ admin xem sổ giao dịch).
-- Chỉ đọc; dùng lại private.event_json. p_dir: 'IN' (tiền vào quỹ), 'OUT' (tiền ra khỏi quỹ), null = tất cả.

create or replace function api.fund_activity(p_dir text default null, p_limit int default 20, p_offset int default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_dir text := upper(coalesce(p_dir, ''));
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
begin
  perform private.require_user();
  if v_dir not in ('', 'IN', 'OUT') then
    perform private.raise_err('INVALID_INPUT', 'p_dir');
  end if;
  return (
    with f as (
      select e.*, coalesce((select sum(c.amount_vnd) from public.cash_ledger c where c.event_id = e.id), 0) as cash
      from public.fund_events e
    ), g as (
      select * from f
      where v_dir = '' or (v_dir = 'IN' and cash > 0) or (v_dir = 'OUT' and cash < 0)
    )
    select jsonb_build_object(
      'total', (select count(*) from g),
      'rows', coalesce((
        select jsonb_agg(private.event_json(x) order by x.occurred_on desc, x.created_at desc)
        from (select e.* from public.fund_events e join g on g.id = e.id
              order by e.occurred_on desc, e.created_at desc limit v_limit offset v_offset) x
      ), '[]'::jsonb)
    )
  );
end;
$$;

grant execute on function api.fund_activity(text, int, int) to authenticated;

notify pgrst, 'reload schema';
