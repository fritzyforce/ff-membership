-- ---------------------------------------------------------------------------
-- Fase 1 backend: registrasi ulang anggota lama.
--
--   * profiles          : role admin/superadmin per user Supabase Auth
--   * members           : anggota resmi (dibuat saat registrasi ulang di-approve)
--   * re_registrations  : pengajuan registrasi ulang + hasil review admin
--   * bucket payment-proofs (privat) untuk bukti pembayaran uang kas
--
-- Prinsip akses:
--   * Browser TIDAK menulis tabel langsung. Semua tulis lewat RPC
--     `security definer` yang memvalidasi input & peran.
--   * Publik (anon) hanya boleh: upload bukti ke path terbatas, memanggil
--     submit_re_registration, dan get_re_registration_status.
--   * Admin/superadmin: baca tabel (RLS) + approve/reject lewat RPC.
-- ---------------------------------------------------------------------------

create type public.app_role as enum ('member', 'admin', 'superadmin');
create type public.member_status as enum ('active', 'revoked', 'inactive');
create type public.member_source as enum ('recruitment', 're_registration');
create type public.re_registration_status as enum ('pending', 'approved', 'rejected');

-- ---------------------------------------------------------------------------
-- Tabel
-- ---------------------------------------------------------------------------

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  role         public.app_role not null default 'member',
  display_name text not null default '',
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

create table public.members (
  id               uuid primary key default gen_random_uuid(),
  member_number    text not null unique,               -- FF-2026-0001
  source           public.member_source not null,
  full_name        text not null,
  birth_place      text not null default '',
  birth_date       date,
  address          text not null default '',
  social_x         text not null default '',
  social_instagram text not null default '',
  social_tiktok    text not null default '',
  email            text not null,
  phone            text not null default '',
  line_id          text not null,
  status           public.member_status not null default 'active',
  joined_at        date not null default current_date,
  created_at       timestamptz not null default now()
);
create unique index members_email_key on public.members (lower(email));

create table public.re_registrations (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,                   -- RU-7K3F-9Q2M (acak, tidak berurutan)
  full_name    text not null check (char_length(full_name) between 1 and 120),
  email        text not null check (char_length(email) <= 254),
  line_id      text not null check (char_length(line_id) between 1 and 60),
  proof_path   text not null unique,                   -- path di bucket payment-proofs
  status       public.re_registration_status not null default 'pending',
  review_note  text not null default '',
  reviewed_by  uuid references public.profiles (id) on delete set null,
  reviewed_at  timestamptz,
  member_id    uuid unique references public.members (id),
  created_at   timestamptz not null default now(),
  -- status selalu konsisten dengan data review
  constraint re_registrations_review_consistency check (
       (status = 'pending'  and reviewed_at is null and member_id is null)
    or (status = 'approved' and reviewed_at is not null and member_id is not null)
    or (status = 'rejected' and reviewed_at is not null and member_id is null and review_note <> '')
  )
);
-- Satu pengajuan aktif per email; yang sudah ditolak boleh mengajukan ulang.
create unique index re_registrations_active_email_key
  on public.re_registrations (lower(email)) where status in ('pending', 'approved');
create index re_registrations_status_created_idx
  on public.re_registrations (status, created_at desc);

create sequence public.member_number_seq;

-- ---------------------------------------------------------------------------
-- Helper
-- ---------------------------------------------------------------------------

create function public.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active and p.role in ('admin', 'superadmin')
  );
$$;

-- Kode pendaftaran acak 8 karakter (alfabet tanpa 0/O/1/I), format RU-XXXX-XXXX.
-- Acak (bukan urut) supaya kode tidak bisa ditebak untuk cek status.
create function public.generate_re_registration_code() returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- 32 karakter
  bytes    bytea;
  chars    text;
  v_code   text;
  attempt  int := 0;
  i        int;
begin
  loop
    attempt := attempt + 1;
    bytes := extensions.gen_random_bytes(8);
    chars := '';
    for i in 0..7 loop
      chars := chars || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
    end loop;
    v_code := 'RU-' || substr(chars, 1, 4) || '-' || substr(chars, 5, 4);
    exit when not exists (select 1 from public.re_registrations r where r.code = v_code);
    if attempt >= 5 then
      raise exception 'CODE_GENERATION_FAILED' using errcode = 'P0001';
    end if;
  end loop;
  return v_code;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC publik: kirim registrasi ulang & cek status
-- ---------------------------------------------------------------------------

create function public.submit_re_registration(
  p_full_name  text,
  p_email      text,
  p_line_id    text,
  p_proof_path text
) returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_name       text := btrim(coalesce(p_full_name, ''));
  v_email      text := lower(btrim(coalesce(p_email, '')));
  v_line       text := btrim(coalesce(p_line_id, ''));
  v_code       text;
  v_constraint text;
begin
  if char_length(v_name) not between 1 and 120 then
    raise exception 'INVALID_NAME' using errcode = 'P0001';
  end if;
  if char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'INVALID_EMAIL' using errcode = 'P0001';
  end if;
  if char_length(v_line) not between 1 and 60 then
    raise exception 'INVALID_LINE_ID' using errcode = 'P0001';
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

  v_code := public.generate_re_registration_code();
  begin
    insert into public.re_registrations (code, full_name, email, line_id, proof_path)
    values (v_code, v_name, v_email, v_line, p_proof_path);
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint in ('re_registrations_active_email_key', 're_registrations_proof_path_key') then
      raise exception 'ALREADY_SUBMITTED' using errcode = 'P0001';
    end if;
    raise;
  end;
  return v_code;
end;
$$;

-- Hanya data minimal (nama depan, status) supaya aman walau kode bocor.
create function public.get_re_registration_status(p_code text)
returns table (
  code          text,
  first_name    text,
  status        public.re_registration_status,
  member_number text,
  review_note   text,
  created_at    timestamptz
)
language sql stable security definer set search_path = ''
as $$
  select r.code,
         split_part(btrim(r.full_name), ' ', 1),
         r.status,
         m.member_number,
         case when r.status = 'rejected' then r.review_note else null end,
         r.created_at
  from public.re_registrations r
  left join public.members m on m.id = r.member_id
  where r.code = upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
$$;

-- ---------------------------------------------------------------------------
-- RPC admin: approve & reject (atomik, hanya admin/superadmin aktif)
-- ---------------------------------------------------------------------------

create function public.approve_re_registration(p_id uuid) returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  r          public.re_registrations;
  v_number   text;
  v_member   uuid;
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

  v_number := 'FF-' || to_char(now() at time zone 'Asia/Jakarta', 'YYYY') || '-'
              || lpad(nextval('public.member_number_seq')::text, 4, '0');
  begin
    insert into public.members (member_number, source, full_name, email, line_id)
    values (v_number, 're_registration', r.full_name, r.email, r.line_id)
    returning id into v_member;
  exception when unique_violation then
    raise exception 'EMAIL_ALREADY_MEMBER' using errcode = 'P0001';
  end;

  update public.re_registrations
     set status = 'approved', member_id = v_member,
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id;
  return v_number;
end;
$$;

create function public.reject_re_registration(p_id uuid, p_note text) returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  r      public.re_registrations;
  v_note text := btrim(coalesce(p_note, ''));
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_note = '' then
    raise exception 'NOTE_REQUIRED' using errcode = 'P0001';
  end if;

  select * into r from public.re_registrations where id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if r.status <> 'pending' then
    raise exception 'ALREADY_REVIEWED' using errcode = 'P0001';
  end if;

  update public.re_registrations
     set status = 'rejected', review_note = v_note,
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Hak akses (default Supabase memberi semuanya ke anon/authenticated -> dicabut)
-- ---------------------------------------------------------------------------

revoke all on table public.profiles, public.members, public.re_registrations
  from anon, authenticated;
revoke all on sequence public.member_number_seq from anon, authenticated;

grant select on public.profiles, public.members, public.re_registrations to authenticated;

-- Supabase memberi EXECUTE ke anon/authenticated lewat default privileges, dan
-- `revoke ... from public` tidak mencabutnya -> cabut eksplisit, lalu beri
-- hanya yang dibutuhkan (defense in depth; RPC admin tetap dijaga is_admin()).
revoke all on function public.is_admin()                                       from public, anon, authenticated;
revoke all on function public.generate_re_registration_code()                  from public, anon, authenticated;
revoke all on function public.submit_re_registration(text, text, text, text)   from public, anon, authenticated;
revoke all on function public.get_re_registration_status(text)                 from public, anon, authenticated;
revoke all on function public.approve_re_registration(uuid)                    from public, anon, authenticated;
revoke all on function public.reject_re_registration(uuid, text)               from public, anon, authenticated;

grant execute on function public.is_admin()                                    to authenticated;
grant execute on function public.submit_re_registration(text, text, text, text) to anon, authenticated;
grant execute on function public.get_re_registration_status(text)             to anon, authenticated;
grant execute on function public.approve_re_registration(uuid)                 to authenticated;
grant execute on function public.reject_re_registration(uuid, text)            to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles         enable row level security;
alter table public.members          enable row level security;
alter table public.re_registrations enable row level security;

create policy "profiles: baca milik sendiri" on public.profiles
  for select to authenticated using (id = auth.uid());
create policy "profiles: admin baca semua" on public.profiles
  for select to authenticated using (public.is_admin());

create policy "members: admin baca" on public.members
  for select to authenticated using (public.is_admin());

create policy "re_registrations: admin baca" on public.re_registrations
  for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Storage: bucket privat bukti pembayaran
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 5242880, array['image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Publik hanya boleh MENAMBAH file dengan path <uuid>.jpg|png di folder
-- re-registrations/. Tidak ada select/update/delete untuk publik.
create policy "payment-proofs: upload bukti registrasi ulang" on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'payment-proofs'
    and name ~ '^re-registrations/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png)$'
  );

create policy "payment-proofs: admin baca" on storage.objects
  for select to authenticated
  using (bucket_id = 'payment-proofs' and public.is_admin());
