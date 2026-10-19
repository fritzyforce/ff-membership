-- ---------------------------------------------------------------------------
-- 1) Display name Line di daftar nomor anggota lama + pencarian nomor lewat display name Line
--    (di form registrasi ulang: bila nomor tidak ditemukan, anggota boleh mengisi display name Line).
-- 2) Daftar akun staf untuk superadmin (pembuatan akun dilakukan Edge Function create-staff-account).
-- ---------------------------------------------------------------------------

alter table public.legacy_members
  add column line_display_name text not null default '' check (char_length(line_display_name) <= 100);

create function public.normalize_line_name(p_name text) returns text
language sql immutable set search_path = ''
as $$
  select lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'));
$$;

create index legacy_members_line_name_idx
  on public.legacy_members (public.normalize_line_name(line_display_name))
  where line_display_name <> '';

-- Cari nomor anggota lama dari isian pengguna: nomor dulu, lalu display name Line.
-- status: ok | not_found | ambiguous (display name cocok >1 anggota) | registered | in_use
create function public.resolve_old_member_number(p_input text)
returns table (status text, old_member_number text)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_num  text := public.normalize_old_member_number(p_input);
  v_name text := public.normalize_line_name(p_input);
  l      public.legacy_members;
  v_cnt  integer;
begin
  select * into l from public.legacy_members x where x.old_member_number = v_num;
  if not found then
    if v_name = '' then
      return query select 'not_found'::text, null::text;
      return;
    end if;
    select count(*) into v_cnt from public.legacy_members x
     where x.line_display_name <> '' and public.normalize_line_name(x.line_display_name) = v_name;
    if v_cnt = 0 then
      return query select 'not_found'::text, null::text;
      return;
    elsif v_cnt > 1 then
      return query select 'ambiguous'::text, null::text;
      return;
    end if;
    select * into l from public.legacy_members x
     where x.line_display_name <> '' and public.normalize_line_name(x.line_display_name) = v_name;
  end if;

  if l.is_registered then
    return query select 'registered'::text, l.old_member_number;
  elsif exists (
    select 1 from public.re_registrations r
    where r.old_member_number = l.old_member_number and r.status = 'pending'
  ) then
    return query select 'in_use'::text, l.old_member_number;
  else
    return query select 'ok'::text, l.old_member_number;
  end if;
end;
$$;

-- check_old_member_number tetap ada (status saja), kini ikut mengenali display name Line.
create or replace function public.check_old_member_number(p_number text) returns text
language sql stable security definer set search_path = ''
as $$
  select r.status from public.resolve_old_member_number(p_number) r;
$$;

create or replace function public.submit_re_registration(
  p_full_name         text,
  p_nickname          text,
  p_email             text,
  p_line_id           text,
  p_domicile          text,
  p_old_member_number text,
  p_proof_path        text,
  p_social_x          text default '',
  p_social_instagram  text default '',
  p_social_tiktok     text default '',
  p_address           text default '',
  p_birth_date        date default null
) returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_name       text := btrim(coalesce(p_full_name, ''));
  v_nick       text := btrim(coalesce(p_nickname, ''));
  v_email      text := lower(btrim(coalesce(p_email, '')));
  v_line       text := btrim(coalesce(p_line_id, ''));
  v_domicile   text := btrim(coalesce(p_domicile, ''));
  v_input      text := btrim(coalesce(p_old_member_number, ''));
  v_old        text;
  v_x          text := btrim(coalesce(p_social_x, ''));
  v_ig         text := btrim(coalesce(p_social_instagram, ''));
  v_tt         text := btrim(coalesce(p_social_tiktok, ''));
  v_addr       text := btrim(coalesce(p_address, ''));
  v_old_status text;
  v_code       text;
  v_constraint text;
begin
  if char_length(v_name) not between 1 and 120 then
    raise exception 'INVALID_NAME' using errcode = 'P0001';
  end if;
  if char_length(v_nick) not between 1 and 60 then
    raise exception 'INVALID_NICKNAME' using errcode = 'P0001';
  end if;
  if char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'INVALID_EMAIL' using errcode = 'P0001';
  end if;
  if char_length(v_line) not between 1 and 60 then
    raise exception 'INVALID_LINE_ID' using errcode = 'P0001';
  end if;
  if char_length(v_domicile) not between 1 and 100 then
    raise exception 'INVALID_DOMICILE' using errcode = 'P0001';
  end if;
  if char_length(v_x) > 60 or char_length(v_ig) > 60 or char_length(v_tt) > 60 then
    raise exception 'INVALID_SOCIAL' using errcode = 'P0001';
  end if;
  if char_length(v_addr) > 300 then
    raise exception 'INVALID_ADDRESS' using errcode = 'P0001';
  end if;
  if p_birth_date is not null and (p_birth_date < date '1900-01-01' or p_birth_date > current_date) then
    raise exception 'INVALID_BIRTH_DATE' using errcode = 'P0001';
  end if;
  if v_input = '' then
    raise exception 'INVALID_OLD_NUMBER' using errcode = 'P0001';
  end if;
  if p_proof_path is null or p_proof_path !~
     '^re-registrations/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png)$' then
    raise exception 'INVALID_PROOF' using errcode = 'P0001';
  end if;
  -- file benar-benar sudah ada di storage (diunggah sebelum RPC dipanggil)
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'payment-proofs' and o.name = p_proof_path
  ) then
    raise exception 'PROOF_NOT_FOUND' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.members m where lower(m.email) = v_email) then
    raise exception 'EMAIL_ALREADY_MEMBER' using errcode = 'P0001';
  end if;

  -- nomor anggota lama: harus ada di daftar dan belum registrasi ulang
  -- isian boleh nomor anggota lama ATAU display name Line; v_old = nomor kanonik hasil pencarian
  select r.status, r.old_member_number into v_old_status, v_old from public.resolve_old_member_number(v_input) r;
  if v_old_status = 'not_found' then
    raise exception 'OLD_NUMBER_NOT_FOUND' using errcode = 'P0001';
  elsif v_old_status = 'ambiguous' then
    raise exception 'OLD_NUMBER_AMBIGUOUS' using errcode = 'P0001';
  elsif v_old_status = 'registered' then
    raise exception 'OLD_NUMBER_ALREADY_REGISTERED' using errcode = 'P0001';
  elsif v_old_status = 'in_use' then
    raise exception 'OLD_NUMBER_IN_USE' using errcode = 'P0001';
  end if;

  -- minimal satu sosial media wajib (ditaruh setelah cek lain, tepat sebelum insert)
  if v_x = '' and v_ig = '' and v_tt = '' then
    raise exception 'SOCIAL_REQUIRED' using errcode = 'P0001';
  end if;

  v_code := public.generate_re_registration_code();
  begin
    insert into public.re_registrations (
      code, full_name, nickname, email, line_id, domicile, old_member_number,
      social_x, social_instagram, social_tiktok, address, birth_date, proof_path
    ) values (
      v_code, v_name, v_nick, v_email, v_line, v_domicile, v_old,
      v_x, v_ig, v_tt, v_addr, p_birth_date, p_proof_path
    );
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 're_registrations_active_old_number_key' then
      raise exception 'OLD_NUMBER_IN_USE' using errcode = 'P0001';
    end if;
    if v_constraint in ('re_registrations_active_email_key', 're_registrations_proof_path_key') then
      raise exception 'ALREADY_SUBMITTED' using errcode = 'P0001';
    end if;
    raise;
  end;
  return v_code;
end;
$$;

-- ---------------------------------------------------------------------------
-- Impor: tambah kolom line_name ([{"number","prepaid","line_name"}]).
--   * nomor baru -> ditambahkan; nomor yang ada & belum registrasi ulang -> prepaid / line_name
--     diperbarui bila dicantumkan dan berbeda; yang sudah registrasi ulang tidak diubah.
-- ---------------------------------------------------------------------------

create or replace function public.admin_add_legacy_members(p_rows jsonb) returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_added   integer;
  v_updated integer;
  v_valid   integer;
  v_invalid integer;
  v_result  jsonb;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'EMPTY_LIST' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    raise exception 'TOO_MANY' using errcode = 'P0001';
  end if;

  with parsed as (
    select distinct on (num) num, has_prepaid, prepaid, has_line, line_name, ok
      from (
        select public.normalize_old_member_number(e.value ->> 'number') as num,
               e.ord,
               (nullif(btrim(e.value ->> 'prepaid'), '') is not null) as has_prepaid,
               case when btrim(e.value ->> 'prepaid') ~ '^\d{1,2}$' then btrim(e.value ->> 'prepaid')::integer end as prepaid,
               (nullif(btrim(e.value ->> 'line_name'), '') is not null) as has_line,
               btrim(coalesce(e.value ->> 'line_name', '')) as line_name,
               (public.normalize_old_member_number(e.value ->> 'number') ~ '^[A-Z0-9][A-Z0-9._/-]{0,29}$'
                and char_length(btrim(coalesce(e.value ->> 'line_name', ''))) <= 100
                and (nullif(btrim(e.value ->> 'prepaid'), '') is null
                     or (btrim(e.value ->> 'prepaid') ~ '^\d{1,2}$' and btrim(e.value ->> 'prepaid')::integer <= 12))) as ok
          from jsonb_array_elements(p_rows) with ordinality as e(value, ord)
         where jsonb_typeof(e.value) = 'object'
           and public.normalize_old_member_number(e.value ->> 'number') <> ''
      ) t
     order by num, ord desc
  ),
  ins as (
    insert into public.legacy_members (old_member_number, prepaid_months, line_display_name)
    select num, coalesce(prepaid, 0), line_name from parsed where ok
    on conflict do nothing
    returning 1
  ),
  upd as (
    update public.legacy_members l
       set prepaid_months = case when p.has_prepaid then p.prepaid else l.prepaid_months end,
           line_display_name = case when p.has_line then p.line_name else l.line_display_name end
      from parsed p
     where p.ok and l.old_member_number = p.num and not l.is_registered
       and ((p.has_prepaid and l.prepaid_months <> p.prepaid)
            or (p.has_line and l.line_display_name <> p.line_name))
    returning 1
  )
  select (select count(*) from ins), (select count(*) from upd),
         (select count(*) from parsed where ok), (select count(*) from parsed where not ok)
    into v_added, v_updated, v_valid, v_invalid;

  v_result := jsonb_build_object(
    'added', v_added, 'updated', v_updated,
    'duplicate', v_valid - v_added - v_updated, 'invalid', v_invalid);
  perform public.write_audit('legacy_members.added', 'legacy_members', null, v_result);
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Daftar akun staf (superadmin). Email diambil dari auth.users (tidak terbaca dari klien).
-- ---------------------------------------------------------------------------

create function public.superadmin_list_staff()
returns table (
  profile_id       uuid,
  display_name     text,
  email            text,
  role             public.app_role,
  active           boolean,
  email_confirmed  boolean,
  last_sign_in_at  timestamptz,
  created_at       timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_superadmin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return query
    select p.id, p.display_name, u.email::text, p.role, p.active,
           u.email_confirmed_at is not null, u.last_sign_in_at, p.created_at
      from public.profiles p
      join auth.users u on u.id = p.id
     where p.role::text in ('admin', 'admin_finance', 'superadmin')
     order by p.created_at desc;
end;
$$;

revoke all on function public.normalize_line_name(text)             from public, anon, authenticated;
revoke all on function public.resolve_old_member_number(text)       from public, anon, authenticated;
revoke all on function public.check_old_member_number(text)        from public, anon, authenticated;
revoke all on function public.superadmin_list_staff()               from public, anon, authenticated;
revoke all on function public.submit_re_registration(text, text, text, text, text, text, text, text, text, text, text, date)
  from public, anon, authenticated;
revoke all on function public.admin_add_legacy_members(jsonb)       from public, anon, authenticated;

grant execute on function public.resolve_old_member_number(text) to anon, authenticated;
grant execute on function public.check_old_member_number(text)   to anon, authenticated;
grant execute on function public.superadmin_list_staff()          to authenticated;
grant execute on function public.submit_re_registration(text, text, text, text, text, text, text, text, text, text, text, date)
  to anon, authenticated;
grant execute on function public.admin_add_legacy_members(jsonb)  to authenticated;
