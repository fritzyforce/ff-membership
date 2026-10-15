-- Superadmin boleh melakukan semuanya, termasuk approve/reject uang kas & registrasi ulang.
-- (Sebelumnya hanya admin_finance.) Role admin biasa tetap tidak bisa.
create or replace function public.is_finance_admin() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active and p.role::text in ('admin_finance', 'superadmin')
  );
$$;
