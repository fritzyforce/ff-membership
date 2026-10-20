-- Nomor anggota BARU memakai awalan FRC (FRC-001 .. FRC-999), menggantikan FF.
-- Nomor lama berawalan FF (anggota yang sudah ada) tetap valid; hanya nomor yang dibuat mulai sekarang yang FRC.
-- Counter tidak diulang: nomor berikutnya melanjutkan urutan yang sudah berjalan (tanpa celah).

alter table public.members drop constraint members_member_number_format;
alter table public.members
  add constraint members_member_number_format check (member_number ~ '^(FF|FRC)-\d{3}$');

create or replace function public.next_member_number() returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v integer;
begin
  -- FOR UPDATE mengunci baris counter sampai transaksi selesai -> berurutan & gapless
  select c.last_value into v from public.member_counter c where c.id for update;
  if v is null or v >= 999 then
    raise exception 'MEMBER_NUMBER_EXHAUSTED' using errcode = 'P0001';
  end if;
  update public.member_counter set last_value = v + 1 where id;
  return 'FRC-' || lpad((v + 1)::text, 3, '0');
end;
$$;
