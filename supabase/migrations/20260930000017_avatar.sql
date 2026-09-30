-- 000017: Ảnh đại diện (avatar) — người dùng tự đổi trong Cài đặt.
-- Lưu thẳng trong profiles.avatar dạng data URL (trình duyệt đã cắt vuông + thu về 256px JPEG/PNG/WebP, ~15–30KB),
-- không cần Supabase Storage. Giới hạn 200.000 ký tự (~150KB).

alter table public.profiles add column if not exists avatar text null;
alter table public.profiles drop constraint if exists profiles_avatar_chk;
alter table public.profiles add constraint profiles_avatar_chk check (
  avatar is null or (length(avatar) <= 200000 and avatar ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$')
);

-- api.me: thêm avatar (bản 000005 + 1 trường)
create or replace function api.me()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v public.profiles;
begin
  if v_uid is null then
    return null;
  end if;
  select * into v from public.profiles where id = v_uid;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'id', v.id, 'employee_code', v.employee_code, 'username', v.username::text,
    'display_name', v.display_name, 'role', v.role, 'status', v.status,
    'must_change_password', v.must_change_password,
    'is_member_today', v.id = any (private.members_on(private.vn_today())),
    'avatar', v.avatar
  );
end;
$$;

-- Đổi / xoá (null) ảnh đại diện của chính mình
create or replace function api.set_my_avatar(p_avatar text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.profiles := private.require_user();
  v_avatar text := nullif(btrim(coalesce(p_avatar, '')), '');
begin
  if v_avatar is not null and (length(v_avatar) > 200000
      or v_avatar !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$') then
    perform private.raise_err('INVALID_INPUT', 'Ảnh không hợp lệ hoặc quá lớn');
  end if;
  update public.profiles set avatar = v_avatar where id = v.id;
  perform private.audit(v.id, case when v_avatar is null then 'profile.avatar_remove' else 'profile.avatar_set' end,
    'profile', v.id::text, null, jsonb_build_object('bytes', coalesce(length(v_avatar), 0)));
  return jsonb_build_object('avatar', v_avatar);
end;
$$;

grant execute on function api.set_my_avatar(text) to authenticated;

notify pgrst, 'reload schema';
