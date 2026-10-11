-- ---------------------------------------------------------------------------
-- Fase 3 backend: manajemen anggota oleh admin.
--
--   * audit_log: setiap tindakan admin pada anggota/akun tercatat (siapa, apa, kapan).
--   * Admin: ubah data anggota, ubah status (aktif / nonaktif / dicabut).
--   * Superadmin: ubah role akun, aktif/nonaktifkan akun, catat permintaan reset password.
--   * Keanggotaan yang tidak aktif otomatis menutup akses anggota ke datanya.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------

create table public.audit_log (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid references public.profiles (id) on delete set null,
  action     text not null,                       -- mis. member.status_changed
  entity     text not null,                       -- member | account | dues_payment ...
  entity_id  uuid,
  details    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_entity_idx on public.audit_log (entity, entity_id, created_at desc);

-- Hanya dipanggil dari RPC security definer lain (tidak diberi ke siapa pun).
create function public.write_audit(p_action text, p_entity text, p_entity_id uuid, p_details jsonb)
returns void
language sql volatile security definer set search_path = ''
as $$
  insert into public.audit_log (actor_id, action, entity, entity_id, details)
  values (auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_details, '{}'::jsonb));
$$;

-- ---------------------------------------------------------------------------
-- Helper peran
-- ---------------------------------------------------------------------------

create function public.is_superadmin() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active and p.role = 'superadmin'
  );
$$;

-- Anggota hanya "ada" bagi RLS/RPC bila akunnya aktif DAN keanggotaannya aktif.
-- Jadi revoke/nonaktif langsung menutup akses walau JWT lama masih berlaku.
create or replace function public.current_member_id() returns uuid
language sql stable security definer set search_path = ''
as $$
  select p.member_id
    from public.profiles p
    join public.members m on m.id = p.member_id
   where p.id = auth.uid() and p.active and m.status = 'active';
$$;

-- ---------------------------------------------------------------------------
-- Admin: ubah data anggota
-- ---------------------------------------------------------------------------

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
  p_social_tiktok    text
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

  update public.members
     set full_name = v_name, birth_place = v_place, birth_date = p_birth_date, address = v_addr,
         phone = v_phone, line_id = v_line,
         social_x = v_x, social_instagram = v_ig, social_tiktok = v_tt
   where id = p_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  update public.profiles set display_name = v_name where member_id = p_id and role = 'member';
  perform public.write_audit('member.updated', 'member', p_id, jsonb_build_object('full_name', v_name));
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: ubah status keanggotaan
-- ---------------------------------------------------------------------------

create function public.admin_set_member_status(
  p_id     uuid,
  p_status public.member_status,
  p_note   text
) returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_old  public.member_status;
  v_note text := btrim(coalesce(p_note, ''));
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.member_id = p_id) then
    raise exception 'CANNOT_MODIFY_SELF' using errcode = 'P0001';
  end if;

  select status into v_old from public.members where id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_old = p_status then
    raise exception 'NO_CHANGE' using errcode = 'P0001';
  end if;
  -- mencabut / menonaktifkan wajib beralasan (tercatat di audit log)
  if p_status <> 'active' and v_note = '' then
    raise exception 'NOTE_REQUIRED' using errcode = 'P0001';
  end if;

  update public.members set status = p_status where id = p_id;
  perform public.write_audit('member.status_changed', 'member', p_id,
    jsonb_build_object('from', v_old, 'to', p_status, 'note', v_note));
end;
$$;

-- ---------------------------------------------------------------------------
-- Superadmin: akun anggota
-- ---------------------------------------------------------------------------

create function public.superadmin_set_account_role(p_member_id uuid, p_role public.app_role) returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_profile public.profiles;
begin
  if not public.is_superadmin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select * into v_profile from public.profiles where member_id = p_member_id for update;
  if not found then
    raise exception 'NO_ACCOUNT' using errcode = 'P0001';
  end if;
  if v_profile.id = auth.uid() then
    raise exception 'CANNOT_MODIFY_SELF' using errcode = 'P0001';
  end if;
  if v_profile.role = p_role then
    raise exception 'NO_CHANGE' using errcode = 'P0001';
  end if;
  -- jangan sampai tidak ada superadmin sama sekali
  if v_profile.role = 'superadmin' and
     (select count(*) from public.profiles where role = 'superadmin' and active) <= 1 then
    raise exception 'LAST_SUPERADMIN' using errcode = 'P0001';
  end if;

  update public.profiles set role = p_role where id = v_profile.id;
  perform public.write_audit('account.role_changed', 'member', p_member_id,
    jsonb_build_object('from', v_profile.role, 'to', p_role));
end;
$$;

create function public.superadmin_set_account_active(p_member_id uuid, p_active boolean) returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_profile public.profiles;
begin
  if not public.is_superadmin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select * into v_profile from public.profiles where member_id = p_member_id for update;
  if not found then
    raise exception 'NO_ACCOUNT' using errcode = 'P0001';
  end if;
  if v_profile.id = auth.uid() then
    raise exception 'CANNOT_MODIFY_SELF' using errcode = 'P0001';
  end if;
  if v_profile.active = p_active then
    raise exception 'NO_CHANGE' using errcode = 'P0001';
  end if;
  if not p_active and v_profile.role = 'superadmin' and
     (select count(*) from public.profiles where role = 'superadmin' and active) <= 1 then
    raise exception 'LAST_SUPERADMIN' using errcode = 'P0001';
  end if;

  update public.profiles set active = p_active where id = v_profile.id;
  perform public.write_audit('account.active_changed', 'member', p_member_id,
    jsonb_build_object('active', p_active));
end;
$$;

-- Pengiriman emailnya dilakukan klien (resetPasswordForEmail); RPC ini hanya mencatat.
create function public.superadmin_log_password_reset(p_member_id uuid) returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if not public.is_superadmin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if not exists (select 1 from public.members where id = p_member_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  perform public.write_audit('account.password_reset_requested', 'member', p_member_id, '{}'::jsonb);
end;
$$;

-- Status akun untuk halaman detail admin (auth.users tidak terbaca dari klien).
create function public.admin_get_member_account(p_member_id uuid)
returns table (
  has_account       boolean,
  role              public.app_role,
  active            boolean,
  email_confirmed   boolean,
  last_sign_in_at   timestamptz,
  account_created   timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return query
    select true, p.role, p.active, u.email_confirmed_at is not null, u.last_sign_in_at, u.created_at
      from public.profiles p
      join auth.users u on u.id = p.id
     where p.member_id = p_member_id;
  if not found then
    return query select false, null::public.app_role, null::boolean, null::boolean, null::timestamptz, null::timestamptz;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Hak akses & RLS
-- ---------------------------------------------------------------------------

revoke all on table public.audit_log from public, anon, authenticated;
grant select on public.audit_log to authenticated;
alter table public.audit_log enable row level security;
create policy "audit_log: admin baca" on public.audit_log
  for select to authenticated using (public.is_admin());

revoke all on function public.write_audit(text, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.is_superadmin() from public, anon, authenticated;
revoke all on function public.admin_update_member(uuid, text, text, date, text, text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.admin_set_member_status(uuid, public.member_status, text)
  from public, anon, authenticated;
revoke all on function public.superadmin_set_account_role(uuid, public.app_role) from public, anon, authenticated;
revoke all on function public.superadmin_set_account_active(uuid, boolean)       from public, anon, authenticated;
revoke all on function public.superadmin_log_password_reset(uuid)                from public, anon, authenticated;
revoke all on function public.admin_get_member_account(uuid)                     from public, anon, authenticated;

grant execute on function public.is_superadmin() to authenticated;
grant execute on function public.admin_update_member(uuid, text, text, date, text, text, text, text, text, text)
  to authenticated;
grant execute on function public.admin_set_member_status(uuid, public.member_status, text) to authenticated;
grant execute on function public.superadmin_set_account_role(uuid, public.app_role)        to authenticated;
grant execute on function public.superadmin_set_account_active(uuid, boolean)              to authenticated;
grant execute on function public.superadmin_log_password_reset(uuid)                       to authenticated;
grant execute on function public.admin_get_member_account(uuid)                            to authenticated;
