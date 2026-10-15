-- ---------------------------------------------------------------------------
-- Role admin_finance.
--
--   * admin          : melihat semua data admin (RLS tetap) dan mengelola anggota, tetapi
--                      TIDAK bisa approve/reject pembayaran uang kas maupun registrasi ulang.
--   * admin_finance  : seperti admin + satu-satunya yang boleh approve/reject
--                      pembayaran uang kas dan registrasi ulang.
--   * superadmin     : (diubah di migrasi 20261021: superadmin juga boleh, bisa melakukan semuanya).
--
-- Penegakan ada di database (RPC), bukan hanya UI. Perbandingan role memakai ::text
-- agar tidak terkena "unsafe use of new enum value" di migrasi yang sama dengan penambahan nilai.
-- ---------------------------------------------------------------------------

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active
      and p.role::text in ('admin', 'admin_finance', 'superadmin')
  );
$$;

create function public.is_finance_admin() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active and p.role::text = 'admin_finance'
  );
$$;

revoke all on function public.is_finance_admin() from public, anon, authenticated;
grant execute on function public.is_finance_admin() to authenticated;

-- akun staf boleh didaftarkan dengan role admin_finance
alter table public.account_provisioning drop constraint account_provisioning_role_check;
alter table public.account_provisioning add constraint account_provisioning_role_check
  check (role::text in ('admin', 'admin_finance', 'superadmin'));

-- approve / reject: hanya admin_finance

create or replace function public.approve_dues_payment(p_id uuid) returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  r public.dues_payments;
begin
  if not public.is_finance_admin() then
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
  if not public.is_finance_admin() then
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

create or replace function public.reject_re_registration(p_id uuid, p_note text) returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  r public.re_registrations;
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

  update public.re_registrations
     set status = 'rejected', review_note = btrim(coalesce(p_note, '')),
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id;
end;
$$;
