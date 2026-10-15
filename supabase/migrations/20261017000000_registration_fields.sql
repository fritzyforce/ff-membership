-- ---------------------------------------------------------------------------
-- Penyesuaian data registrasi ulang & anggota.
--
-- Data pendaftar / anggota sekarang:
--   email, nama lengkap, nickname, ID Line, domisili,
--   sosial media X / IG / TikTok (opsional), alamat lengkap (opsional),
--   tanggal lahir (opsional), nomor anggota lama (khusus registrasi ulang).
--
--   * legacy_members : daftar nomor anggota lama + is_registered (sudah registrasi ulang).
--   * members        : + nickname, domicile, old_member_number; - birth_place, phone.
--   * re_registrations: + kolom di atas.
--   * Nomor anggota lama divalidasi di server: harus ada di legacy_members dan
--     is_registered = false. is_registered baru menjadi true saat admin APPROVE
--     (yang ditolak / belum diproses tidak mengunci nomornya).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1) Daftar nomor anggota lama
-- ---------------------------------------------------------------------------

create function public.normalize_old_member_number(p_number text) returns text
language sql immutable set search_path = ''
as $$
  select upper(regexp_replace(coalesce(p_number, ''), '\s', '', 'g'));
$$;

create table public.legacy_members (
  old_member_number text primary key
    check (old_member_number ~ '^[A-Z0-9][A-Z0-9._/-]{0,29}$'),
  is_registered     boolean not null default false,
  member_id         uuid unique references public.members (id) on delete set null,
  registered_at     timestamptz,
  created_at        timestamptz not null default now(),
  constraint legacy_members_registered_consistency
    check (is_registered or (member_id is null and registered_at is null))
);
create index legacy_members_is_registered_idx on public.legacy_members (is_registered);

-- ---------------------------------------------------------------------------
-- 2) Kolom baru / dihapus
-- ---------------------------------------------------------------------------

alter table public.members
  add column nickname          text not null default '',
  add column domicile          text not null default '',
  add column old_member_number text unique references public.legacy_members (old_member_number),
  drop column birth_place,
  drop column phone;

-- anggota yang sudah ada: nickname sementara = nama depan
update public.members set nickname = split_part(btrim(full_name), ' ', 1) where nickname = '';

alter table public.re_registrations
  add column nickname          text not null default '' check (char_length(nickname) <= 60),
  add column domicile          text not null default '' check (char_length(domicile) <= 100),
  add column social_x          text not null default '' check (char_length(social_x) <= 60),
  add column social_instagram  text not null default '' check (char_length(social_instagram) <= 60),
  add column social_tiktok     text not null default '' check (char_length(social_tiktok) <= 60),
  add column address           text not null default '' check (char_length(address) <= 300),
  add column birth_date        date,
  add column old_member_number text references public.legacy_members (old_member_number);

-- Satu nomor lama hanya boleh dipakai satu pengajuan aktif; yang ditolak membebaskannya.
-- (Kolom sengaja tidak NOT NULL: baris lama dari sebelum migrasi ini tidak punya nilainya.
--  Kewajiban mengisi ditegakkan submit_re_registration.)
create unique index re_registrations_active_old_number_key
  on public.re_registrations (old_member_number)
  where old_member_number is not null and status in ('pending', 'approved');

-- ---------------------------------------------------------------------------
-- 3) Cek nomor anggota lama (publik, dipakai form & submit)
--    'ok' | 'not_found' | 'registered' | 'in_use'
-- ---------------------------------------------------------------------------

create function public.check_old_member_number(p_number text) returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_number text := public.normalize_old_member_number(p_number);
  l        public.legacy_members;
begin
  select * into l from public.legacy_members where old_member_number = v_number;
  if not found then
    return 'not_found';
  end if;
  if l.is_registered then
    return 'registered';
  end if;
  if exists (
    select 1 from public.re_registrations r
    where r.old_member_number = v_number and r.status = 'pending'
  ) then
    return 'in_use';
  end if;
  return 'ok';
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) Submit registrasi ulang (tanda tangan baru)
-- ---------------------------------------------------------------------------

drop function public.submit_re_registration(text, text, text, text);

create function public.submit_re_registration(
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
  v_old        text := public.normalize_old_member_number(p_old_member_number);
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
  if v_old = '' then
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
  v_old_status := public.check_old_member_number(v_old);
  if v_old_status = 'not_found' then
    raise exception 'OLD_NUMBER_NOT_FOUND' using errcode = 'P0001';
  elsif v_old_status = 'registered' then
    raise exception 'OLD_NUMBER_ALREADY_REGISTERED' using errcode = 'P0001';
  elsif v_old_status = 'in_use' then
    raise exception 'OLD_NUMBER_IN_USE' using errcode = 'P0001';
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
-- 5) Approve: salin semua data ke members + tandai nomor lama sudah dipakai
-- ---------------------------------------------------------------------------

create or replace function public.approve_re_registration(p_id uuid) returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  r            public.re_registrations;
  l            public.legacy_members;
  v_number     text;
  v_member     uuid;
  v_constraint text;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select * into r from public.re_registrations where id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if r.status <> 'pending' then
    raise exception 'ALREADY_REVIEWED' using errcode = 'P0001';
  end if;

  -- Cek dulu SEBELUM mengambil nomor, supaya jalur gagal tidak mengunci counter.
  if exists (select 1 from public.members m where lower(m.email) = lower(r.email)) then
    raise exception 'EMAIL_ALREADY_MEMBER' using errcode = 'P0001';
  end if;
  if r.old_member_number is not null then
    select * into l from public.legacy_members
     where old_member_number = r.old_member_number for update;
    if not found then
      raise exception 'OLD_NUMBER_NOT_FOUND' using errcode = 'P0001';
    end if;
    if l.is_registered then
      raise exception 'OLD_NUMBER_ALREADY_REGISTERED' using errcode = 'P0001';
    end if;
  end if;

  v_number := public.next_member_number();
  begin
    insert into public.members (
      member_number, source, full_name, nickname, email, line_id, domicile,
      social_x, social_instagram, social_tiktok, address, birth_date,
      old_member_number, dues_start_period
    ) values (
      v_number, 're_registration', r.full_name, r.nickname, r.email, r.line_id, r.domicile,
      r.social_x, r.social_instagram, r.social_tiktok, r.address, r.birth_date,
      r.old_member_number, to_char(r.created_at at time zone 'Asia/Jakarta', 'YYYY-MM')
    )
    returning id into v_member;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'members_email_key' then
      raise exception 'EMAIL_ALREADY_MEMBER' using errcode = 'P0001';
    end if;
    raise;   -- pelanggaran lain (mis. nomor anggota) jangan disamarkan
  end;

  if r.old_member_number is not null then
    update public.legacy_members
       set is_registered = true, member_id = v_member, registered_at = now()
     where old_member_number = r.old_member_number;
  end if;

  update public.re_registrations
     set status = 'approved', member_id = v_member,
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id;
  return v_number;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6) Admin: kelola daftar nomor anggota lama
-- ---------------------------------------------------------------------------

-- Tambah banyak sekaligus (spasi dibuang, huruf besar, duplikat diabaikan).
create function public.admin_add_legacy_members(p_numbers text[]) returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_all     text[];
  v_valid   text[];
  v_added   integer;
  v_invalid integer;
  v_result  jsonb;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_numbers is null or cardinality(p_numbers) = 0 then
    raise exception 'EMPTY_LIST' using errcode = 'P0001';
  end if;
  if cardinality(p_numbers) > 5000 then
    raise exception 'TOO_MANY' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(distinct s.num), '{}') into v_all
    from (select public.normalize_old_member_number(n) as num from unnest(p_numbers) as n) s
   where s.num <> '';
  v_valid := array(select x from unnest(v_all) as x where x ~ '^[A-Z0-9][A-Z0-9._/-]{0,29}$');
  v_invalid := cardinality(v_all) - cardinality(v_valid);

  insert into public.legacy_members (old_member_number)
  select unnest(v_valid)
  on conflict do nothing;
  get diagnostics v_added = row_count;

  v_result := jsonb_build_object(
    'added', v_added, 'duplicate', cardinality(v_valid) - v_added, 'invalid', v_invalid);
  perform public.write_audit('legacy_members.added', 'legacy_members', null, v_result);
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7) Anggota & admin mengubah profil (tanda tangan baru)
-- ---------------------------------------------------------------------------

drop function public.update_my_member_profile(text, text, text, text, text, text);

create function public.update_my_member_profile(
  p_nickname         text,
  p_domicile         text,
  p_birth_date       date,
  p_address          text,
  p_line_id          text,
  p_social_x         text,
  p_social_instagram text,
  p_social_tiktok    text
) returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_member   uuid := public.current_member_id();
  v_nick     text := btrim(coalesce(p_nickname, ''));
  v_domicile text := btrim(coalesce(p_domicile, ''));
  v_addr     text := btrim(coalesce(p_address, ''));
  v_line     text := btrim(coalesce(p_line_id, ''));
  v_x        text := btrim(coalesce(p_social_x, ''));
  v_ig       text := btrim(coalesce(p_social_instagram, ''));
  v_tt       text := btrim(coalesce(p_social_tiktok, ''));
begin
  if v_member is null then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if char_length(v_nick) not between 1 and 60 then
    raise exception 'INVALID_NICKNAME' using errcode = 'P0001';
  end if;
  if char_length(v_domicile) not between 1 and 100 then
    raise exception 'INVALID_DOMICILE' using errcode = 'P0001';
  end if;
  if p_birth_date is not null and (p_birth_date < date '1900-01-01' or p_birth_date > current_date) then
    raise exception 'INVALID_BIRTH_DATE' using errcode = 'P0001';
  end if;
  if char_length(v_addr) > 300 then
    raise exception 'INVALID_ADDRESS' using errcode = 'P0001';
  end if;
  if char_length(v_line) not between 1 and 60 then
    raise exception 'INVALID_LINE_ID' using errcode = 'P0001';
  end if;
  if char_length(v_x) > 60 or char_length(v_ig) > 60 or char_length(v_tt) > 60 then
    raise exception 'INVALID_SOCIAL' using errcode = 'P0001';
  end if;

  update public.members
     set nickname = v_nick, domicile = v_domicile, birth_date = p_birth_date, address = v_addr,
         line_id = v_line, social_x = v_x, social_instagram = v_ig, social_tiktok = v_tt
   where id = v_member and status = 'active';
  if not found then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
end;
$$;

drop function public.admin_update_member(uuid, text, text, date, text, text, text, text, text, text, text);

create function public.admin_update_member(
  p_id                uuid,
  p_full_name         text,
  p_nickname          text,
  p_domicile          text,
  p_birth_date        date,
  p_address           text,
  p_line_id           text,
  p_social_x          text,
  p_social_instagram  text,
  p_social_tiktok     text,
  p_dues_start_period text
) returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_name     text := btrim(coalesce(p_full_name, ''));
  v_nick     text := btrim(coalesce(p_nickname, ''));
  v_domicile text := btrim(coalesce(p_domicile, ''));
  v_addr     text := btrim(coalesce(p_address, ''));
  v_line     text := btrim(coalesce(p_line_id, ''));
  v_x        text := btrim(coalesce(p_social_x, ''));
  v_ig       text := btrim(coalesce(p_social_instagram, ''));
  v_tt       text := btrim(coalesce(p_social_tiktok, ''));
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 120 then
    raise exception 'INVALID_NAME' using errcode = 'P0001';
  end if;
  if char_length(v_nick) not between 1 and 60 then
    raise exception 'INVALID_NICKNAME' using errcode = 'P0001';
  end if;
  -- admin boleh mengosongkan domisili (data anggota lama belum lengkap)
  if char_length(v_domicile) > 100 then
    raise exception 'INVALID_DOMICILE' using errcode = 'P0001';
  end if;
  if p_birth_date is not null and (p_birth_date < date '1900-01-01' or p_birth_date > current_date) then
    raise exception 'INVALID_BIRTH_DATE' using errcode = 'P0001';
  end if;
  if char_length(v_addr) > 300 then
    raise exception 'INVALID_ADDRESS' using errcode = 'P0001';
  end if;
  if char_length(v_line) not between 1 and 60 then
    raise exception 'INVALID_LINE_ID' using errcode = 'P0001';
  end if;
  if char_length(v_x) > 60 or char_length(v_ig) > 60 or char_length(v_tt) > 60 then
    raise exception 'INVALID_SOCIAL' using errcode = 'P0001';
  end if;
  if p_dues_start_period is null or p_dues_start_period !~ '^\d{4}-(0[1-9]|1[0-2])$'
     or p_dues_start_period < '2020-01'
     or p_dues_start_period > to_char((now() at time zone 'Asia/Jakarta') + interval '1 month', 'YYYY-MM') then
    raise exception 'INVALID_DUES_START' using errcode = 'P0001';
  end if;

  update public.members
     set full_name = v_name, nickname = v_nick, domicile = v_domicile,
         birth_date = p_birth_date, address = v_addr, line_id = v_line,
         social_x = v_x, social_instagram = v_ig, social_tiktok = v_tt,
         dues_start_period = p_dues_start_period
   where id = p_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  update public.profiles set display_name = v_name where member_id = p_id and role = 'member';
  perform public.write_audit('member.updated', 'member', p_id,
    jsonb_build_object('full_name', v_name, 'dues_start_period', p_dues_start_period));
end;
$$;

-- ---------------------------------------------------------------------------
-- 8) Hak akses & RLS
-- ---------------------------------------------------------------------------

revoke all on table public.legacy_members from public, anon, authenticated;
grant select on public.legacy_members to authenticated;
alter table public.legacy_members enable row level security;
create policy "legacy_members: admin baca" on public.legacy_members
  for select to authenticated using (public.is_admin());

revoke all on function public.normalize_old_member_number(text)  from public, anon, authenticated;
revoke all on function public.check_old_member_number(text)      from public, anon, authenticated;
revoke all on function public.submit_re_registration(text, text, text, text, text, text, text, text, text, text, text, date)
  from public, anon, authenticated;
revoke all on function public.admin_add_legacy_members(text[])   from public, anon, authenticated;
revoke all on function public.update_my_member_profile(text, text, date, text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.admin_update_member(uuid, text, text, text, date, text, text, text, text, text, text)
  from public, anon, authenticated;

grant execute on function public.check_old_member_number(text) to anon, authenticated;
grant execute on function public.submit_re_registration(text, text, text, text, text, text, text, text, text, text, text, date)
  to anon, authenticated;
grant execute on function public.admin_add_legacy_members(text[]) to authenticated;
grant execute on function public.update_my_member_profile(text, text, date, text, text, text, text, text)
  to authenticated;
grant execute on function public.admin_update_member(uuid, text, text, text, date, text, text, text, text, text, text)
  to authenticated;
