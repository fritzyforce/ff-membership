-- ---------------------------------------------------------------------------
-- Fase 4 backend: pembayaran uang kas.
--
--   * Anggota mengunggah bukti ke folder miliknya sendiri lalu mengajukan
--     pembayaran per periode (YYYY-MM) -> status "processing".
--   * Admin mengecek bukti lalu Approve (paid) atau Reject (catatan wajib).
--   * Satu pembayaran aktif (processing/paid) per anggota per periode; yang
--     ditolak boleh diajukan lagi.
--   * Browser tidak menulis tabel langsung: semua lewat RPC security definer.
-- ---------------------------------------------------------------------------

create type public.dues_status as enum ('processing', 'paid', 'rejected');

create table public.dues_payments (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.members (id),
  period      text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  amount      integer not null check (amount between 1000 and 10000000),   -- rupiah
  status      public.dues_status not null default 'processing',
  proof_path  text not null unique,                 -- dues/<member_id>/<uuid>.jpg|png
  review_note text not null default '',
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  paid_at     date,                                 -- tanggal verifikasi (WIB) saat paid
  created_at  timestamptz not null default now(),
  constraint dues_payments_review_consistency check (
       (status = 'processing' and reviewed_at is null and paid_at is null)
    or (status = 'paid'       and reviewed_at is not null and paid_at is not null)
    or (status = 'rejected'   and reviewed_at is not null and paid_at is null and review_note <> '')
  )
);
create unique index dues_payments_active_period_key
  on public.dues_payments (member_id, period) where status in ('processing', 'paid');
create index dues_payments_status_created_idx on public.dues_payments (status, created_at desc);
create index dues_payments_member_period_idx  on public.dues_payments (member_id, period desc);

-- ---------------------------------------------------------------------------
-- RPC anggota: ajukan pembayaran
-- ---------------------------------------------------------------------------

create function public.submit_dues_payment(p_period text, p_amount integer, p_proof_path text)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_member     uuid := public.current_member_id();   -- null bila akun/anggota tidak aktif
  v_max_period text := to_char((now() at time zone 'Asia/Jakarta') + interval '1 month', 'YYYY-MM');
  v_id         uuid;
  v_constraint text;
begin
  if v_member is null then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_period is null or p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' or p_period < '2020-01' or p_period > v_max_period then
    raise exception 'INVALID_PERIOD' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount not between 1000 and 10000000 then
    raise exception 'INVALID_AMOUNT' using errcode = 'P0001';
  end if;
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

  begin
    insert into public.dues_payments (member_id, period, amount, proof_path)
    values (v_member, p_period, p_amount, p_proof_path)
    returning id into v_id;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    -- periode sudah aktif, ATAU file bukti yang sama dipakai ulang (mis. retry setelah sukses)
    if v_constraint in ('dues_payments_active_period_key', 'dues_payments_proof_path_key') then
      raise exception 'ALREADY_SUBMITTED' using errcode = 'P0001';
    end if;
    raise;
  end;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC admin: approve & reject
-- ---------------------------------------------------------------------------

create function public.approve_dues_payment(p_id uuid) returns void
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
    jsonb_build_object('member_id', r.member_id, 'period', r.period, 'amount', r.amount));
end;
$$;

create function public.reject_dues_payment(p_id uuid, p_note text) returns void
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
  perform public.write_audit('dues.rejected', 'dues_payment', p_id,
    jsonb_build_object('member_id', r.member_id, 'period', r.period, 'amount', r.amount, 'note', v_note));
end;
$$;

-- ---------------------------------------------------------------------------
-- Hak akses & RLS
-- ---------------------------------------------------------------------------

revoke all on table public.dues_payments from public, anon, authenticated;
grant select on public.dues_payments to authenticated;
alter table public.dues_payments enable row level security;

create policy "dues_payments: anggota baca miliknya" on public.dues_payments
  for select to authenticated using (member_id = public.current_member_id());
create policy "dues_payments: admin baca" on public.dues_payments
  for select to authenticated using (public.is_admin());

revoke all on function public.submit_dues_payment(text, integer, text) from public, anon, authenticated;
revoke all on function public.approve_dues_payment(uuid)               from public, anon, authenticated;
revoke all on function public.reject_dues_payment(uuid, text)          from public, anon, authenticated;
grant execute on function public.submit_dues_payment(text, integer, text) to authenticated;
grant execute on function public.approve_dues_payment(uuid)               to authenticated;
grant execute on function public.reject_dues_payment(uuid, text)          to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: bukti uang kas di payment-proofs/dues/<member_id>/<uuid>.jpg|png
-- Anggota hanya boleh menambah & membaca file di folder miliknya sendiri.
-- (Admin sudah punya policy baca untuk seluruh bucket.)
-- ---------------------------------------------------------------------------

create policy "payment-proofs: anggota upload bukti uang kas" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'payment-proofs'
    and name ~ ('^dues/' || public.current_member_id()::text
                || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png)$')
  );

create policy "payment-proofs: anggota baca bukti miliknya" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'payment-proofs'
    and name like ('dues/' || public.current_member_id()::text || '/%')
  );
