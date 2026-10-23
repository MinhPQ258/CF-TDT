-- ============================================================================
-- Coffee TDT — NÂNG CẤP DB production lên migration 23: Trực nhật — nút Reset lịch sử quay
-- CHẠY SAU upgrade_022_duty_active.sql. Chạy TRƯỚC khi deploy code mới: Supabase SQL Editor → dán → Run.
-- Một transaction, chạy lại được. Nội dung = nguyên văn supabase/migrations/20261023000023_duty_reset_history.sql.
-- ============================================================================

begin;
-- 000023: Trực nhật — nút "Reset lịch sử quay".
-- Đưa mọi người có trong lịch sử trở lại vòng quay (tích lại; ai đã bị xoá khỏi danh sách thì thêm lại), rồi xoá lịch sử.
-- DELETE luôn có WHERE (Supabase bật pg_safeupdate).

create or replace function api.admin_duty_reset_history()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
  v_spins int;
  v_back int;
begin
  perform pg_advisory_xact_lock(hashtext('duty_spin'));
  select count(*) into v_spins from public.duty_spins;

  -- người trong lịch sử, mỗi tên một lần (lấy user_id gần nhất)
  with h as (
    select distinct on (lower(s.name)) s.name, s.user_id
    from public.duty_spins s
    order by lower(s.name), s.spun_at desc
  ), ticked as (
    update public.duty_members m set active = true
    from h where lower(m.name) = lower(h.name) and not m.active
    returning m.id
  ), added as (
    insert into public.duty_members (name, user_id, sort_order, active)
    select h.name, h.user_id, coalesce((select max(sort_order) from public.duty_members), 0)
             + row_number() over (order by h.name), true
    from h
    where not exists (select 1 from public.duty_members m where lower(m.name) = lower(h.name))
    on conflict do nothing
    returning id
  )
  select (select count(*) from ticked) + (select count(*) from added) into v_back;

  delete from public.duty_spins where true;
  perform private.audit(v_admin.id, 'duty.reset_history', 'duty', null, jsonb_build_object('spins', v_spins), jsonb_build_object('returned', v_back));
  return jsonb_build_object('cleared', v_spins, 'returned', v_back, 'members', private.duty_members_json());
end;
$$;

grant execute on function api.admin_duty_reset_history() to authenticated;


commit;

notify pgrst, 'reload schema';

-- Kiểm tra: true
select to_regprocedure('api.admin_duty_reset_history()') is not null as co_reset_history;
