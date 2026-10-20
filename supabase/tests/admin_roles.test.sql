-- pgTAP: pembagian role admin vs admin_finance vs superadmin.  Jalankan: npm run db:test
begin;
select plan(20);

insert into public.account_provisioning (email, role, display_name) values
  ('plain@test.local', 'admin', 'Admin Biasa'),
  ('fin@test.local', 'admin_finance', 'Admin Finance'),
  ('super@test.local', 'superadmin', 'Super');
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000aa', 'plain@test.local'),
  ('00000000-0000-0000-0000-0000000000ab', 'fin@test.local'),
  ('00000000-0000-0000-0000-0000000000ac', 'super@test.local');

select is((select role::text from public.profiles where id = '00000000-0000-0000-0000-0000000000ab'),
  'admin_finance', 'akun staf bisa dibuat dengan role admin_finance');

-- registrasi ulang pending (diisi langsung sebagai postgres)
insert into public.legacy_members (old_member_number, line_display_name) values ('RLS-001', 'Rls Satu');
insert into public.re_registrations (code, full_name, nickname, email, line_id, domicile, old_member_number, proof_path)
values ('RU-ROLE-0001', 'Role Test', 'R', 'role@test.local', 'r', 'Jakarta', 'RLS-001', 'p-role');
select set_config('test.rid', (select id::text from public.re_registrations where code = 'RU-ROLE-0001'), true);

-- ============================================================ admin biasa
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);

select ok(public.is_admin() and not public.is_finance_admin(), 'admin biasa: is_admin true, is_finance_admin false');
select is((select count(*)::int from public.re_registrations where code = 'RU-ROLE-0001'), 1,
  'admin biasa bisa MELIHAT registrasi ulang');
select throws_ok($$select public.approve_re_registration(current_setting('test.rid')::uuid)$$,
  '42501', 'FORBIDDEN', 'admin biasa tidak bisa approve registrasi ulang');
select throws_ok($$select public.reject_re_registration(current_setting('test.rid')::uuid, '')$$,
  '42501', 'FORBIDDEN', 'admin biasa tidak bisa reject registrasi ulang');
select throws_ok($$select public.approve_dues_payment(gen_random_uuid())$$,
  '42501', 'FORBIDDEN', 'admin biasa tidak bisa approve uang kas');
select throws_ok($$select public.reject_dues_payment(gen_random_uuid(), 'x')$$,
  '42501', 'FORBIDDEN', 'admin biasa tidak bisa reject uang kas');
select lives_ok($$select public.admin_add_legacy_members('[{"line_name":"Rls Dua","number":"RLS-002","prepaid":1}]'::jsonb)$$,
  'admin biasa tetap bisa mengelola data lain (nomor anggota lama)');

-- ============================================================ superadmin
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000ac","role":"authenticated"}', true);
select ok(public.is_admin() and public.is_finance_admin(), 'superadmin: is_admin & is_finance_admin true');
select throws_ok($$select public.approve_dues_payment(gen_random_uuid())$$,
  'P0001', 'NOT_FOUND', 'superadmin lolos gerbang approve uang kas (id tak dikenal -> NOT_FOUND)');

-- ======================================================== admin_finance
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000ab","role":"authenticated"}', true);
select ok(public.is_admin() and public.is_finance_admin(), 'admin_finance: is_admin & is_finance_admin true');
select throws_ok($$select public.approve_dues_payment(gen_random_uuid())$$,
  'P0001', 'NOT_FOUND', 'admin_finance lolos gerbang approve uang kas (id tak dikenal -> NOT_FOUND)');
select throws_ok($$select public.reject_dues_payment(gen_random_uuid(), 'x')$$,
  'P0001', 'NOT_FOUND', 'admin_finance lolos gerbang reject uang kas');
select matches(public.approve_re_registration(current_setting('test.rid')::uuid), '^FF-\d{3}$',
  'admin_finance bisa approve registrasi ulang');

-- ================================================= daftar akun staf (hanya superadmin)
select throws_ok($$select * from public.superadmin_list_staff()$$, '42501', 'FORBIDDEN',
  'admin_finance tidak bisa melihat daftar staf');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000ac","role":"authenticated"}', true);
select cmp_ok((select count(*)::int from public.superadmin_list_staff()), '>=', 3, 'superadmin melihat daftar staf');
select ok((select bool_and(email is not null) from public.superadmin_list_staff()), 'daftar staf memuat email');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);
select throws_ok($$select * from public.superadmin_list_staff()$$, '42501', 'FORBIDDEN', 'admin biasa tidak bisa melihat daftar staf');

-- ================================================= superadmin mengubah role akun
reset role;
insert into public.members (member_number, source, full_name, email, line_id)
values ('FF-950', 'recruitment', 'Staf Uji', 'staf@test.local', 'x');
update public.profiles set member_id = (select id from public.members where member_number = 'FF-950')
 where id = '00000000-0000-0000-0000-0000000000aa';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000ac","role":"authenticated"}', true);
select lives_ok($$select public.superadmin_set_account_role(
  (select id from public.members where member_number = 'FF-950'), 'admin_finance')$$,
  'superadmin bisa mengubah role akun menjadi admin_finance');
select is((select role::text from public.profiles where id = '00000000-0000-0000-0000-0000000000aa'),
  'admin_finance', 'role tersimpan');

select * from finish();
rollback;
