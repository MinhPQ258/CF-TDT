-- 000016: Bỏ khái niệm "Thành viên quỹ" — mọi tài khoản ACTIVE đều được chia đều phiếu mua / tiền cho thêm.
-- Bảng fund_memberships giữ lại (dữ liệu cũ), không còn ảnh hưởng tới phân bổ.
-- Các bút toán đã ghi không đổi; chỉ giao dịch mới chia theo danh sách tài khoản ACTIVE tại lúc ghi.

create or replace function private.members_on(p_date date)
returns uuid[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(p.id order by p.employee_code, p.id), '{}'::uuid[])
  from public.profiles p
  where p.status = 'ACTIVE';
$$;

-- Tổng quan quỹ cho mọi người: đã đóng, đã chi, còn lại + số tiền đóng của từng người
create or replace function api.fund_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.profiles := private.require_user();
begin
  return jsonb_build_object(
    'cash_balance_vnd', private.cash_total(),
    'as_of', private.vn_today(),
    -- tiền nộp (đã trừ các khoản đảo)
    'deposits_vnd', coalesce((select sum(amount_vnd) from public.cash_ledger where entry_type = 'DEPOSIT_IN'), 0),
    'gifts_vnd', coalesce((select sum(amount_vnd) from public.cash_ledger where entry_type = 'GIFT_IN'), 0),
    -- đã chi = tiền thực ra khỏi quỹ (phiếu quỹ trả + hoàn tiền) → đã đóng − đã chi = quỹ còn
    'spent_vnd', coalesce((select -sum(amount_vnd) from public.cash_ledger where entry_type in ('PURCHASE_OUT', 'REIMBURSEMENT_OUT')), 0),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', t.id, 'display_name', t.display_name, 'employee_code', t.employee_code,
        'deposited_vnd', t.deposited, 'is_me', t.id = v.id) order by t.deposited desc, t.employee_code)
      from (
        select p.id, p.display_name, p.employee_code,
          coalesce((select sum(m.amount_vnd) from public.member_ledger m where m.user_id = p.id and m.entry_type = 'DEPOSIT_CREDIT'), 0) as deposited
        from public.profiles p
        where p.status = 'ACTIVE'
           or exists (select 1 from public.member_ledger m where m.user_id = p.id and m.entry_type = 'DEPOSIT_CREDIT')
      ) t
    ), '[]'::jsonb)
  );
end;
$$;

notify pgrst, 'reload schema';
