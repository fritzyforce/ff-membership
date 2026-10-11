-- ---------------------------------------------------------------------------
-- Fritzy Force Member Portal — DRAFT schema Supabase untuk fase BERIKUTNYA.
-- Tabel profiles/members/re_registrations sudah nyata di supabase/migrations/
-- (versi di bawah bisa sudah tidak sinkron untuk ketiganya); sisanya belum dipakai.
-- Kolom mengikuti tipe di `lib/types.ts`. Jalankan di SQL editor Supabase
-- saat siap migrasi dari data dummy, lalu ganti isi `lib/data/store.ts`
-- dan `lib/auth.ts` dengan query supabase-js.
-- ---------------------------------------------------------------------------

create type applicant_status as enum ('pending', 'pre_approved', 'payment_submitted', 'approved', 'rejected');
create type member_status    as enum ('active', 'revoked', 'inactive');
create type dues_status      as enum ('paid', 'processing', 'rejected');
create type app_role         as enum ('member', 'admin', 'superadmin');
create type member_source    as enum ('recruitment', 're_registration');
create type re_registration_status as enum ('pending', 'approved', 'rejected');

create table applicants (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,              -- REG-2026-0417
  full_name        text not null,
  birth_place      text not null default '',
  birth_date       date,
  address          text not null,
  social_x         text not null default '',
  social_instagram text not null default '',
  social_tiktok    text not null default '',
  email            text not null,
  phone            text not null,
  line_id          text not null,
  status           applicant_status not null default 'pending',
  review_note      text not null default '',
  payment_proof    text,                               -- path di Supabase Storage
  member_number    text,
  created_at       timestamptz not null default now(),
  constraint applicants_social_required
    check (social_x <> '' or social_instagram <> '' or social_tiktok <> '')
);

-- Registrasi ulang anggota lama (sementara auto-approve).
create table re_registrations (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,                 -- RU-2026-0421
  full_name     text not null,
  email         text not null,
  line_id       text not null,
  proof_file    text not null,                        -- path di Supabase Storage
  status        re_registration_status not null default 'approved',
  member_id     uuid,                                 -- FK ditambah setelah tabel members
  member_number text,
  created_at    timestamptz not null default now()
);

create table members (
  id               uuid primary key default gen_random_uuid(),
  member_number    text not null unique,              -- FF-2026-0417
  source           member_source not null default 'recruitment',
  applicant_id     uuid references applicants (id),
  re_registration_id uuid references re_registrations (id),
  full_name        text not null,
  birth_place      text not null default '',
  birth_date       date,
  address          text not null default '',
  social_x         text not null default '',
  social_instagram text not null default '',
  social_tiktok    text not null default '',
  email            text not null unique,
  phone            text not null default '',
  line_id          text not null,
  status           member_status not null default 'active',
  joined_at        date not null default current_date
);

alter table re_registrations
  add constraint re_registrations_member_fk foreign key (member_id) references members (id);

create table dues_payments (
  id           uuid primary key default gen_random_uuid(),
  member_id    uuid not null references members (id) on delete cascade,
  period       text not null,                         -- YYYY-MM
  amount       integer not null check (amount > 0),
  status       dues_status not null default 'processing',
  proof_file   text,
  submitted_at timestamptz not null default now(),
  paid_at      date
);

-- Satu baris per user Supabase Auth (pengganti `Account` di data dummy).
create table profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  role         app_role not null default 'member',
  member_id    uuid references members (id),
  display_name text not null default '',
  active       boolean not null default true
);

alter table applicants    enable row level security;
alter table members       enable row level security;
alter table dues_payments enable row level security;
alter table profiles      enable row level security;
alter table re_registrations enable row level security;

-- TODO saat migrasi:
--  * policy admin/superadmin: full access (cek profiles.role).
--  * policy member: select members/dues_payments miliknya sendiri, insert dues_payments.
--  * form pendaftaran & cek status publik lewat RPC (security definer) supaya
--    tabel applicants tidak bisa dibaca bebas oleh anon.
--  * bucket storage "payment-proofs" (private) untuk bukti bayar.
