-- ============================================================================
-- Coffee TDT — CHẨN ĐOÁN phân quyền (chỉ đọc; phần thử quyền chạy trong transaction rồi ROLLBACK)
-- Supabase Dashboard → SQL Editor → dán → Run. Gửi lại kết quả từng bảng.
-- Sửa v_user bên dưới thành username đang bị báo "không có quyền".
-- ============================================================================

-- 1) Phiên bản hàm kiểm tra quyền trên DB (phải đều true)
select
  to_regclass('public.roles') is not null as co_bang_roles,
  pg_get_functiondef('private.require_admin()'::regprocedure) like '%pg_context%' as require_admin_ban_rbac,
  private.rpc_required_permissions('post_deposit') as quyen_can_cho_tien_vao,
  private.rpc_required_permissions('post_purchase') as quyen_can_cho_mua_sam;

-- 2) Vai trò đang có
select name, is_system, permissions from public.roles order by is_system desc, name;

-- 3) Từng tài khoản: role, trạng thái, vai trò được gán, quyền thực có
select p.username, p.display_name, p.role, p.status, p.must_change_password,
  coalesce((select string_agg(r.name, ', ' order by r.name) from public.user_roles ur join public.roles r on r.id = ur.role_id
            where ur.user_id = p.id), '—') as vai_tro,
  array_to_string(private.user_permissions(p.id), ', ') as quyen
from public.profiles p
order by p.role desc, p.username;

-- 4) Thử quyền thật của một người như khi gọi từ app (không ghi gì: preview_gift chỉ tính toán; cuối cùng ROLLBACK)
begin;
create temp table _chan_doan (buoc text, ket_qua text) on commit drop;
grant all on _chan_doan to public;
do $$
declare
  v_user text := 'minhpq';   -- ← username cần kiểm tra
  v_id uuid := (select id from public.profiles where username = v_user);
  r jsonb;
begin
  if v_id is null then
    insert into _chan_doan values ('tài khoản', 'Không có tài khoản ' || v_user);
    return;
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_id, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    r := api.me();
    insert into _chan_doan values ('api.me', 'role=' || coalesce(r ->> 'role', '?') || ' · quyền=' || coalesce((r -> 'permissions')::text, '(không có trường permissions)'));
  exception when others then
    insert into _chan_doan values ('api.me', 'LỖI: ' || sqlerrm);
  end;
  begin
    r := api.preview_gift(1000, (now() at time zone 'Asia/Ho_Chi_Minh')::date);
    insert into _chan_doan values ('quyền sổ quỹ (preview_gift)', 'OK');
  exception when others then
    insert into _chan_doan values ('quyền sổ quỹ (preview_gift)', 'LỖI: ' || sqlerrm);
  end;
end;
$$;
reset role;
select * from _chan_doan;
rollback;
