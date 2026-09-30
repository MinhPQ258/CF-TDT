-- 000015: Chỉnh sửa đợt (màn giống Tạo đợt): tên, ngày, giờ mở/chốt, cho nhập số cốc, danh sách kiểu pha / đồ đi kèm.
-- Đồng bộ lựa chọn theo danh sách mới: có sẵn → hiện lại + xếp thứ tự; mới → thêm;
-- bỏ khỏi danh sách → đã có người chọn thì ẩn (phiếu cũ giữ nguyên), chưa ai chọn thì xóa hẳn.
-- Giờ pha = giờ chốt. Chỉ đợt chưa chốt/chưa hủy.

create or replace function private.sync_vote_options(p_session_id uuid, p_kind public.vote_option_kind, p_labels text[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  i int := 0;
  v_label text;
  o public.vote_session_options;
begin
  foreach v_label in array p_labels loop
    i := i + 1;
    update public.vote_session_options set is_hidden = false, sort_order = i, label = v_label
    where vote_session_id = p_session_id and kind = p_kind and lower(label) = lower(v_label);
    if not found then
      insert into public.vote_session_options (vote_session_id, kind, label, sort_order) values (p_session_id, p_kind, v_label, i);
    end if;
  end loop;
  for o in select * from public.vote_session_options
      where vote_session_id = p_session_id and kind = p_kind
        and lower(label) not in (select lower(x) from unnest(p_labels) x) loop
    if exists (select 1 from public.votes where style_option_id = o.id)
       or exists (select 1 from public.vote_addons where option_id = o.id) then
      update public.vote_session_options set is_hidden = true where id = o.id;
    else
      delete from public.vote_session_options where id = o.id;
    end if;
  end loop;
end;
$$;

create or replace function api.admin_update_vote_session(
  p_session_id uuid, p_name text, p_service_date date, p_opens_at timestamptz, p_cutoff_at timestamptz,
  p_allow_cups boolean, p_styles text[], p_addons text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
  s public.vote_sessions;
  v_name text := private.clean_text(p_name);
  v_styles text[] := private.clean_labels(p_styles, 10, 'Kiểu pha');
  v_addons text[] := private.clean_labels(p_addons, 20, 'Đồ đi kèm');
begin
  select * into s from public.vote_sessions where id = p_session_id for update;
  if not found or private.vote_state(s) not in ('OPEN', 'UPCOMING', 'DRAFT') then
    perform private.raise_err('VOTE_CLOSED', 'đợt đã chốt hoặc đã hủy');
  end if;
  if v_name is null or length(v_name) > 100 then
    perform private.raise_err('INVALID_INPUT', 'tên đợt 1–100 ký tự');
  end if;
  if p_service_date is null or p_opens_at is null or p_cutoff_at is null or p_cutoff_at <= p_opens_at then
    perform private.raise_err('INVALID_INPUT', 'Giờ chốt phải sau giờ mở');
  end if;
  if p_cutoff_at <= now() then
    perform private.raise_err('INVALID_INPUT', 'Giờ chốt phải ở tương lai');
  end if;
  if cardinality(v_styles) = 0 then
    perform private.raise_err('INVALID_INPUT', 'Cần ít nhất 1 kiểu pha');
  end if;

  update public.vote_sessions
  set name = v_name, service_date = p_service_date, opens_at = p_opens_at, cutoff_at = p_cutoff_at,
      planned_brew_at = p_cutoff_at, allow_cups = coalesce(p_allow_cups, allow_cups), updated_at = now()
  where id = s.id returning * into s;
  perform private.sync_vote_options(s.id, 'STYLE', v_styles);
  perform private.sync_vote_options(s.id, 'ADDON', v_addons);
  perform private.audit(v_admin.id, 'vote.update', 'vote_session', s.id::text, null,
    jsonb_build_object('name', v_name, 'opens_at', p_opens_at, 'cutoff_at', p_cutoff_at, 'styles', v_styles, 'addons', v_addons));
  return private.vote_session_json(s, v_admin.id);
end;
$$;

grant execute on function api.admin_update_vote_session(uuid, text, date, timestamptz, timestamptz, boolean, text[], text[]) to authenticated;
revoke all on function private.sync_vote_options(uuid, public.vote_option_kind, text[]) from public, anon, authenticated;

notify pgrst, 'reload schema';
