-- ---------------------------------------------------------------------------
-- Daftar anggota lama (legacy_members) disesuaikan dengan data sumber (spreadsheet):
--   Nama Anggota / Admin | Display Line | Nomor Anggota Lama / Status | Lebih Bayar
--
--   * Kunci baris = DISPLAY NAME LINE (wajib & unik, tidak peka huruf besar/kecil/spasi ganda).
--   * old_member_number OPSIONAL (anggota "reset" / "ex admin" tidak punya nomor) tetapi unik bila ada.
--   * member_name (nama anggota) opsional; note menyimpan label seperti "reset" / "ex admin".
--   * prepaid_months = lebih bayar (bulan), default 0.
--   * Registrasi ulang: nama lengkap OPSIONAL; tanggal lahir & alamat tidak lagi dikumpulkan di form.
--   * Pendaftar mengisi nomor ATAU display name Line; tertaut ke baris lewat legacy_member_id.
-- ---------------------------------------------------------------------------

alter table public.members            drop constraint members_old_member_number_fkey;
alter table public.re_registrations   drop constraint re_registrations_old_member_number_fkey;

alter table public.legacy_members add column id uuid not null default gen_random_uuid();
alter table public.legacy_members drop constraint legacy_members_pkey;
alter table public.legacy_members add primary key (id);
alter table public.legacy_members alter column old_member_number drop not null;
alter table public.legacy_members add constraint legacy_members_old_member_number_key unique (old_member_number);

alter table public.legacy_members
  add column member_name text not null default '' check (char_length(member_name) <= 120),
  add column note        text not null default '' check (char_length(note) <= 40);

-- Display name wajib. Baris lama yang belum punya: sementara pakai nomornya.
update public.legacy_members set line_display_name = old_member_number where btrim(line_display_name) = '';
alter table public.legacy_members alter column line_display_name drop default;
alter table public.legacy_members add constraint legacy_members_line_name_required check (btrim(line_display_name) <> '');
drop index public.legacy_members_line_name_idx;
create unique index legacy_members_line_name_key on public.legacy_members (public.normalize_line_name(line_display_name));

alter table public.members
  add constraint members_old_member_number_fkey foreign key (old_member_number)
  references public.legacy_members (old_member_number);

-- re_registrations: tertaut ke daftar lama lewat id; nama opsional; tanpa alamat/tanggal lahir
alter table public.re_registrations add column legacy_member_id uuid references public.legacy_members (id);
update public.re_registrations r set legacy_member_id = l.id
  from public.legacy_members l where l.old_member_number = r.old_member_number;
drop index public.re_registrations_active_old_number_key;
create unique index re_registrations_active_legacy_key
  on public.re_registrations (legacy_member_id)
  where legacy_member_id is not null and status in ('pending', 'approved');

alter table public.re_registrations drop constraint re_registrations_full_name_check;
alter table public.re_registrations add constraint re_registrations_full_name_check check (char_length(full_name) <= 120);
alter table public.re_registrations alter column full_name set default '';
alter table public.re_registrations drop column birth_date, drop column address;

-- ---------------------------------------------------------------------------
-- Pencarian nomor/display name
-- ---------------------------------------------------------------------------

drop function public.check_old_member_number(text);
drop function public.resolve_old_member_number(text);

create function public.resolve_old_member_number(p_input text)
returns table (status text, legacy_id uuid, old_member_number text, line_display_name text, member_name text)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_num   text := public.normalize_old_member_number(p_input);
  v_name  text := public.normalize_line_name(p_input);
  l       public.legacy_members;
  v_found boolean := false;
begin
  if v_num <> '' then
    select * into l from public.legacy_members x where x.old_member_number = v_num;
    v_found := found;
  end if;
  if not v_found and v_name <> '' then
    select * into l from public.legacy_members x where public.normalize_line_name(x.line_display_name) = v_name;
    v_found := found;
  end if;
  if not v_found then
    return query select 'not_found'::text, null::uuid, null::text, null::text, null::text;
    return;
  end if;

  if l.is_registered then
    return query select 'registered'::text, l.id, l.old_member_number, l.line_display_name, l.member_name;
  elsif exists (
    select 1 from public.re_registrations r where r.legacy_member_id = l.id and r.status = 'pending'
  ) then
    return query select 'in_use'::text, l.id, l.old_member_number, l.line_display_name, l.member_name;
  else
    return query select 'ok'::text, l.id, l.old_member_number, l.line_display_name, l.member_name;
  end if;
end;
$$;

create function public.check_old_member_number(p_number text) returns text
language sql stable security definer set search_path = ''
as $$
  select r.status from public.resolve_old_member_number(p_number) r;
$$;

-- ---------------------------------------------------------------------------
-- Submit registrasi ulang (tanda tangan baru: tanpa alamat & tanggal lahir)
-- ---------------------------------------------------------------------------

drop function public.submit_re_registration(text, text, text, text, text, text, text, text, text, text, text, date);

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
  p_social_tiktok     text default ''
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
  v_legacy     uuid;
  v_x          text := btrim(coalesce(p_social_x, ''));
  v_ig         text := btrim(coalesce(p_social_instagram, ''));
  v_tt         text := btrim(coalesce(p_social_tiktok, ''));
  v_old_status text;
  v_code       text;
  v_constraint text;
begin
  -- nama lengkap OPSIONAL (maks. 120 karakter)
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
  if char_length(v_x) > 60 or char_length(v_ig) > 60 or char_length(v_tt) > 60 then
    raise exception 'INVALID_SOCIAL' using errcode = 'P0001';
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
  select r.status, r.legacy_id, r.old_member_number into v_old_status, v_legacy, v_old from public.resolve_old_member_number(v_input) r;
  if v_old_status = 'not_found' then
    raise exception 'OLD_NUMBER_NOT_FOUND' using errcode = 'P0001';
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
      code, full_name, nickname, email, line_id, domicile, legacy_member_id, old_member_number,
      social_x, social_instagram, social_tiktok, proof_path
    ) values (
      v_code, v_name, v_nick, v_email, v_line, v_domicile, v_legacy, v_old,
      v_x, v_ig, v_tt, p_proof_path
    );
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 're_registrations_active_legacy_key' then
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


-- Approve: nama dari daftar lama bila kosong; tautan lewat legacy_member_id; tanpa alamat/tanggal lahir
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
  v_lname      text := '';
  v_name       text;
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
  if r.legacy_member_id is not null then
    select * into l from public.legacy_members
     where id = r.legacy_member_id for update;
    if not found then
      raise exception 'OLD_NUMBER_NOT_FOUND' using errcode = 'P0001';
    end if;
    if l.is_registered then
      raise exception 'OLD_NUMBER_ALREADY_REGISTERED' using errcode = 'P0001';
    end if;
    v_prepaid := l.prepaid_months;
    v_lname := l.member_name;
  end if;

  -- nama anggota: isian pendaftar -> nama dari daftar anggota lama -> nickname
  v_name := coalesce(nullif(btrim(r.full_name), ''), nullif(btrim(v_lname), ''), r.nickname);

  v_number := public.next_member_number();
  begin
    insert into public.members (
      member_number, source, full_name, nickname, email, line_id, domicile,
      social_x, social_instagram, social_tiktok,
      old_member_number, dues_start_period
    ) values (
      v_number, 're_registration', v_name, r.nickname, r.email, r.line_id, r.domicile,
      r.social_x, r.social_instagram, r.social_tiktok,
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

  if r.legacy_member_id is not null then
    update public.legacy_members
       set is_registered = true, member_id = v_member, registered_at = now()
     where id = r.legacy_member_id;
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


-- Status publik: nama depan jatuh ke nickname bila nama lengkap kosong
create or replace function public.get_re_registration_status(p_code text)
returns table (
  code          text,
  first_name    text,
  status        public.re_registration_status,
  member_number text,
  email         text,
  created_at    timestamptz
)
language sql stable security definer set search_path = ''
as $$
  select r.code,
         coalesce(nullif(split_part(btrim(r.full_name), ' ', 1), ''), r.nickname),
         r.status,
         m.member_number,
         case when r.status = 'approved' then r.email else null end,
         r.created_at
  from public.re_registrations r
  left join public.members m on m.id = r.member_id
  where r.code = upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
$$;

-- ---------------------------------------------------------------------------
-- Impor daftar anggota lama.
--   rows: [{"name","line_name","number","prepaid","note"}]  (line_name wajib; lainnya opsional)
--   * baris baru -> ditambahkan; baris yang sudah ada (cocok display name) & belum registrasi ulang ->
--     diperbarui hanya untuk field yang dicantumkan dan berbeda; yang sudah registrasi ulang tidak diubah.
--   * nomor yang sudah dipakai baris lain, nomor ganda dalam daftar, atau field tidak valid -> invalid.
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

  with raw as (
    select e.ord,
           btrim(coalesce(e.value ->> 'line_name', '')) as line_name,
           public.normalize_line_name(e.value ->> 'line_name') as key,
           btrim(coalesce(e.value ->> 'name', '')) as member_name,
           (nullif(btrim(e.value ->> 'name'), '') is not null) as has_name,
           nullif(public.normalize_old_member_number(e.value ->> 'number'), '') as num,
           (nullif(btrim(e.value ->> 'prepaid'), '') is not null) as has_prepaid,
           case when btrim(e.value ->> 'prepaid') ~ '^\d{1,2}$' then btrim(e.value ->> 'prepaid')::integer end as prepaid,
           btrim(coalesce(e.value ->> 'note', '')) as note,
           (nullif(btrim(e.value ->> 'note'), '') is not null) as has_note
      from jsonb_array_elements(p_rows) with ordinality as e(value, ord)
     where jsonb_typeof(e.value) = 'object'
  ),
  dedup as (
    select distinct on (key) * from raw where key <> '' order by key, ord desc
  ),
  parsed as (
    select d.*,
           (char_length(d.line_name) <= 100 and char_length(d.member_name) <= 120 and char_length(d.note) <= 40
            and (d.num is null or d.num ~ '^[A-Z0-9][A-Z0-9._/-]{0,29}$')
            and (not d.has_prepaid or (d.prepaid is not null and d.prepaid <= 12))
            and (d.num is null or (select count(*) from dedup x where x.num = d.num) = 1)
            and (d.num is null or not exists (
                  select 1 from public.legacy_members l
                   where l.old_member_number = d.num and public.normalize_line_name(l.line_display_name) <> d.key))
           ) as ok
      from dedup d
  ),
  ins as (
    insert into public.legacy_members (line_display_name, member_name, old_member_number, prepaid_months, note)
    select line_name, member_name, num, coalesce(prepaid, 0), note from parsed where ok
    on conflict do nothing
    returning 1
  ),
  upd as (
    update public.legacy_members l
       set member_name       = case when p.has_name then p.member_name else l.member_name end,
           old_member_number = coalesce(p.num, l.old_member_number),
           prepaid_months    = case when p.has_prepaid then p.prepaid else l.prepaid_months end,
           note              = case when p.has_note then p.note else l.note end
      from parsed p
     where p.ok and public.normalize_line_name(l.line_display_name) = p.key and not l.is_registered
       and ((p.has_name and l.member_name <> p.member_name)
            or (p.num is not null and l.old_member_number is distinct from p.num)
            or (p.has_prepaid and l.prepaid_months <> p.prepaid)
            or (p.has_note and l.note <> p.note))
    returning 1
  )
  select (select count(*) from ins), (select count(*) from upd),
         (select count(*) from parsed where ok),
         (select count(*) from parsed where not ok) + (select count(*) from raw where key = '')
    into v_added, v_updated, v_valid, v_invalid;

  v_result := jsonb_build_object(
    'added', v_added, 'updated', v_updated,
    'duplicate', v_valid - v_added - v_updated, 'invalid', v_invalid);
  perform public.write_audit('legacy_members.added', 'legacy_members', null, v_result);
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Hak akses
-- ---------------------------------------------------------------------------

revoke all on function public.resolve_old_member_number(text) from public, anon, authenticated;
revoke all on function public.check_old_member_number(text)   from public, anon, authenticated;
revoke all on function public.submit_re_registration(text, text, text, text, text, text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.get_re_registration_status(text) from public, anon, authenticated;
revoke all on function public.admin_add_legacy_members(jsonb)  from public, anon, authenticated;

grant execute on function public.resolve_old_member_number(text) to anon, authenticated;
grant execute on function public.check_old_member_number(text)   to anon, authenticated;
grant execute on function public.submit_re_registration(text, text, text, text, text, text, text, text, text, text)
  to anon, authenticated;
grant execute on function public.get_re_registration_status(text) to anon, authenticated;
grant execute on function public.admin_add_legacy_members(jsonb)  to authenticated;
