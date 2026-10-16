-- ---------------------------------------------------------------------------
-- Uang kas: pembayaran registrasi ulang + kelebihan bayar kas lama.
--
--   * Pembayaran registrasi ulang dihitung sebagai uang kas BULAN REGISTRASI (WIB) — jadi bulan itu
--     tidak lagi dihitung tunggakan.
--   * legacy_members.prepaid_months = kelebihan bayar kas (dalam bulan) dari data lama. Saat approve,
--     kelebihan itu melunasi bulan-bulan SESUDAH bulan registrasi (1 bulan -> bulan berikutnya, dst).
--   * dues_payments.source membedakan: 'member' (anggota mengajukan), 're_registration'
--     (pembayaran registrasi ulang), 'legacy_credit' (kelebihan bayar data lama, tanpa bukti).
--   * dues_payments.paid_on = TANGGAL BAYAR (WIB); paid_at (sudah ada) = tanggal APPROVE/verifikasi (WIB).
-- ---------------------------------------------------------------------------

alter table public.legacy_members
  add column prepaid_months integer not null default 0 check (prepaid_months between 0 and 12);

alter table public.dues_payments
  add column source  text not null default 'member'
    check (source in ('member', 're_registration', 'legacy_credit')),
  add column paid_on date;
update public.dues_payments set paid_on = (created_at at time zone 'Asia/Jakarta')::date;
alter table public.dues_payments
  alter column paid_on set not null,
  alter column paid_on set default (now() at time zone 'Asia/Jakarta')::date,
  alter column proof_path drop not null,
  add constraint dues_payments_proof_required check (source = 'legacy_credit' or proof_path is not null);

-- Anggota hasil registrasi ulang yang sudah ada: catat pembayaran registrasinya sebagai uang kas
-- bulan registrasi (dilewati bila bulan itu sudah tertutup pembayaran lain).
do $$
declare
  x       record;
  v_per   text;
  v_pay   uuid;
begin
  for x in
    select r.*, m.id as mid from public.re_registrations r
      join public.members m on m.id = r.member_id
     where r.status = 'approved'
  loop
    v_per := to_char(x.created_at at time zone 'Asia/Jakarta', 'YYYY-MM');
    continue when exists (
      select 1 from public.dues_payment_months pm where pm.member_id = x.mid and pm.period = v_per and pm.active);
    continue when exists (select 1 from public.dues_payments d where d.proof_path = x.proof_path);
    insert into public.dues_payments (
      member_id, amount, status, proof_path, source, period_from, period_to, months,
      reviewed_by, reviewed_at, paid_at, paid_on, created_at
    ) values (
      x.mid, public.dues_monthly_amount(), 'paid', x.proof_path, 're_registration', v_per, v_per, 1,
      x.reviewed_by, x.reviewed_at, (x.reviewed_at at time zone 'Asia/Jakarta')::date,
      (x.created_at at time zone 'Asia/Jakarta')::date, x.created_at
    ) returning id into v_pay;
    insert into public.dues_payment_months (payment_id, member_id, period) values (v_pay, x.mid, v_per);
  end loop;
end $$;

-- Approve registrasi ulang: sekarang juga mencatat uang kas (lihat catatan di atas).
create or replace function public.approve_re_registration(p_id uuid) returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  r            public.re_registrations;
  l            public.legacy_members;
  v_number     text;
  v_member     uuid;
  v_constraint text;
  v_prepaid    integer := 0;
  v_reg_period text;
  v_monthly    integer;
  v_pay        uuid;
  v_credit     text[];
begin
  if not public.is_finance_admin() then
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
    v_prepaid := l.prepaid_months;
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

  -- Uang kas: pembayaran registrasi ulang dihitung sebagai kas BULAN REGISTRASI (WIB, = bulan awal
  -- penagihan), dan kelebihan bayar kas lama (legacy_members.prepaid_months) melunasi bulan-bulan
  -- sesudahnya: 1 bulan -> bulan berikutnya, 2 bulan -> dua bulan berikutnya, dst.
  v_reg_period := to_char(r.created_at at time zone 'Asia/Jakarta', 'YYYY-MM');
  v_monthly := public.dues_monthly_amount();
  insert into public.dues_payments (
    member_id, amount, status, proof_path, source, period_from, period_to, months,
    reviewed_by, reviewed_at, paid_at, paid_on
  ) values (
    v_member, v_monthly, 'paid', r.proof_path, 're_registration', v_reg_period, v_reg_period, 1,
    auth.uid(), now(), (now() at time zone 'Asia/Jakarta')::date, (r.created_at at time zone 'Asia/Jakarta')::date
  ) returning id into v_pay;
  insert into public.dues_payment_months (payment_id, member_id, period) values (v_pay, v_member, v_reg_period);

  if v_prepaid > 0 then
    v_credit := array(
      select to_char(to_date(v_reg_period || '-01', 'YYYY-MM-DD') + make_interval(months => g), 'YYYY-MM')
        from generate_series(1, v_prepaid) as g);
    insert into public.dues_payments (
      member_id, amount, status, proof_path, source, period_from, period_to, months,
      reviewed_by, reviewed_at, paid_at, paid_on
    ) values (
      v_member, v_monthly * v_prepaid, 'paid', null, 'legacy_credit', v_credit[1], v_credit[v_prepaid], v_prepaid,
      auth.uid(), now(), (now() at time zone 'Asia/Jakarta')::date, (r.created_at at time zone 'Asia/Jakarta')::date
    ) returning id into v_pay;
    insert into public.dues_payment_months (payment_id, member_id, period)
    select v_pay, v_member, p from unnest(v_credit) as p;
  end if;

  update public.re_registrations
     set status = 'approved', member_id = v_member,
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id;
  return v_number;
end;
$$;


-- ---------------------------------------------------------------------------
-- Impor nomor anggota lama + kelebihan bayar (jsonb: [{"number": "...", "prepaid": 2}, ...])
--   * nomor baru -> ditambahkan (prepaid default 0)
--   * nomor yang sudah ada & BELUM registrasi ulang -> prepaid diperbarui bila dicantumkan
--   * nomor yang sudah registrasi ulang tidak diubah
-- ---------------------------------------------------------------------------

drop function public.admin_add_legacy_members(text[]);

create function public.admin_add_legacy_members(p_rows jsonb) returns jsonb
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
    select distinct on (num) num, has_prepaid, prepaid, ok
      from (
        select public.normalize_old_member_number(e.value ->> 'number') as num,
               e.ord,
               (nullif(btrim(e.value ->> 'prepaid'), '') is not null) as has_prepaid,
               case when btrim(e.value ->> 'prepaid') ~ '^\d{1,2}$' then btrim(e.value ->> 'prepaid')::integer end as prepaid,
               (public.normalize_old_member_number(e.value ->> 'number') ~ '^[A-Z0-9][A-Z0-9._/-]{0,29}$'
                and (nullif(btrim(e.value ->> 'prepaid'), '') is null
                     or (btrim(e.value ->> 'prepaid') ~ '^\d{1,2}$' and btrim(e.value ->> 'prepaid')::integer <= 12))) as ok
          from jsonb_array_elements(p_rows) with ordinality as e(value, ord)
         where jsonb_typeof(e.value) = 'object'
           and public.normalize_old_member_number(e.value ->> 'number') <> ''
      ) t
     order by num, ord desc
  ),
  ins as (
    insert into public.legacy_members (old_member_number, prepaid_months)
    select num, coalesce(prepaid, 0) from parsed where ok
    on conflict do nothing
    returning 1
  ),
  upd as (
    update public.legacy_members l
       set prepaid_months = p.prepaid
      from parsed p
     where p.ok and p.has_prepaid and l.old_member_number = p.num
       and not l.is_registered and l.prepaid_months <> p.prepaid
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

revoke all on function public.admin_add_legacy_members(jsonb) from public, anon, authenticated;
grant execute on function public.admin_add_legacy_members(jsonb) to authenticated;
