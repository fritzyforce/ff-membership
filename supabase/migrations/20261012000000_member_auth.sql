-- ---------------------------------------------------------------------------
-- Fase 2 backend: daftar & login member.
--
--   * Nomor anggota FF-001 .. FF-999, berurutan TANPA celah, diberikan saat approve.
--   * profiles.member_id: menautkan akun (auth.users) ke anggota.
--   * Sign-up publik dijaga trigger: hanya email anggota aktif yang belum punya
--     akun yang boleh membuat akun. Selain itu sign-up dibatalkan.
--   * Anggota boleh membaca & mengubah (terbatas) data dirinya sendiri.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1) Penomoran anggota: counter transaksional (bukan sequence)
--
-- Sequence Postgres tidak ikut rollback, sehingga approve yang gagal
-- meninggalkan celah (FF-003 -> FF-005). Counter satu baris dengan row lock
-- ikut transaksi: gagal = nomor tidak terpakai, dan approve bersamaan antre.
-- ---------------------------------------------------------------------------

create table public.member_counter (
  id         boolean primary key default true check (id),   -- tepat satu baris
  last_value integer not null default 0 check (last_value between 0 and 999)
);

-- Penomoran ulang data yang sudah ada (hanya relevan untuk DB dev; format lama
-- FF-YYYY-NNNN) berdasarkan urutan dibuat, lalu counter menyusul.
do $$
begin
  if (select count(*) from public.members) > 999 then
    raise exception 'Lebih dari 999 anggota: tidak bisa memakai format FF-NNN';
  end if;
end $$;

with ordered as (
  select id, row_number() over (order by created_at, id) as rn from public.members
)
update public.members m
   set member_number = 'FF-' || lpad(o.rn::text, 3, '0')
  from ordered o
 where o.id = m.id;

insert into public.member_counter (id, last_value)
values (true, (select count(*) from public.members));

alter table public.members
  add constraint members_member_number_format check (member_number ~ '^FF-\d{3}$');

create function public.next_member_number() returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v integer;
begin
  -- FOR UPDATE mengunci baris counter sampai transaksi selesai -> berurutan & gapless
  select c.last_value into v from public.member_counter c where c.id for update;
  if v is null or v >= 999 then
    raise exception 'MEMBER_NUMBER_EXHAUSTED' using errcode = 'P0001';
  end if;
  update public.member_counter set last_value = v + 1 where id;
  return 'FF-' || lpad((v + 1)::text, 3, '0');
end;
$$;

create or replace function public.approve_re_registration(p_id uuid) returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  r          public.re_registrations;
  v_number   text;
  v_member   uuid;
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

  -- Cek email dulu SEBELUM mengambil nomor, supaya jalur gagal tidak mengunci counter.
  if exists (select 1 from public.members m where lower(m.email) = lower(r.email)) then
    raise exception 'EMAIL_ALREADY_MEMBER' using errcode = 'P0001';
  end if;

  v_number := public.next_member_number();
  begin
    insert into public.members (member_number, source, full_name, email, line_id)
    values (v_number, 're_registration', r.full_name, r.email, r.line_id)
    returning id into v_member;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'members_email_key' then
      raise exception 'EMAIL_ALREADY_MEMBER' using errcode = 'P0001';
    end if;
    raise;   -- pelanggaran lain (mis. nomor anggota) jangan disamarkan
  end;

  update public.re_registrations
     set status = 'approved', member_id = v_member,
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id;
  return v_number;
end;
$$;

drop sequence public.member_number_seq;

-- ---------------------------------------------------------------------------
-- 2) Akun <-> anggota
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column member_id uuid unique references public.members (id);

create function public.current_member_id() returns uuid
language sql stable security definer set search_path = ''
as $$
  select p.member_id from public.profiles p where p.id = auth.uid() and p.active;
$$;

-- Penyediaan akun staf (admin/superadmin), sekali pakai.
-- Operator mendaftarkan email + role LEBIH DULU (service role / SQL editor), lalu
-- membuat user lewat dashboard/Admin API. Trigger di bawah membuat profile-nya
-- dan MENGHAPUS baris ini, jadi tidak ada jendela terbuka yang tersisa.
-- (app_metadata tidak bisa dipakai: GoTrue menerapkannya SETELAH insert.)
create table public.account_provisioning (
  email        text primary key,
  role         public.app_role not null check (role in ('admin', 'superadmin')),
  display_name text not null default '',
  created_at   timestamptz not null default now(),
  constraint account_provisioning_email_lower check (email = lower(email))
);

-- Penjaga sign-up publik. Berjalan di transaksi yang sama dengan insert ke
-- auth.users: bila melempar error, akun TIDAK jadi dibuat.
--
--   1) Email terdaftar di account_provisioning -> akun staf (profile dengan role itu).
--   2) Selain itu: email harus milik anggota aktif & belum punya akun.
--
-- Otorisasi sebenarnya tetap ada di tabel profiles (RLS); akun tanpa profile
-- tidak punya akses apa pun.
create function public.handle_new_auth_user() returns trigger
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_prov   public.account_provisioning;
  v_member public.members;
begin
  select * into v_prov from public.account_provisioning where email = lower(new.email);
  if found then
    insert into public.profiles (id, role, display_name)
    values (new.id, v_prov.role, coalesce(nullif(v_prov.display_name, ''), new.email));
    delete from public.account_provisioning where email = v_prov.email;
    return new;
  end if;

  select * into v_member
    from public.members m
   where lower(m.email) = lower(new.email) and m.status = 'active';
  if not found then
    raise exception 'MEMBER_NOT_ELIGIBLE' using errcode = 'P0001';
  end if;

  begin
    insert into public.profiles (id, role, member_id, display_name)
    values (new.id, 'member', v_member.id, v_member.full_name);
  exception when unique_violation then
    raise exception 'MEMBER_ALREADY_HAS_ACCOUNT' using errcode = 'P0001';
  end;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- 3) Anggota mengubah profilnya sendiri (kolom terbatas, lewat RPC)
-- ---------------------------------------------------------------------------

create function public.update_my_member_profile(
  p_address          text,
  p_phone            text,
  p_line_id          text,
  p_social_x         text,
  p_social_instagram text,
  p_social_tiktok    text
) returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_member uuid := public.current_member_id();
  v_addr   text := btrim(coalesce(p_address, ''));
  v_phone  text := regexp_replace(coalesce(p_phone, ''), '[\s-]', '', 'g');
  v_line   text := btrim(coalesce(p_line_id, ''));
  v_x      text := btrim(coalesce(p_social_x, ''));
  v_ig     text := btrim(coalesce(p_social_instagram, ''));
  v_tt     text := btrim(coalesce(p_social_tiktok, ''));
begin
  if v_member is null then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if char_length(v_addr) not between 1 and 300 then
    raise exception 'INVALID_ADDRESS' using errcode = 'P0001';
  end if;
  if v_phone !~ '^(\+62|0)8[0-9]{7,12}$' then
    raise exception 'INVALID_PHONE' using errcode = 'P0001';
  end if;
  if char_length(v_line) not between 1 and 60 then
    raise exception 'INVALID_LINE_ID' using errcode = 'P0001';
  end if;
  if char_length(v_x) > 60 or char_length(v_ig) > 60 or char_length(v_tt) > 60 then
    raise exception 'INVALID_SOCIAL' using errcode = 'P0001';
  end if;
  if v_x = '' and v_ig = '' and v_tt = '' then
    raise exception 'SOCIAL_REQUIRED' using errcode = 'P0001';
  end if;

  update public.members
     set address = v_addr, phone = v_phone, line_id = v_line,
         social_x = v_x, social_instagram = v_ig, social_tiktok = v_tt
   where id = v_member and status = 'active';
  if not found then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) Hak akses & RLS
-- ---------------------------------------------------------------------------

revoke all on table public.member_counter, public.account_provisioning from public, anon, authenticated;
alter table public.member_counter enable row level security;        -- tanpa policy = tertutup
alter table public.account_provisioning enable row level security;  -- tanpa policy = tertutup

revoke all on function public.next_member_number()           from public, anon, authenticated;
revoke all on function public.current_member_id()            from public, anon, authenticated;
revoke all on function public.handle_new_auth_user()         from public, anon, authenticated;
revoke all on function public.update_my_member_profile(text, text, text, text, text, text)
  from public, anon, authenticated;

grant execute on function public.current_member_id() to authenticated;
grant execute on function public.update_my_member_profile(text, text, text, text, text, text)
  to authenticated;

create policy "members: baca milik sendiri" on public.members
  for select to authenticated using (id = public.current_member_id());
