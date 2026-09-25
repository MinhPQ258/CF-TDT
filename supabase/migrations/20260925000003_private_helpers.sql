-- Hàm nội bộ (schema private, không expose qua API). Logic tiền chỉ nằm ở đây.

create or replace function private.vn_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Asia/Ho_Chi_Minh')::date;
$$;

create or replace function private.request_id()
returns text
language plpgsql
stable
set search_path = ''
as $$
begin
  return nullif(current_setting('request.headers', true), '')::json ->> 'x-request-id';
exception when others then
  return null;
end;
$$;

create or replace function private.audit(
  p_actor uuid, p_action text, p_entity_type text, p_entity_id text,
  p_before jsonb default null, p_after jsonb default null, p_reason text default null
)
returns void
language sql
set search_path = ''
as $$
  insert into public.audit_events (actor_user_id, action, entity_type, entity_id, before, after, reason, request_id)
  values (p_actor, p_action, p_entity_type, p_entity_id, p_before, p_after, p_reason, private.request_id());
$$;

-- Người gọi hiện tại: phải đăng nhập, ACTIVE, đã đổi mật khẩu (trừ khi cho phép)
create or replace function private.require_user(p_allow_must_change boolean default false)
returns public.profiles
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v public.profiles;
begin
  if v_uid is null then
    perform private.raise_err('INSUFFICIENT_PERMISSION', 'chưa đăng nhập');
  end if;
  select * into v from public.profiles where id = v_uid;
  if not found then
    perform private.raise_err('INSUFFICIENT_PERMISSION', 'không có hồ sơ');
  end if;
  if v.status = 'DISABLED' then
    perform private.raise_err('ACCOUNT_DISABLED');
  end if;
  if v.must_change_password and not p_allow_must_change then
    perform private.raise_err('MUST_CHANGE_PASSWORD');
  end if;
  return v;
end;
$$;

create or replace function private.require_admin()
returns public.profiles
language plpgsql
stable
set search_path = ''
as $$
declare
  v public.profiles := private.require_user();
begin
  if v.role <> 'ADMIN' then
    perform private.raise_err('INSUFFICIENT_PERMISSION', 'cần quyền quản trị');
  end if;
  return v;
end;
$$;

-- Ngày nghiệp vụ hợp lệ: không null, không ở tương lai (giờ VN) — quyết định 13b
create or replace function private.validate_business_date(p_date date)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_date is null then
    perform private.raise_err('INVALID_INPUT', 'occurred_on bắt buộc');
  end if;
  if p_date > private.vn_today() then
    perform private.raise_err('FUTURE_DATE', p_date::text);
  end if;
  if p_date < date '2000-01-01' then
    perform private.raise_err('INVALID_INPUT', 'ngày quá xa');
  end if;
end;
$$;

create or replace function private.validate_amount(p_amount bigint)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_amount is null or p_amount <= 0 or p_amount > 1000000000000 then
    perform private.raise_err('INVALID_INPUT', 'amount_vnd phải là số nguyên dương');
  end if;
end;
$$;

create or replace function private.clean_text(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(p), '');
$$;

-- Thành viên quỹ hiệu lực tại ngày d, thứ tự ổn định employee_code, id
create or replace function private.members_on(p_date date)
returns uuid[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(p.id order by p.employee_code, p.id), '{}'::uuid[])
  from public.fund_memberships m
  join public.profiles p on p.id = m.user_id
  where m.start_date <= p_date and (m.end_date is null or p_date < m.end_date);
$$;

-- Chia đều: q = floor(x/N), r = x mod N, r người đầu +1đ. Tổng luôn đúng bằng x.
create or replace function private.allocate(p_total bigint, p_members uuid[])
returns table (user_id uuid, ord int, amount bigint)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_n bigint := coalesce(cardinality(p_members), 0);
begin
  if v_n = 0 then
    perform private.raise_err('NO_ACTIVE_MEMBERS');
  end if;
  if p_total is null or p_total <= 0 then
    perform private.raise_err('INVALID_INPUT', 'tổng phải > 0');
  end if;
  return query
    select t.m, t.i::int, (p_total / v_n) + case when t.i <= p_total % v_n then 1 else 0 end
    from unnest(p_members) with ordinality as t (m, i)
    order by t.i;
end;
$$;

create or replace function private.balance_of(p_user uuid, p_as_of date default null)
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(amount_vnd), 0)::bigint from public.member_ledger
  where user_id = p_user and (p_as_of is null or occurred_on <= p_as_of);
$$;

-- Chuẩn hóa dòng phiếu mua. Trả mảng jsonb có line_no, lỗi → INVALID_INPUT.
create or replace function private.normalize_lines(p_lines jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_line jsonb;
  v_idx int := 0;
  v_type text;
  v_name text;
  v_qty numeric;
  v_unit text;
  v_amount numeric;
  v_out jsonb := '[]'::jsonb;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    perform private.raise_err('INVALID_INPUT', 'phiếu phải có ít nhất 1 dòng');
  end if;
  if jsonb_array_length(p_lines) > 100 then
    perform private.raise_err('INVALID_INPUT', 'tối đa 100 dòng');
  end if;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_idx := v_idx + 1;
    if jsonb_typeof(v_line) <> 'object' then
      perform private.raise_err('INVALID_INPUT', format('dòng %s không hợp lệ', v_idx));
    end if;
    v_type := upper(coalesce(v_line ->> 'line_type', 'ITEM'));
    if v_type not in ('ITEM', 'FEE', 'DISCOUNT') then
      perform private.raise_err('INVALID_INPUT', format('dòng %s: loại dòng không hợp lệ', v_idx));
    end if;
    v_name := private.clean_text(v_line ->> 'item_name');
    if v_name is null or length(v_name) > 200 then
      perform private.raise_err('INVALID_INPUT', format('dòng %s: thiếu tên mặt hàng', v_idx));
    end if;
    if jsonb_typeof(v_line -> 'line_amount_vnd') is distinct from 'number' then
      perform private.raise_err('INVALID_INPUT', format('dòng %s: số tiền phải là số', v_idx));
    end if;
    v_amount := (v_line ->> 'line_amount_vnd')::numeric;
    if v_amount <> trunc(v_amount) or abs(v_amount) > 1000000000000 then
      perform private.raise_err('INVALID_INPUT', format('dòng %s: số tiền phải là số nguyên VND', v_idx));
    end if;
    if (v_type = 'DISCOUNT' and v_amount >= 0) or (v_type <> 'DISCOUNT' and v_amount < 0) then
      perform private.raise_err('INVALID_INPUT', format('dòng %s: giảm giá phải âm, các dòng khác không âm', v_idx));
    end if;
    v_qty := null;
    if v_line ? 'quantity' and jsonb_typeof(v_line -> 'quantity') = 'number' then
      v_qty := round((v_line ->> 'quantity')::numeric, 3);
      if v_qty <= 0 then
        perform private.raise_err('INVALID_INPUT', format('dòng %s: số lượng phải > 0', v_idx));
      end if;
    elsif v_line ? 'quantity' and jsonb_typeof(v_line -> 'quantity') not in ('null') then
      perform private.raise_err('INVALID_INPUT', format('dòng %s: số lượng phải là số', v_idx));
    end if;
    v_unit := private.clean_text(v_line ->> 'unit');
    if v_unit is not null and length(v_unit) > 32 then
      perform private.raise_err('INVALID_INPUT', format('dòng %s: đơn vị quá dài', v_idx));
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'line_no', v_idx, 'line_type', v_type, 'item_name', v_name,
      'quantity', v_qty, 'unit', v_unit, 'line_amount_vnd', v_amount::bigint
    ));
  end loop;
  return v_out;
end;
$$;

create or replace function private.lines_total(p_lines jsonb)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select coalesce(sum((l ->> 'line_amount_vnd')::bigint), 0)::bigint from jsonb_array_elements(p_lines) l;
$$;

-- Hash của bản preview đã xác nhận. Đổi membership/dòng/ngày → hash khác → MEMBERSHIP_CHANGED.
create or replace function private.purchase_hash(
  p_occurred_on date, p_paid_by text, p_payer uuid, p_members uuid[], p_lines jsonb
)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(concat_ws('|',
    'PURCHASE', p_occurred_on::text, p_paid_by, coalesce(p_payer::text, '-'),
    array_to_string(p_members, ','), p_lines::text), 'UTF8')), 'hex');
$$;

create or replace function private.gift_hash(p_occurred_on date, p_amount bigint, p_members uuid[])
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(concat_ws('|',
    'GIFT', p_occurred_on::text, p_amount::text, array_to_string(p_members, ',')), 'UTF8')), 'hex');
$$;

-- Khóa theo idempotency key; trả event đã có (nếu cùng loại) hoặc null
create or replace function private.idem_lookup(p_idem uuid, p_kind public.fund_event_kind)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_kind public.fund_event_kind;
begin
  if p_idem is null then
    perform private.raise_err('INVALID_INPUT', 'idempotency_key bắt buộc');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_idem::text, 0));
  select id, kind into v_id, v_kind from public.fund_events where idempotency_key = p_idem;
  if v_id is null then
    return null;
  end if;
  if v_kind <> p_kind and not (p_kind in ('PURCHASE_FUND', 'PURCHASE_MEMBER') and v_kind in ('PURCHASE_FUND', 'PURCHASE_MEMBER')) then
    perform private.raise_err('DUPLICATE_REFERENCE', 'idempotency_key đã dùng cho giao dịch khác');
  end if;
  return v_id;
end;
$$;

create or replace function private.check_external_ref(p_kind public.fund_event_kind, p_ref text)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_ref is null then
    return;
  end if;
  if length(p_ref) > 64 then
    perform private.raise_err('INVALID_INPUT', 'mã chứng từ tối đa 64 ký tự');
  end if;
  if p_kind in ('PURCHASE_FUND', 'PURCHASE_MEMBER') then
    if exists (select 1 from public.purchases where external_ref = p_ref) then
      perform private.raise_err('DUPLICATE_REFERENCE', p_ref);
    end if;
  elsif exists (select 1 from public.fund_events where kind = p_kind and external_ref = p_ref) then
    perform private.raise_err('DUPLICATE_REFERENCE', p_ref);
  end if;
end;
$$;

create or replace function private.require_profile(p_user uuid, p_field text)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_user is null or not exists (select 1 from public.profiles where id = p_user) then
    perform private.raise_err('INVALID_INPUT', format('%s không tồn tại', p_field));
  end if;
end;
$$;

create or replace function private.event_result(p_event_id uuid, p_replayed boolean)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('event_id', e.id, 'kind', e.kind, 'amount_vnd', e.amount_vnd,
    'occurred_on', e.occurred_on, 'status', e.status, 'replayed', p_replayed,
    'purchase_id', (select p.id from public.purchases p where p.fund_event_id = e.id))
  from public.fund_events e where e.id = p_event_id;
$$;
