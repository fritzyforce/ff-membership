-- ---------------------------------------------------------------------------
-- Uang kas anggota dari rekrutmen (Join Us) dihitung mulai NOVEMBER 2026.
--
--   * app_settings.recruitment_dues_start = '2026-11' : bulan paling awal yang dihitung sebagai uang kas pertama.
--   * Bulan uang kas pertama = bulan pembayaran (WIB), tetapi tidak lebih awal dari pengaturan itu
--     (pembayaran Oktober dihitung November; mulai November otomatis memakai bulan pembayaran sebenarnya).
--   * Berlaku untuk bulan awal penagihan (members.dues_start_period) dan pembayaran uang kas pertama.
--   * Status publik memuat first_period supaya halaman pembayaran bisa menyebut bulannya.
-- Ubah nilainya lewat SQL bila perlu: update public.app_settings set value = '"2027-01"' where key = 'recruitment_dues_start';
-- ---------------------------------------------------------------------------

insert into public.app_settings (key, value) values ('recruitment_dues_start', '"2026-11"')
on conflict (key) do nothing;

create function public.recruitment_first_period(p_at timestamptz) returns text
language sql stable security definer set search_path = ''
as $$
  select greatest(
    to_char(p_at at time zone 'Asia/Jakarta', 'YYYY-MM'),
    coalesce((select s.value #>> '{}' from public.app_settings s where s.key = 'recruitment_dues_start'), '0000-00')
  );
$$;

revoke all on function public.recruitment_first_period(timestamptz) from public, anon, authenticated;

-- Approve: bulan uang kas pertama mengikuti recruitment_first_period
create or replace function public.approve_recruitment(p_id uuid) returns text
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
  -- bulan awal uang kas anggota rekrutmen: bulan pembayaran, tetapi tidak lebih awal dari app_settings.recruitment_dues_start
  v_period := public.recruitment_first_period(r.payment_submitted_at);
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


drop function public.get_recruitment_status(text);
create function public.get_recruitment_status(p_code text)
returns table (
  code          text,
  first_name    text,
  status        public.recruitment_status,
  member_number text,
  email         text,
  payment_note  text,
  amount        integer,
  first_period  text,
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
         public.recruitment_first_period(coalesce(r.payment_submitted_at, now())),
         r.created_at
  from public.recruitments r
  left join public.members m on m.id = r.member_id
  where r.code = upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
$$;

revoke all on function public.get_recruitment_status(text) from public, anon, authenticated;
grant execute on function public.get_recruitment_status(text) to anon, authenticated;
