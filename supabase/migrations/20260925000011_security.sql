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
