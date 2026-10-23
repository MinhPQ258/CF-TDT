-- 000022: Trực nhật — sửa lỗi "Nạp lại tất cả" + ô tích hiển thị trên vòng quay.
-- 1) Supabase bật pg_safeupdate cho request qua API: DELETE/UPDATE không có WHERE bị chặn → "Nạp lại tất cả" lỗi
--    trên production (local không có safeupdate nên không thấy). Thêm WHERE.
-- 2) duty_members.active: tích = có trên vòng quay, bỏ tích = vẫn trong danh sách nhưng không quay tới.
--    "Xoá người sau khi có kết quả" giờ BỎ TÍCH người trúng (giữ tên để tích lại sau).

alter table public.duty_members add column if not exists active boolean not null default true;

create or replace function private.duty_members_json()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'active', m.active) order by m.sort_order, m.created_at), '[]'::jsonb)
  from public.duty_members m;
$$;

-- Người đang có trên vòng quay (đúng thứ tự vẽ)
create or replace function private.duty_wheel_json()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'active', true) order by m.sort_order, m.created_at), '[]'::jsonb)
  from public.duty_members m where m.active;
$$;

-- Quay: chỉ chọn trong người đã tích. members_before = các ô trên vòng quay lúc quay; index = vị trí người trúng trong đó.
create or replace function api.admin_duty_spin(p_remove boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
  v_before jsonb;
  w public.duty_members;
  v_idx int;
begin
  perform pg_advisory_xact_lock(hashtext('duty_spin'));
  v_before := private.duty_wheel_json();
  if jsonb_array_length(v_before) < 2 then
    perform private.raise_err('INVALID_INPUT', 'Cần ít nhất 2 người được tích để quay');
  end if;
  select * into w from public.duty_members where active order by random() limit 1;
  select (x.ord - 1)::int into v_idx
  from jsonb_array_elements(v_before) with ordinality as x (item, ord) where (x.item ->> 'id')::uuid = w.id;
  insert into public.duty_spins (name, user_id, spun_by) values (w.name, w.user_id, v_admin.id);
  if coalesce(p_remove, false) then
    update public.duty_members set active = false where id = w.id;
  end if;
  perform private.audit(v_admin.id, 'duty.spin', 'duty', w.id::text, null,
    jsonb_build_object('name', w.name, 'removed', coalesce(p_remove, false)));
  return jsonb_build_object('winner', jsonb_build_object('id', w.id, 'name', w.name, 'active', true), 'index', v_idx,
    'members_before', v_before, 'members', private.duty_members_json());
end;
$$;

-- Tích / bỏ tích một người
create or replace function api.admin_duty_set_active(p_id uuid, p_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
begin
  update public.duty_members set active = coalesce(p_active, true) where id = p_id;
  if not found then
    perform private.raise_err('INVALID_INPUT', 'Không tìm thấy người trong danh sách');
  end if;
  return private.duty_members_json();
end;
$$;

-- Nạp lại: danh sách = mọi tài khoản đang hoạt động, tất cả được tích (WHERE để qua pg_safeupdate)
create or replace function api.admin_duty_reset()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
begin
  delete from public.duty_members where true;
  perform private.duty_load_active();
  return private.duty_members_json();
end;
$$;

grant execute on function api.admin_duty_set_active(uuid, boolean) to authenticated;
revoke all on function private.duty_wheel_json() from public, anon, authenticated;

notify pgrst, 'reload schema';
