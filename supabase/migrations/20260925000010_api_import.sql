-- Import Excel: stage từng dòng + lỗi → preview → commit nguyên khối (một transaction).
-- Server Next.js chỉ đọc file .xlsx thành JSON; mọi kiểm tra nghiệp vụ và posting nằm ở đây.

create or replace function private.try_date(p text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p is null or p !~ '^\d{4}-\d{2}-\d{2}$' then
    return null;
  end if;
  return p::date;
exception when others then
  return null;
end;
$$;

create or replace function private.try_amount(p jsonb)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v numeric;
begin
  if p is null or jsonb_typeof(p) <> 'number' then
    return null;
  end if;
  v := (p #>> '{}')::numeric;
  if v <> trunc(v) or abs(v) > 1000000000000 then
    return null;
  end if;
  return v::bigint;
end;
$$;

create or replace function private.import_key(p_job public.import_jobs, p_ref text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select md5(p_job.file_checksum || ':' || p_job.kind::text || ':' || p_ref)::uuid;
$$;

-- Kiểm tra + chuẩn hóa mọi dòng của job. Ghi errors/normalized, cập nhật status/summary/preview_hash.
-- p_for_commit = true: tài khoản trong import MEMBERS phải đã tồn tại.
create or replace function private.import_validate(p_job_id uuid, p_for_commit boolean default false)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_job public.import_jobs;
  r record;
  g record;
  v_err text[];
  v_n jsonb;
  v_ref text;
  v_date date;
  v_amount bigint;
  v_user uuid;
  v_profile public.profiles;
  v_members uuid[];
  v_lines jsonb;
  v_plan jsonb;
  v_hash_parts text[] := '{}';
  v_errors int;
  v_summary jsonb;
  v_hash text;
  v_detail text;
  v_today date := private.vn_today();
begin
  select * into v_job from public.import_jobs where id = p_job_id for update;
  update public.import_rows set errors = '[]'::jsonb, normalized = null where job_id = p_job_id;

  if v_job.kind in ('DEPOSITS', 'REIMBURSEMENTS', 'GIFTS') then
    for r in select * from public.import_rows where job_id = p_job_id order by row_no loop
      v_err := '{}';
      v_ref := private.clean_text(r.data ->> 'external_ref');
      v_date := private.try_date(r.data ->> 'occurred_on');
      v_amount := private.try_amount(r.data -> 'amount_vnd');
      v_user := null;
      if v_ref is null then v_err := array_append(v_err, 'Thiếu mã chứng từ (external_ref)'); end if;
      if v_ref is not null and length(v_ref) > 64 then v_err := array_append(v_err, 'Mã chứng từ tối đa 64 ký tự'); end if;
      if v_date is null then v_err := array_append(v_err, 'Ngày không hợp lệ (YYYY-MM-DD)');
      elsif v_date > v_today then v_err := array_append(v_err, 'Ngày ở tương lai'); end if;
      if v_amount is null or v_amount <= 0 then v_err := array_append(v_err, 'Số tiền phải là số nguyên dương'); end if;
      if v_ref is not null and exists (select 1 from public.import_rows o where o.job_id = p_job_id
          and o.row_no < r.row_no and private.clean_text(o.data ->> 'external_ref') = v_ref) then
        v_err := array_append(v_err, 'Trùng mã chứng từ trong file');
      end if;
      if v_ref is not null and exists (select 1 from public.fund_events e where e.external_ref = v_ref
          and e.kind = case v_job.kind when 'DEPOSITS' then 'DEPOSIT' when 'GIFTS' then 'GIFT' else 'REIMBURSEMENT' end::public.fund_event_kind) then
        v_err := array_append(v_err, 'Mã chứng từ đã được ghi trước đó');
      end if;
      if v_job.kind <> 'GIFTS' then
        select id into v_user from public.profiles where username = lower(coalesce(private.clean_text(r.data ->> 'username'), ''));
        if v_user is null then v_err := array_append(v_err, 'Không tìm thấy username'); end if;
      elsif v_date is not null and cardinality(private.members_on(v_date)) = 0 then
        v_err := array_append(v_err, 'Không có thành viên quỹ tại ngày này');
      end if;
      v_n := jsonb_build_object('external_ref', v_ref, 'occurred_on', v_date, 'amount_vnd', v_amount,
        'user_id', v_user, 'note', private.clean_text(r.data ->> 'note'));
      if v_job.kind = 'GIFTS' and v_date is not null and v_amount is not null and v_amount > 0 then
        v_members := private.members_on(v_date);
        if cardinality(v_members) > 0 then
          v_n := v_n || jsonb_build_object('preview_hash', private.gift_hash(v_date, v_amount, v_members),
            'split', private.split_info(v_amount, cardinality(v_members)));
          v_hash_parts := v_hash_parts || (v_n ->> 'preview_hash');
        end if;
      end if;
      update public.import_rows set errors = to_jsonb(v_err), normalized = v_n where id = r.id;
      v_hash_parts := v_hash_parts || (r.row_no::text || '=' || v_n::text);
    end loop;

  elsif v_job.kind = 'PURCHASES' then
    -- Mỗi phiếu = nhóm các dòng cùng external_ref
    for r in select * from public.import_rows where job_id = p_job_id and private.clean_text(data ->> 'external_ref') is null loop
      update public.import_rows set errors = '["Thiếu mã phiếu (external_ref)"]'::jsonb where id = r.id;
    end loop;
    for g in
      select private.clean_text(data ->> 'external_ref') as ref, array_agg(id order by row_no) as ids,
        count(distinct coalesce(data ->> 'occurred_on', '')) as n_dates,
        count(distinct upper(coalesce(data ->> 'paid_by', ''))) as n_paid,
        count(distinct lower(coalesce(data ->> 'payer_username', ''))) as n_payer,
        min(data ->> 'occurred_on') as occurred_on, min(upper(data ->> 'paid_by')) as paid_by,
        min(lower(private.clean_text(data ->> 'payer_username'))) as payer_username,
        min(private.clean_text(data ->> 'shop')) as shop, min(private.clean_text(data ->> 'notes')) as notes,
        jsonb_agg(jsonb_build_object('line_type', upper(coalesce(private.clean_text(data ->> 'line_type'), 'ITEM')),
          'item_name', data ->> 'item_name', 'quantity', data -> 'quantity', 'unit', data ->> 'unit',
          'line_amount_vnd', data -> 'line_amount_vnd') order by row_no) as lines
      from public.import_rows
      where job_id = p_job_id and private.clean_text(data ->> 'external_ref') is not null
      group by 1 order by min(row_no)
    loop
      v_err := '{}';
      v_plan := null;
      v_user := null;
      v_date := private.try_date(g.occurred_on);
      if length(g.ref) > 64 then v_err := array_append(v_err, 'Mã phiếu tối đa 64 ký tự'); end if;
      if g.n_dates > 1 or g.n_paid > 1 or g.n_payer > 1 then
        v_err := array_append(v_err, 'Các dòng cùng mã phiếu phải cùng ngày, nguồn trả và người mua');
      end if;
      if exists (select 1 from public.purchases p where p.external_ref = g.ref) then
        v_err := array_append(v_err, 'Mã phiếu đã được ghi trước đó');
      end if;
      if g.paid_by = 'MEMBER' then
        select id into v_user from public.profiles where username = coalesce(g.payer_username, '');
        if v_user is null then v_err := array_append(v_err, 'Không tìm thấy người mua hộ'); end if;
      end if;
      if cardinality(v_err) = 0 then
        begin
          v_plan := private.purchase_plan(v_date, g.paid_by, v_user, g.lines);
        exception when others then
          get stacked diagnostics v_detail = pg_exception_detail;
          v_err := array_append(v_err, (sqlerrm || coalesce(': ' || nullif(v_detail, ''), '')));
        end;
      end if;
      if v_plan is null and cardinality(v_err) = 0 then
        v_err := array_append(v_err, 'Phiếu không hợp lệ');
      end if;
      v_n := case when v_plan is null then null else jsonb_build_object(
        'external_ref', g.ref, 'occurred_on', v_date, 'paid_by', v_plan ->> 'paid_by', 'payer_user_id', v_user,
        'shop', g.shop, 'notes', g.notes, 'lines', v_plan -> 'lines', 'total_vnd', (v_plan ->> 'total')::bigint,
        'preview_hash', v_plan ->> 'preview_hash',
        'split', private.split_info((v_plan ->> 'total')::bigint, jsonb_array_length(v_plan -> 'members'))) end;
      -- normalized của phiếu gắn vào dòng đầu tiên của nhóm
      update public.import_rows set errors = to_jsonb(v_err),
        normalized = case when id = g.ids[1] then v_n else null end
      where id = any (g.ids);
      v_hash_parts := v_hash_parts || (g.ref || '=' || coalesce(v_n::text, 'ERR'));
    end loop;

  elsif v_job.kind = 'MEMBERS' then
    for r in select * from public.import_rows where job_id = p_job_id order by row_no loop
      v_err := '{}';
      v_date := private.try_date(r.data ->> 'start_date');
      v_n := jsonb_build_object(
        'employee_code', private.clean_text(r.data ->> 'employee_code'),
        'username', lower(coalesce(private.clean_text(r.data ->> 'username'), '')),
        'display_name', private.clean_text(r.data ->> 'display_name'),
        'role', upper(coalesce(private.clean_text(r.data ->> 'role'), 'MEMBER')),
        'start_date', v_date,
        'end_date', private.try_date(r.data ->> 'end_date'),
        'reason', coalesce(private.clean_text(r.data ->> 'reason'), 'Import Excel: ' || v_job.file_name));
      if coalesce(v_n ->> 'employee_code', '') !~ '^[A-Za-z0-9._-]{1,32}$' then v_err := array_append(v_err, 'Mã nhân viên không hợp lệ'); end if;
      if (v_n ->> 'username') !~ '^[a-z0-9._-]{3,32}$' then v_err := array_append(v_err, 'Username 3–32 ký tự a-z 0-9 . _ -'); end if;
      if v_n ->> 'display_name' is null or length(v_n ->> 'display_name') > 100 then v_err := array_append(v_err, 'Thiếu tên hiển thị'); end if;
      if (v_n ->> 'role') not in ('MEMBER', 'ADMIN') then v_err := array_append(v_err, 'Vai trò phải là MEMBER hoặc ADMIN'); end if;
      if v_date is null then v_err := array_append(v_err, 'Ngày bắt đầu không hợp lệ (YYYY-MM-DD)'); end if;
      if private.clean_text(r.data ->> 'end_date') is not null and (v_n ->> 'end_date' is null or (v_n ->> 'end_date')::date <= v_date) then
        v_err := array_append(v_err, 'Ngày kết thúc phải sau ngày bắt đầu');
      end if;
      if exists (select 1 from public.import_rows o where o.job_id = p_job_id and o.row_no < r.row_no
          and (lower(o.data ->> 'username') = v_n ->> 'username' or o.data ->> 'employee_code' = v_n ->> 'employee_code')) then
        v_err := array_append(v_err, 'Trùng username/mã nhân viên trong file');
      end if;
      select * into v_profile from public.profiles where username = v_n ->> 'username';
      if found then
        if v_profile.employee_code <> v_n ->> 'employee_code' then
          v_err := array_append(v_err, 'Username đã tồn tại với mã nhân viên khác');
        end if;
        if v_date is not null and exists (select 1 from public.fund_memberships m where m.user_id = v_profile.id
            and daterange(m.start_date, m.end_date, '[)') && daterange(v_date, (v_n ->> 'end_date')::date, '[)')) then
          v_err := array_append(v_err, 'Trùng khoảng thời gian tham gia quỹ đã có');
        end if;
        v_n := v_n || jsonb_build_object('user_id', v_profile.id, 'exists', true);
      else
        if exists (select 1 from public.profiles p where p.employee_code = v_n ->> 'employee_code') then
          v_err := array_append(v_err, 'Mã nhân viên đã thuộc tài khoản khác');
        end if;
        if p_for_commit then v_err := array_append(v_err, 'Tài khoản chưa được tạo'); end if;
        v_n := v_n || jsonb_build_object('exists', false);
      end if;
      update public.import_rows set errors = to_jsonb(v_err), normalized = v_n where id = r.id;
      v_hash_parts := v_hash_parts || (r.row_no::text || '=' || (v_n - 'user_id' - 'exists')::text);
    end loop;
  end if;

  select count(*) into v_errors from public.import_rows where job_id = p_job_id and jsonb_array_length(errors) > 0;
  v_hash := encode(sha256(convert_to(v_job.kind::text || '|' || array_to_string(v_hash_parts, '|'), 'UTF8')), 'hex');

  select jsonb_build_object(
    'rows', count(*),
    'error_rows', v_errors,
    'total_vnd', coalesce(sum(coalesce((normalized ->> 'amount_vnd')::bigint, (normalized ->> 'total_vnd')::bigint, 0)), 0),
    'documents', count(*) filter (where normalized is not null),
    'new_accounts', count(*) filter (where normalized ->> 'exists' = 'false')
  ) into v_summary
  from public.import_rows where job_id = p_job_id;

  update public.import_jobs
  set error_count = v_errors, summary = v_summary, preview_hash = v_hash,
      status = case when v_errors > 0 then 'HAS_ERRORS' else 'READY' end::public.import_status
  where id = p_job_id;
  return v_hash;
end;
$$;

create or replace function private.import_job_json(p_job_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select to_jsonb(j) || jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_object('row_no', r.row_no, 'data', r.data,
      'normalized', r.normalized, 'errors', r.errors) order by r.row_no)
      from public.import_rows r where r.job_id = j.id), '[]'::jsonb))
  from public.import_jobs j where j.id = p_job_id;
$$;

create or replace function api.import_stage(p_kind text, p_file_name text, p_checksum text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
  v_kind text := upper(coalesce(p_kind, ''));
  v_job_id uuid;
  v_dup uuid;
begin
  if v_kind not in ('MEMBERS', 'DEPOSITS', 'GIFTS', 'PURCHASES', 'REIMBURSEMENTS') then
    perform private.raise_err('INVALID_INPUT', 'loại import');
  end if;
  if p_checksum is null or p_checksum !~ '^[0-9a-f]{64}$' then
    perform private.raise_err('INVALID_INPUT', 'checksum');
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    perform private.raise_err('INVALID_INPUT', 'file không có dòng dữ liệu');
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    perform private.raise_err('INVALID_INPUT', 'tối đa 5.000 dòng mỗi file');
  end if;
  select id into v_dup from public.import_jobs
  where kind = v_kind::public.import_kind and file_checksum = p_checksum and status = 'COMMITTED';
  if v_dup is not null then
    perform private.raise_err('IMPORT_DUPLICATE_FILE', v_dup::text);
  end if;
  -- Job cũ chưa commit của cùng file → bỏ
  update public.import_jobs set status = 'DISCARDED'
  where kind = v_kind::public.import_kind and file_checksum = p_checksum and status not in ('COMMITTED', 'DISCARDED');

  insert into public.import_jobs (kind, file_name, file_checksum, row_count, created_by)
  values (v_kind::public.import_kind, left(coalesce(private.clean_text(p_file_name), 'import.xlsx'), 200),
    p_checksum, jsonb_array_length(p_rows), v_admin.id)
  returning id into v_job_id;

  insert into public.import_rows (job_id, row_no, data)
  select v_job_id, coalesce((x ->> 'row_no')::int, ord::int + 1), x - 'row_no'
  from jsonb_array_elements(p_rows) with ordinality as t (x, ord);

  perform private.import_validate(v_job_id);
  perform private.audit(v_admin.id, 'import.stage', 'import_job', v_job_id::text, null,
    jsonb_build_object('kind', v_kind, 'file_name', p_file_name, 'rows', jsonb_array_length(p_rows)));
  return private.import_job_json(v_job_id);
end;
$$;

-- Xem lại preview (tính lại theo dữ liệu hiện tại)
create or replace function api.import_preview(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.import_jobs;
begin
  perform private.require_admin();
  select * into v_job from public.import_jobs where id = p_job_id;
  if not found then
    perform private.raise_err('INVALID_INPUT', 'không tìm thấy job');
  end if;
  if v_job.status not in ('COMMITTED', 'DISCARDED') then
    perform private.import_validate(p_job_id);
  end if;
  return private.import_job_json(p_job_id);
end;
$$;

-- Commit nguyên khối. Trả status HAS_ERRORS/STALE (và lưu trạng thái) thay vì raise để trạng thái được giữ lại.
create or replace function api.import_commit(p_job_id uuid, p_preview_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
  v_job public.import_jobs;
  v_hash text;
  r record;
  v_n jsonb;
  v_count int := 0;
begin
  select * into v_job from public.import_jobs where id = p_job_id for update;
  if not found then
    perform private.raise_err('INVALID_INPUT', 'không tìm thấy job');
  end if;
  if v_job.status = 'COMMITTED' then
    return jsonb_build_object('status', 'COMMITTED', 'job_id', v_job.id, 'replayed', true);
  end if;
  if v_job.status = 'DISCARDED' then
    perform private.raise_err('INVALID_INPUT', 'job đã bị hủy');
  end if;
  if exists (select 1 from public.import_jobs where kind = v_job.kind and file_checksum = v_job.file_checksum
             and status = 'COMMITTED') then
    perform private.raise_err('IMPORT_DUPLICATE_FILE');
  end if;

  v_hash := private.import_validate(p_job_id, true);
  select * into v_job from public.import_jobs where id = p_job_id;
  if v_job.status = 'HAS_ERRORS' then
    return jsonb_build_object('status', 'HAS_ERRORS', 'job_id', v_job.id, 'error_count', v_job.error_count);
  end if;
  if p_preview_hash is null or v_hash <> p_preview_hash then
    update public.import_jobs set status = 'STALE' where id = p_job_id;
    return jsonb_build_object('status', 'STALE', 'job_id', v_job.id);
  end if;

  for r in select * from public.import_rows where job_id = p_job_id and normalized is not null order by row_no loop
    v_n := r.normalized;
    if v_job.kind = 'DEPOSITS' then
      perform private.post_deposit(v_admin.id, private.import_key(v_job, v_n ->> 'external_ref'), (v_n ->> 'user_id')::uuid,
        (v_n ->> 'amount_vnd')::bigint, (v_n ->> 'occurred_on')::date, v_n ->> 'external_ref', v_n ->> 'note', v_job.id);
    elsif v_job.kind = 'REIMBURSEMENTS' then
      perform private.post_reimbursement(v_admin.id, private.import_key(v_job, v_n ->> 'external_ref'), (v_n ->> 'user_id')::uuid,
        (v_n ->> 'amount_vnd')::bigint, (v_n ->> 'occurred_on')::date, v_n ->> 'external_ref', v_n ->> 'note', v_job.id);
    elsif v_job.kind = 'GIFTS' then
      perform private.post_gift(v_admin.id, private.import_key(v_job, v_n ->> 'external_ref'), (v_n ->> 'amount_vnd')::bigint,
        (v_n ->> 'occurred_on')::date, v_n ->> 'preview_hash', v_n ->> 'external_ref', v_n ->> 'note', v_job.id);
    elsif v_job.kind = 'PURCHASES' then
      perform private.post_purchase(v_admin.id, private.import_key(v_job, v_n ->> 'external_ref'), (v_n ->> 'occurred_on')::date,
        v_n ->> 'paid_by', (v_n ->> 'payer_user_id')::uuid, v_n -> 'lines', v_n ->> 'preview_hash',
        v_n ->> 'shop', v_n ->> 'external_ref', v_n ->> 'notes', v_job.id);
    elsif v_job.kind = 'MEMBERS' then
      insert into public.fund_memberships (user_id, start_date, end_date, reason, created_by, updated_by)
      values ((v_n ->> 'user_id')::uuid, (v_n ->> 'start_date')::date, (v_n ->> 'end_date')::date,
        v_n ->> 'reason', v_admin.id, v_admin.id);
    end if;
    v_count := v_count + 1;
  end loop;

  update public.import_jobs set status = 'COMMITTED', committed_at = now() where id = p_job_id;
  perform private.audit(v_admin.id, 'import.commit', 'import_job', p_job_id::text, null,
    jsonb_build_object('kind', v_job.kind, 'documents', v_count, 'file_name', v_job.file_name));
  return jsonb_build_object('status', 'COMMITTED', 'job_id', p_job_id, 'documents', v_count, 'replayed', false);
end;
$$;

create or replace function api.import_discard(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
begin
  update public.import_jobs set status = 'DISCARDED' where id = p_job_id and status not in ('COMMITTED', 'DISCARDED');
  perform private.audit(v_admin.id, 'import.discard', 'import_job', p_job_id::text);
end;
$$;

create or replace function api.import_list_jobs(p_limit int default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return coalesce((
    select jsonb_agg(to_jsonb(j) || jsonb_build_object('created_by_name',
      (select p.display_name from public.profiles p where p.id = j.created_by)) order by j.created_at desc)
    from (select * from public.import_jobs order by created_at desc limit least(greatest(coalesce(p_limit, 20), 1), 100)) j
  ), '[]'::jsonb);
end;
$$;
