-- Registrasi ulang: minimal salah satu sosial media (X / Instagram / TikTok) wajib diisi.
-- Hak akses fungsi tidak berubah (create or replace mempertahankan grant).

create or replace function public.submit_re_registration(
  p_full_name         text,
  p_nickname          text,
  p_email             text,
  p_line_id           text,
  p_domicile          text,
  p_old_member_number text,
  p_proof_path        text,
  p_social_x          text default '',
  p_social_instagram  text default '',
  p_social_tiktok     text default '',
  p_address           text default '',
  p_birth_date        date default null
) returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_name       text := btrim(coalesce(p_full_name, ''));
  v_nick       text := btrim(coalesce(p_nickname, ''));
  v_email      text := lower(btrim(coalesce(p_email, '')));
  v_line       text := btrim(coalesce(p_line_id, ''));
  v_domicile   text := btrim(coalesce(p_domicile, ''));
  v_old        text := public.normalize_old_member_number(p_old_member_number);
  v_x          text := btrim(coalesce(p_social_x, ''));
  v_ig         text := btrim(coalesce(p_social_instagram, ''));
  v_tt         text := btrim(coalesce(p_social_tiktok, ''));
  v_addr       text := btrim(coalesce(p_address, ''));
  v_old_status text;
  v_code       text;
  v_constraint text;
begin
  if char_length(v_name) not between 1 and 120 then
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
  if char_length(v_addr) > 300 then
    raise exception 'INVALID_ADDRESS' using errcode = 'P0001';
  end if;
  if p_birth_date is not null and (p_birth_date < date '1900-01-01' or p_birth_date > current_date) then
    raise exception 'INVALID_BIRTH_DATE' using errcode = 'P0001';
  end if;
  if v_old = '' then
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
  v_old_status := public.check_old_member_number(v_old);
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
      code, full_name, nickname, email, line_id, domicile, old_member_number,
      social_x, social_instagram, social_tiktok, address, birth_date, proof_path
    ) values (
      v_code, v_name, v_nick, v_email, v_line, v_domicile, v_old,
      v_x, v_ig, v_tt, v_addr, p_birth_date, p_proof_path
    );
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 're_registrations_active_old_number_key' then
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
