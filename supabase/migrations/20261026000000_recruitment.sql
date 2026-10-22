-- ---------------------------------------------------------------------------
-- Rekrutmen anggota baru (Join Us) — menggantikan data dummy localStorage.
--
-- Alur:
--   1) Pendaftar mengisi form publik (/join-us)            -> status pending, kode REG-XXXX-XXXX
--   2) Admin finance/superadmin PRE-APPROVE                 -> pre_approved (+ email pemberitahuan)
--   3) Pendaftar membayar (QRIS) & mengunggah bukti          -> payment_submitted
--      (lewat halaman cek status; bukti bisa ditolak -> kembali ke pre_approved dengan catatan)
--   4) Admin finance/superadmin APPROVE                      -> approved: anggota dibuat (FRC-NNN)
--      Pembayaran itu dicatat sebagai UANG KAS PERTAMA: bulan pembayaran (WIB) = bulan awal penagihan.
-- Keputusan (pre-approve, tolak, approve) hanya untuk admin_finance & superadmin (is_finance_admin).
-- ---------------------------------------------------------------------------

create type public.recruitment_status as enum
  ('pending', 'pre_approved', 'payment_submitted', 'approved', 'rejected');

create table public.recruitments (
  id                   uuid primary key default gen_random_uuid(),
  code                 text not null unique,                          -- REG-7K3F-9Q2M (acak)
  full_name            text not null default '' check (char_length(full_name) <= 120),
  nickname             text not null check (char_length(nickname) between 1 and 60),
  email                text not null check (char_length(email) <= 254),
  line_id              text not null check (char_length(line_id) between 1 and 60),
  domicile             text not null check (char_length(domicile) between 1 and 100),
  social_x             text not null default '' check (char_length(social_x) <= 60),
  social_instagram     text not null default '' check (char_length(social_instagram) <= 60),
  social_tiktok        text not null default '' check (char_length(social_tiktok) <= 60),
  reason               text not null check (char_length(reason) between 1 and 1000),   -- alasan join
  status               public.recruitment_status not null default 'pending',
  review_note          text not null default '',      -- catatan admin (tidak tampil ke pendaftar)
  payment_note         text not null default '',      -- alasan bukti bayar ditolak (tampil ke pendaftar)
  proof_path           text unique,                   -- bukti pembayaran (bucket payment-proofs)
  pre_approved_at      timestamptz,
  pre_approved_by      uuid references public.profiles (id) on delete set null,
  payment_submitted_at timestamptz,
  reviewed_by          uuid references public.profiles (id) on delete set null,
  reviewed_at          timestamptz,
  member_id            uuid unique references public.members (id),
  created_at           timestamptz not null default now(),
  constraint recruitments_consistency check (
       (status = 'pending'           and pre_approved_at is null and proof_path is null and member_id is null)
    or (status = 'pre_approved'      and pre_approved_at is not null and proof_path is null
                                     and payment_submitted_at is null and member_id is null)
    or (status = 'payment_submitted' and pre_approved_at is not null and proof_path is not null
                                     and payment_submitted_at is not null and member_id is null)
    or (status = 'approved'          and proof_path is not null and payment_submitted_at is not null
                                     and member_id is not null and reviewed_at is not null)
    or (status = 'rejected'          and reviewed_at is not null and member_id is null)
  )
);
-- Satu pendaftaran aktif per email; yang ditolak boleh mendaftar lagi.
create unique index recruitments_active_email_key
  on public.recruitments (lower(email)) where status <> 'rejected';
create index recruitments_status_created_idx on public.recruitments (status, created_at desc);

-- sumber pembayaran uang kas: pendaftaran anggota baru
alter table public.dues_payments drop constraint dues_payments_source_check;
alter table public.dues_payments add constraint dues_payments_source_check
  check (source in ('member', 're_registration', 'legacy_credit', 'recruitment'));

-- ---------------------------------------------------------------------------
-- Kode pendaftaran acak REG-XXXX-XXXX
-- ---------------------------------------------------------------------------

create function public.generate_recruitment_code() returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
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
    v_code := 'REG-' || substr(chars, 1, 4) || '-' || substr(chars, 5, 4);
    exit when not exists (select 1 from public.recruitments r where r.code = v_code);
    if attempt >= 5 then
      raise exception 'CODE_GENERATION_FAILED' using errcode = 'P0001';
    end if;
  end loop;
  return v_code;
end;
$$;

-- ---------------------------------------------------------------------------
-- Publik: kirim pendaftaran
-- ---------------------------------------------------------------------------

create function public.submit_recruitment(
  p_full_name        text,
  p_nickname         text,
  p_email            text,
  p_line_id          text,
  p_domicile         text,
  p_reason           text,
  p_social_x         text default '',
  p_social_instagram text default '',
  p_social_tiktok    text default ''
) returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_name     text := btrim(coalesce(p_full_name, ''));
  v_nick     text := btrim(coalesce(p_nickname, ''));
  v_email    text := lower(btrim(coalesce(p_email, '')));
  v_line     text := btrim(coalesce(p_line_id, ''));
  v_domicile text := btrim(coalesce(p_domicile, ''));
  v_reason   text := btrim(coalesce(p_reason, ''));
  v_x        text := btrim(coalesce(p_social_x, ''));
  v_ig       text := btrim(coalesce(p_social_instagram, ''));
  v_tt       text := btrim(coalesce(p_social_tiktok, ''));
  v_code     text;
begin
  if char_length(v_name) > 120 then
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
  if char_length(v_reason) not between 1 and 1000 then
    raise exception 'INVALID_REASON' using errcode = 'P0001';
  end if;
  if char_length(v_x) > 60 or char_length(v_ig) > 60 or char_length(v_tt) > 60 then
    raise exception 'INVALID_SOCIAL' using errcode = 'P0001';
  end if;
  if v_x = '' and v_ig = '' and v_tt = '' then
    raise exception 'SOCIAL_REQUIRED' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.members m where lower(m.email) = v_email) then
    raise exception 'EMAIL_ALREADY_MEMBER' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.re_registrations r
    where lower(r.email) = v_email and r.status in ('pending', 'approved')
  ) then
    raise exception 'EMAIL_IN_RE_REGISTRATION' using errcode = 'P0001';
  end if;

  v_code := public.generate_recruitment_code();
  begin
    insert into public.recruitments (
      code, full_name, nickname, email, line_id, domicile, social_x, social_instagram, social_tiktok, reason
    ) values (
      v_code, v_name, v_nick, v_email, v_line, v_domicile, v_x, v_ig, v_tt, v_reason
    );
  exception when unique_violation then
    raise exception 'ALREADY_SUBMITTED' using errcode = 'P0001';
  end;
  return v_code;
end;
$$;

-- ---------------------------------------------------------------------------
-- Publik: cek status (data minimal) & kirim bukti pembayaran
-- ---------------------------------------------------------------------------

create function public.get_recruitment_status(p_code text)
returns table (
  code          text,
  first_name    text,
  status        public.recruitment_status,
  member_number text,
  email         text,
  payment_note  text,
  amount        integer,
  created_at    timestamptz
)
language sql stable security definer set search_path = ''
as $$
  select r.code,
         coalesce(nullif(split_part(btrim(r.full_name), ' ', 1), ''), r.nickname),
         r.status,
         m.member_number,
         case when r.status = 'approved' then r.email else null end,
         r.payment_note,
         public.dues_monthly_amount(),
         r.created_at
  from public.recruitments r
  left join public.members m on m.id = r.member_id
  where r.code = upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
$$;

create function public.submit_recruitment_payment(p_code text, p_proof_path text) returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  r public.recruitments;
begin
  if p_proof_path is null or p_proof_path !~
     '^recruitment/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png)$' then
    raise exception 'INVALID_PROOF' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from storage.objects o where o.bucket_id = 'payment-proofs' and o.name = p_proof_path
  ) then
    raise exception 'PROOF_NOT_FOUND' using errcode = 'P0001';
  end if;

  select * into r from public.recruitments
   where code = upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g')) for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if r.status <> 'pre_approved' then
    raise exception 'NOT_PAYABLE' using errcode = 'P0001';
  end if;

  begin
    update public.recruitments
       set status = 'payment_submitted', proof_path = p_proof_path,
           payment_submitted_at = now(), payment_note = ''
     where id = r.id;
  exception when unique_violation then
    raise exception 'ALREADY_SUBMITTED' using errcode = 'P0001';
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin finance / superadmin: pre-approve, tolak, tolak bukti bayar, approve
-- ---------------------------------------------------------------------------

create function public.pre_approve_recruitment(p_id uuid) returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  r public.recruitments;
begin
  if not public.is_finance_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into r from public.recruitments where id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if r.status <> 'pending' then
    raise exception 'ALREADY_REVIEWED' using errcode = 'P0001';
  end if;
  update public.recruitments
     set status = 'pre_approved', pre_approved_at = now(), pre_approved_by = auth.uid()
   where id = p_id;
  perform public.write_audit('recruitment.pre_approved', 'recruitment', p_id, jsonb_build_object('code', r.code));
end;
$$;

create function public.reject_recruitment(p_id uuid, p_note text) returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  r public.recruitments;
begin
  if not public.is_finance_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into r from public.recruitments where id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if r.status not in ('pending', 'pre_approved', 'payment_submitted') then
    raise exception 'ALREADY_REVIEWED' using errcode = 'P0001';
  end if;
  update public.recruitments
     set status = 'rejected', review_note = btrim(coalesce(p_note, '')),
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id;
  perform public.write_audit('recruitment.rejected', 'recruitment', p_id,
    jsonb_build_object('code', r.code, 'from', r.status));
end;
$$;

-- Bukti bayar tidak sesuai: kembali ke pre_approved supaya pendaftar bisa mengunggah ulang (catatan wajib, tampil ke pendaftar).
create function public.reject_recruitment_payment(p_id uuid, p_note text) returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  r      public.recruitments;
  v_note text := btrim(coalesce(p_note, ''));
begin
  if not public.is_finance_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_note = '' then
    raise exception 'NOTE_REQUIRED' using errcode = 'P0001';
  end if;
  select * into r from public.recruitments where id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if r.status <> 'payment_submitted' then
    raise exception 'ALREADY_REVIEWED' using errcode = 'P0001';
  end if;
  update public.recruitments
     set status = 'pre_approved', proof_path = null, payment_submitted_at = null, payment_note = v_note
   where id = p_id;
  perform public.write_audit('recruitment.payment_rejected', 'recruitment', p_id,
    jsonb_build_object('code', r.code, 'note', v_note));
end;
$$;

-- Approve: anggota dibuat (FRC-NNN) + pembayaran dicatat sebagai uang kas pertama (bulan pembayaran, WIB).
create function public.approve_recruitment(p_id uuid) returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  r            public.recruitments;
  v_number     text;
  v_member     uuid;
  v_name       text;
  v_period     text;
  v_pay        uuid;
  v_constraint text;
begin
  if not public.is_finance_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into r from public.recruitments where id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if r.status <> 'payment_submitted' then
    raise exception 'NOT_PAID' using errcode = 'P0001';
  end if;
  -- cek dulu SEBELUM mengambil nomor, supaya jalur gagal tidak mengunci counter
  if exists (select 1 from public.members m where lower(m.email) = lower(r.email)) then
    raise exception 'EMAIL_ALREADY_MEMBER' using errcode = 'P0001';
  end if;

  v_name := coalesce(nullif(btrim(r.full_name), ''), r.nickname);
  v_period := to_char(r.payment_submitted_at at time zone 'Asia/Jakarta', 'YYYY-MM');
  v_number := public.next_member_number();
  begin
    insert into public.members (
      member_number, source, full_name, nickname, email, line_id, domicile,
      social_x, social_instagram, social_tiktok, dues_start_period
    ) values (
      v_number, 'recruitment', v_name, r.nickname, r.email, r.line_id, r.domicile,
      r.social_x, r.social_instagram, r.social_tiktok, v_period
    ) returning id into v_member;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'members_email_key' then
      raise exception 'EMAIL_ALREADY_MEMBER' using errcode = 'P0001';
    end if;
    raise;
  end;

  -- uang kas pertama = pembayaran pendaftaran (1 bulan iuran, bulan pembayaran)
  insert into public.dues_payments (
    member_id, amount, status, proof_path, source, period_from, period_to, months,
    reviewed_by, reviewed_at, paid_at, paid_on
  ) values (
    v_member, public.dues_monthly_amount(), 'paid', r.proof_path, 'recruitment', v_period, v_period, 1,
    auth.uid(), now(), (now() at time zone 'Asia/Jakarta')::date,
    (r.payment_submitted_at at time zone 'Asia/Jakarta')::date
  ) returning id into v_pay;
  insert into public.dues_payment_months (payment_id, member_id, period) values (v_pay, v_member, v_period);

  update public.recruitments
     set status = 'approved', member_id = v_member, reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id;
  perform public.write_audit('recruitment.approved', 'recruitment', p_id,
    jsonb_build_object('code', r.code, 'member_number', v_number));
  return v_number;
end;
$$;

-- ---------------------------------------------------------------------------
-- Hak akses, RLS, storage
-- ---------------------------------------------------------------------------

revoke all on table public.recruitments from anon, authenticated;
grant select on public.recruitments to authenticated;
alter table public.recruitments enable row level security;
create policy "recruitments: admin baca" on public.recruitments
  for select to authenticated using (public.is_admin());

revoke all on function public.generate_recruitment_code()                         from public, anon, authenticated;
revoke all on function public.submit_recruitment(text, text, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.get_recruitment_status(text)                         from public, anon, authenticated;
revoke all on function public.submit_recruitment_payment(text, text)               from public, anon, authenticated;
revoke all on function public.pre_approve_recruitment(uuid)                        from public, anon, authenticated;
revoke all on function public.reject_recruitment(uuid, text)                       from public, anon, authenticated;
revoke all on function public.reject_recruitment_payment(uuid, text)               from public, anon, authenticated;
revoke all on function public.approve_recruitment(uuid)                            from public, anon, authenticated;

grant execute on function public.submit_recruitment(text, text, text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.get_recruitment_status(text)                      to anon, authenticated;
grant execute on function public.submit_recruitment_payment(text, text)            to anon, authenticated;
grant execute on function public.pre_approve_recruitment(uuid)                     to authenticated;
grant execute on function public.reject_recruitment(uuid, text)                    to authenticated;
grant execute on function public.reject_recruitment_payment(uuid, text)            to authenticated;
grant execute on function public.approve_recruitment(uuid)                         to authenticated;

-- Publik hanya boleh MENAMBAH bukti bayar pendaftaran di recruitment/<uuid>.jpg|png
create policy "payment-proofs: upload bukti pendaftaran anggota baru" on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'payment-proofs'
    and name ~ '^recruitment/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png)$'
  );
