-- ---------------------------------------------------------------------------
-- Fase 5 backend: uang kas dihitung per bulan.
--
--   * Iuran per bulan = app_settings.dues_monthly_amount (Rp 20.000).
--   * Anggota membayar kelipatan iuran; tiap kelipatan = 1 bulan.
--   * Bulan dihitung sejak bulan registrasi / registrasi ulang (members.dues_start_period).
--   * Pembayaran mengisi bulan yang BELUM tertutup paling awal lebih dulu (tunggakan dibayar
--     berurutan); kelebihan otomatis menutup bulan ke depan (maks. 12 bulan dari bulan berjalan).
--   * Pembayaran yang ditolak membuka kembali bulan-bulannya.
--   * Anggota tidak memilih periode: server yang menentukan, supaya tidak bisa melompati tunggakan.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Pengaturan (nilai iuran). Perubahan lewat SQL/dashboard oleh operator.
-- ---------------------------------------------------------------------------

create table public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.app_settings (key, value) values ('dues_monthly_amount', '20000');

create function public.dues_monthly_amount() returns integer
language sql stable security definer set search_path = ''
as $$
  select (s.value #>> '{}')::integer from public.app_settings s where s.key = 'dues_monthly_amount';
$$;

-- ---------------------------------------------------------------------------
-- Bulan awal penagihan per anggota
-- ---------------------------------------------------------------------------

alter table public.members add column dues_start_period text;

-- Data lama: bulan registrasi ulang (WIB) bila ada, selain itu bulan bergabung; tidak boleh
-- lebih lambat dari pembayaran tertua yang sudah ada.
update public.members m
   set dues_start_period = least(
         coalesce(
           (select to_char(r.created_at at time zone 'Asia/Jakarta', 'YYYY-MM')
              from public.re_registrations r where r.member_id = m.id),
           to_char(m.joined_at, 'YYYY-MM')),
         coalesce((select min(d.period) from public.dues_payments d where d.member_id = m.id), '9999-12'));

alter table public.members
  alter column dues_start_period set not null,
  alter column dues_start_period set default to_char(now() at time zone 'Asia/Jakarta', 'YYYY-MM'),
  add constraint members_dues_start_period_format check (dues_start_period ~ '^\d{4}-(0[1-9]|1[0-2])$');

-- ---------------------------------------------------------------------------
-- Pembayaran mencakup rentang bulan; tiap bulan dicatat di dues_payment_months
-- ---------------------------------------------------------------------------

alter table public.dues_payments
  add column period_from text,
  add column period_to   text,
  add column months      integer;
update public.dues_payments set period_from = period, period_to = period, months = 1;
alter table public.dues_payments
  alter column period_from set not null,
  alter column period_to   set not null,
  alter column months      set not null,
  add constraint dues_payments_months_check check (months >= 1 and period_from <= period_to);

create table public.dues_payment_months (
  payment_id uuid not null references public.dues_payments (id) on delete cascade,
  member_id  uuid not null references public.members (id),
  period     text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  -- false setelah pembayaran ditolak -> bulan terbuka lagi
  active     boolean not null default true,
  primary key (payment_id, period)
);
-- satu bulan hanya boleh ditutup oleh satu pembayaran aktif
create unique index dues_payment_months_active_key
  on public.dues_payment_months (member_id, period) where active;

insert into public.dues_payment_months (payment_id, member_id, period, active)
select id, member_id, period, status <> 'rejected' from public.dues_payments;

drop index public.dues_payments_active_period_key;
drop index public.dues_payments_member_period_idx;
alter table public.dues_payments drop column period;
create index dues_payments_member_from_idx on public.dues_payments (member_id, period_from desc);

-- ---------------------------------------------------------------------------
-- Alokasi bulan
-- ---------------------------------------------------------------------------

-- Jumlah bulan untuk sebuah nominal; nominal harus kelipatan iuran bulanan (min. 1 bulan).
create function public.dues_months_for_amount(p_amount integer) returns integer
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_monthly integer := public.dues_monthly_amount();
begin
  if p_amount is null or p_amount < v_monthly or p_amount % v_monthly <> 0 then
    raise exception 'INVALID_AMOUNT' using errcode = 'P0001';
  end if;
  return p_amount / v_monthly;
end;
$$;

-- N bulan berikutnya yang belum tertutup, urut dari yang paling awal (mulai dari dues_start_period).
create function public.dues_next_periods(p_member_id uuid, p_count integer, p_check_horizon boolean default true)
returns text[]
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_start  text;
  v_month  date;
  v_period text;
  v_picked text[] := '{}';
  v_guard  integer := 0;
  v_limit  text := to_char((now() at time zone 'Asia/Jakarta') + interval '12 months', 'YYYY-MM');
begin
  select m.dues_start_period into v_start from public.members m where m.id = p_member_id;
  if v_start is null then
    return null;
  end if;
  v_month := to_date(v_start || '-01', 'YYYY-MM-DD');
  while coalesce(array_length(v_picked, 1), 0) < p_count and v_guard < 600 loop
    v_period := to_char(v_month, 'YYYY-MM');
    if not exists (
      select 1 from public.dues_payment_months pm
       where pm.member_id = p_member_id and pm.period = v_period and pm.active
    ) then
      v_picked := v_picked || v_period;
    end if;
    v_month := (v_month + interval '1 month')::date;
    v_guard := v_guard + 1;
  end loop;
  -- batas pembayaran di muka: 12 bulan dari bulan berjalan
  if p_check_horizon and v_picked[p_count] > v_limit then
    raise exception 'TOO_FAR_AHEAD' using errcode = 'P0001';
  end if;
  return v_picked;
end;
$$;

-- Pratinjau untuk anggota: bulan apa saja yang akan tertutup oleh nominal ini.
create function public.preview_dues_payment(p_amount integer) returns text[]
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_member uuid := public.current_member_id();
begin
  if v_member is null then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return public.dues_next_periods(v_member, public.dues_months_for_amount(p_amount), true);
end;
$$;

-- Ringkasan iuran. Tanpa argumen = anggota yang login; dengan id = admin.
create function public.get_dues_summary(p_member_id uuid default null)
returns table (
  start_period   text,
  next_period    text,
  covered_through text,
  arrears_count  integer,
  monthly_amount integer
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_member uuid;
  v_start  text;
  v_cur    text := to_char(now() at time zone 'Asia/Jakarta', 'YYYY-MM');
begin
  if p_member_id is null then
    v_member := public.current_member_id();
    if v_member is null then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
  else
    if not public.is_admin() then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
    v_member := p_member_id;
  end if;

  select m.dues_start_period into v_start from public.members m where m.id = v_member;
  if v_start is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  return query
    select v_start,
           (select p[1] from (select public.dues_next_periods(v_member, 1, false) as p) x),
           (select max(pm.period) from public.dues_payment_months pm where pm.member_id = v_member and pm.active),
           (select count(*)::integer
              from generate_series(to_date(v_start || '-01', 'YYYY-MM-DD'),
                                   to_date(v_cur || '-01', 'YYYY-MM-DD'), interval '1 month') g(m)
             where not exists (
               select 1 from public.dues_payment_months pm
                where pm.member_id = v_member and pm.period = to_char(g.m, 'YYYY-MM') and pm.active)),
           public.dues_monthly_amount();
end;
$$;

-- ---------------------------------------------------------------------------
-- Ajukan pembayaran (menggantikan versi lama yang memilih periode sendiri)
-- ---------------------------------------------------------------------------

drop function public.submit_dues_payment(text, integer, text);

create function public.submit_dues_payment(p_amount integer, p_proof_path text)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_member     uuid := public.current_member_id();   -- null bila akun/anggota tidak aktif
  v_months     integer;
  v_periods    text[];
  v_id         uuid;
  v_constraint text;
begin
  if v_member is null then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  -- serialkan pengajuan per anggota supaya alokasi bulan tidak saling menimpa
  perform 1 from public.members m where m.id = v_member for update;

  v_months := public.dues_months_for_amount(p_amount);
  -- bukti harus ada di folder anggota ini sendiri
  if p_proof_path is null or p_proof_path !~
     ('^dues/' || v_member::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png)$') then
    raise exception 'INVALID_PROOF' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from storage.objects o where o.bucket_id = 'payment-proofs' and o.name = p_proof_path
  ) then
    raise exception 'PROOF_NOT_FOUND' using errcode = 'P0001';
  end if;
  v_periods := public.dues_next_periods(v_member, v_months, true);

  begin
    insert into public.dues_payments (member_id, amount, proof_path, period_from, period_to, months)
    values (v_member, p_amount, p_proof_path, v_periods[1], v_periods[v_months], v_months)
    returning id into v_id;
    insert into public.dues_payment_months (payment_id, member_id, period)
    select v_id, v_member, p from unnest(v_periods) as p;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    -- file bukti yang sama dipakai ulang (mis. retry setelah sukses)
    if v_constraint = 'dues_payments_proof_path_key' then
      raise exception 'ALREADY_SUBMITTED' using errcode = 'P0001';
    end if;
    raise;
  end;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Approve / reject (audit memuat rentang bulan; reject membuka kembali bulannya)
-- ---------------------------------------------------------------------------

create or replace function public.approve_dues_payment(p_id uuid) returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  r public.dues_payments;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into r from public.dues_payments where id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if r.status <> 'processing' then
    raise exception 'ALREADY_REVIEWED' using errcode = 'P0001';
  end if;

  update public.dues_payments
     set status = 'paid', paid_at = (now() at time zone 'Asia/Jakarta')::date,
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id;
  perform public.write_audit('dues.approved', 'dues_payment', p_id,
    jsonb_build_object('member_id', r.member_id, 'from', r.period_from, 'to', r.period_to,
                       'months', r.months, 'amount', r.amount));
end;
$$;

create or replace function public.reject_dues_payment(p_id uuid, p_note text) returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  r      public.dues_payments;
  v_note text := btrim(coalesce(p_note, ''));
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_note = '' then
    raise exception 'NOTE_REQUIRED' using errcode = 'P0001';
  end if;
  select * into r from public.dues_payments where id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if r.status <> 'processing' then
    raise exception 'ALREADY_REVIEWED' using errcode = 'P0001';
  end if;

  update public.dues_payments
     set status = 'rejected', review_note = v_note,
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id;
  update public.dues_payment_months set active = false where payment_id = p_id;
  perform public.write_audit('dues.rejected', 'dues_payment', p_id,
    jsonb_build_object('member_id', r.member_id, 'from', r.period_from, 'to', r.period_to,
                       'months', r.months, 'amount', r.amount, 'note', v_note));
end;
$$;

-- ---------------------------------------------------------------------------
-- Bulan awal penagihan mengikuti tanggal registrasi (bukan tanggal approve)
-- ---------------------------------------------------------------------------

create or replace function public.approve_re_registration(p_id uuid) returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  r            public.re_registrations;
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

  -- Cek email dulu SEBELUM mengambil nomor, supaya jalur gagal tidak mengunci counter.
  if exists (select 1 from public.members m where lower(m.email) = lower(r.email)) then
    raise exception 'EMAIL_ALREADY_MEMBER' using errcode = 'P0001';
  end if;

  v_number := public.next_member_number();
  begin
    insert into public.members (member_number, source, full_name, email, line_id, dues_start_period)
    values (v_number, 're_registration', r.full_name, r.email, r.line_id,
            to_char(r.created_at at time zone 'Asia/Jakarta', 'YYYY-MM'))
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

-- ---------------------------------------------------------------------------
-- Admin boleh menyesuaikan bulan awal penagihan (mis. anggota lama dengan kasus khusus)
-- ---------------------------------------------------------------------------

drop function public.admin_update_member(uuid, text, text, date, text, text, text, text, text, text);

create function public.admin_update_member(
  p_id               uuid,
  p_full_name        text,
  p_birth_place      text,
  p_birth_date       date,
  p_address          text,
  p_phone            text,
  p_line_id          text,
  p_social_x         text,
  p_social_instagram text,
  p_social_tiktok    text,
  p_dues_start_period text
) returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_name  text := btrim(coalesce(p_full_name, ''));
  v_place text := btrim(coalesce(p_birth_place, ''));
  v_addr  text := btrim(coalesce(p_address, ''));
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[\s-]', '', 'g');
  v_line  text := btrim(coalesce(p_line_id, ''));
  v_x     text := btrim(coalesce(p_social_x, ''));
  v_ig    text := btrim(coalesce(p_social_instagram, ''));
  v_tt    text := btrim(coalesce(p_social_tiktok, ''));
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 120 then
    raise exception 'INVALID_NAME' using errcode = 'P0001';
  end if;
  if char_length(v_place) > 80 then
    raise exception 'INVALID_BIRTH_PLACE' using errcode = 'P0001';
  end if;
  if p_birth_date is not null and (p_birth_date < date '1900-01-01' or p_birth_date > current_date) then
    raise exception 'INVALID_BIRTH_DATE' using errcode = 'P0001';
  end if;
  if char_length(v_addr) > 300 then
    raise exception 'INVALID_ADDRESS' using errcode = 'P0001';
  end if;
  -- admin boleh mengosongkan No. HP (data anggota lama belum lengkap); bila diisi harus valid
  if v_phone <> '' and v_phone !~ '^(\+62|0)8[0-9]{7,12}$' then
    raise exception 'INVALID_PHONE' using errcode = 'P0001';
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
     set full_name = v_name, birth_place = v_place, birth_date = p_birth_date, address = v_addr,
         phone = v_phone, line_id = v_line,
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
-- Hak akses & RLS
-- ---------------------------------------------------------------------------

revoke all on table public.app_settings, public.dues_payment_months from public, anon, authenticated;
grant select on public.app_settings, public.dues_payment_months to authenticated;
alter table public.app_settings enable row level security;
alter table public.dues_payment_months enable row level security;

create policy "app_settings: baca" on public.app_settings for select to authenticated using (true);
create policy "dues_payment_months: anggota baca miliknya" on public.dues_payment_months
  for select to authenticated using (member_id = public.current_member_id());
create policy "dues_payment_months: admin baca" on public.dues_payment_months
  for select to authenticated using (public.is_admin());

revoke all on function public.dues_monthly_amount()                         from public, anon, authenticated;
revoke all on function public.dues_months_for_amount(integer)               from public, anon, authenticated;
revoke all on function public.dues_next_periods(uuid, integer, boolean)    from public, anon, authenticated;
revoke all on function public.preview_dues_payment(integer)                 from public, anon, authenticated;
revoke all on function public.get_dues_summary(uuid)                        from public, anon, authenticated;
revoke all on function public.submit_dues_payment(integer, text)            from public, anon, authenticated;
revoke all on function public.admin_update_member(uuid, text, text, date, text, text, text, text, text, text, text)
  from public, anon, authenticated;

grant execute on function public.preview_dues_payment(integer)              to authenticated;
grant execute on function public.get_dues_summary(uuid)                     to authenticated;
grant execute on function public.submit_dues_payment(integer, text)         to authenticated;
grant execute on function public.admin_update_member(uuid, text, text, date, text, text, text, text, text, text, text)
  to authenticated;
