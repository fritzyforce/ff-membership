-- ---------------------------------------------------------------------------
-- Penyesuaian registrasi ulang:
--   * Catatan review SELALU opsional (juga saat Reject) dan hanya untuk admin:
--     status publik tidak lagi mengembalikan catatan.
--   * Status publik mengembalikan email pendaftar HANYA bila sudah approved,
--     supaya halaman "Registrasi Akun" bisa mengisinya otomatis. Kode registrasi
--     acak (RU-XXXX-XXXX) bertindak sebagai kunci rahasia pemiliknya.
-- ---------------------------------------------------------------------------

alter table public.re_registrations drop constraint re_registrations_review_consistency;
alter table public.re_registrations add constraint re_registrations_review_consistency check (
     (status = 'pending'  and reviewed_at is null and member_id is null)
  or (status = 'approved' and reviewed_at is not null and member_id is not null)
  or (status = 'rejected' and reviewed_at is not null and member_id is null)
);

create or replace function public.reject_re_registration(p_id uuid, p_note text) returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  r public.re_registrations;
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

  update public.re_registrations
     set status = 'rejected', review_note = btrim(coalesce(p_note, '')),
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id;
end;
$$;

-- kolom review_note diganti email -> tipe kembalian berubah, fungsi dibuat ulang
drop function public.get_re_registration_status(text);
create function public.get_re_registration_status(p_code text)
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
         split_part(btrim(r.full_name), ' ', 1),
         r.status,
         m.member_number,
         case when r.status = 'approved' then r.email else null end,
         r.created_at
  from public.re_registrations r
  left join public.members m on m.id = r.member_id
  where r.code = upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
$$;

revoke all on function public.get_re_registration_status(text) from public, anon, authenticated;
grant execute on function public.get_re_registration_status(text) to anon, authenticated;
