-- pgTAP: sign-up member, RLS anggota, edit profil, penomoran FRC-NNN gapless.
begin;
select plan(36);

-- Isolasi: kosongkan data dev DI DALAM transaksi ini (di-rollback di akhir).
delete from public.dues_payments;
delete from public.re_registrations;
delete from public.profiles where role = 'member';
delete from public.members;
update public.member_counter set last_value = 0;

insert into public.account_provisioning (email, role, display_name) values ('adm2@test.local', 'admin_finance', 'Admin Finance Dua');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c0', 'adm2@test.local');

-- ============================================================ trigger sign-up
select throws_ok($$insert into auth.users (id, email)
  values ('00000000-0000-0000-0000-0000000000d1', 'orang.asing@test.local')$$,
  'P0001', 'MEMBER_NOT_ELIGIBLE', 'sign-up email non-anggota dibatalkan');
select throws_ok($$insert into auth.users (id, email, raw_user_meta_data)
  values ('00000000-0000-0000-0000-0000000000d2', 'orang.asing@test.local', '{"role":"admin"}')$$,
  'P0001', 'MEMBER_NOT_ELIGIBLE', 'user_metadata role=admin (bisa diisi publik) tidak membuka celah');

insert into public.members (member_number, source, full_name, email, line_id) values
  ('FF-801', 'recruitment', 'Budi Anggota',  'Budi@Test.Local', 'budi'),
  ('FF-802', 'recruitment', 'Cici Anggota',  'cici@test.local', 'cici'),
  ('FF-803', 'recruitment', 'Dodi Nonaktif', 'dodi@test.local', 'dodi');
update public.members set status = 'revoked' where email = 'dodi@test.local';

select lives_ok($$insert into auth.users (id, email)
  values ('00000000-0000-0000-0000-0000000000d3', 'budi@test.local')$$,
  'sign-up email anggota aktif berhasil (case-insensitive)');
select ok(exists (
  select 1 from public.profiles p join public.members m on m.id = p.member_id
  where p.id = '00000000-0000-0000-0000-0000000000d3' and p.role = 'member'
    and p.display_name = 'Budi Anggota' and m.member_number = 'FF-801'),
  'profile member dibuat otomatis & tertaut ke anggota');
select throws_ok($$insert into auth.users (id, email)
  values ('00000000-0000-0000-0000-0000000000d4', 'BUDI@test.local')$$,
  'P0001', 'MEMBER_ALREADY_HAS_ACCOUNT', 'satu anggota tidak bisa punya dua akun');
select throws_ok($$insert into auth.users (id, email)
  values ('00000000-0000-0000-0000-0000000000d5', 'dodi@test.local')$$,
  'P0001', 'MEMBER_NOT_ELIGIBLE', 'anggota non-aktif tidak bisa membuat akun');
insert into public.account_provisioning (email, role, display_name)
values ('staff@test.local', 'superadmin', 'Staf Test');
select lives_ok($$insert into auth.users (id, email)
  values ('00000000-0000-0000-0000-0000000000d6', 'Staff@Test.Local')$$,
  'email yang didaftarkan di account_provisioning boleh dibuat (staf)');
select is((select role::text || '|' || display_name from public.profiles
           where id = '00000000-0000-0000-0000-0000000000d6'), 'superadmin|Staf Test',
  'profile staf dibuat trigger dengan role dari provisioning');
select is((select count(*)::int from public.account_provisioning where email = 'staff@test.local'), 0,
  'provisioning sekali pakai: baris dihapus setelah dipakai');
select throws_ok($$insert into auth.users (id, email)
  values ('00000000-0000-0000-0000-0000000000d7', 'staff@test.local')$$,
  'P0001', 'MEMBER_NOT_ELIGIBLE', 'email staf yang sama tidak bisa dipakai ulang tanpa provisioning baru');

-- ================================================================ RLS anggota
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000d3","role":"authenticated"}', true);

select is((select member_number from public.members), 'FF-801', 'anggota hanya melihat barisnya sendiri');
select is((select count(*)::int from public.members), 1, 'anggota tidak melihat anggota lain');
select is((select count(*)::int from public.profiles), 1, 'anggota hanya melihat profile sendiri');
select throws_ok($$update public.members set full_name = 'Hacked'$$, '42501', null,
  'anggota tidak bisa UPDATE tabel members langsung');
select throws_ok($$select * from public.member_counter$$, '42501', null, 'counter nomor tertutup untuk anggota');
select throws_ok($$insert into public.account_provisioning (email, role) values ('jahat@test.local', 'superadmin')$$,
  '42501', null, 'anggota tidak bisa menambah account_provisioning');

-- ========================================================== edit profil sendiri
select lives_ok($$select public.update_my_member_profile(
  'Budi', 'Bandung', date '2000-01-02', 'Jl. Baru 1', 'budi.line', '@budi', '', '')$$, 'anggota bisa edit profil sendiri');
select throws_ok($$select public.update_my_member_profile(
  '', 'Bandung', null, '', 'budi.line', '@budi', '', '')$$, 'P0001', 'INVALID_NICKNAME', 'nickname kosong ditolak');
select throws_ok($$select public.update_my_member_profile(
  'Budi', '  ', null, '', 'budi.line', '@budi', '', '')$$, 'P0001', 'INVALID_DOMICILE',
  'domisili wajib');

reset role;
select is((select nickname || '|' || domicile || '|' || line_id || '|' || social_x || '|' || birth_date::text
           from public.members where member_number = 'FF-801'),
  'Budi|Bandung|budi.line|@budi|2000-01-02', 'data tersimpan');
select is((select address from public.members where member_number = 'FF-802'), '',
  'anggota lain tidak ikut berubah');

-- anggota yang di-revoke tidak bisa mengubah profil lagi
update public.members set status = 'revoked' where member_number = 'FF-801';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000d3","role":"authenticated"}', true);
select throws_ok($$select public.update_my_member_profile(
  'Budi', 'Bandung', null, 'Jl. Baru 2', 'budi.line', '@budi', '', '')$$, '42501', 'FORBIDDEN',
  'anggota revoked tidak bisa edit profil');
reset role;
update public.members set status = 'active' where member_number = 'FF-801';

-- admin: bukan anggota -> tidak punya profil anggota; anon -> tanpa akses
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000c0","role":"authenticated"}', true);
select throws_ok($$select public.update_my_member_profile(
  'x', 'x', null, 'x', 'x', '@x', '', '')$$, '42501', 'FORBIDDEN', 'admin tanpa profil anggota ditolak');
select cmp_ok((select count(*)::int from public.members), '>=', 3, 'admin melihat semua anggota');
set local role anon;
select throws_ok($$select public.update_my_member_profile(
  'x', 'x', null, 'x', 'x', '@x', '', '')$$, '42501', null, 'anon tidak bisa edit profil');
select ok(not has_function_privilege('anon', 'public.next_member_number()', 'execute')
      and not has_function_privilege('authenticated', 'public.next_member_number()', 'execute'),
  'next_member_number() tidak bisa dipanggil langsung dari browser');
reset role;

-- ====================================================== penomoran FRC-001..FRC-999
insert into public.re_registrations (code, full_name, email, line_id, proof_path) values
  ('RU-TEST-0001', 'Gap Satu',  'gap1@test.local', 'g1', 'p1'),
  ('RU-TEST-0002', 'Gap Dua',   'gap2@test.local', 'g2', 'p2'),
  ('RU-TEST-0003', 'Gap Tiga',  'budi@test.local', 'g3', 'p3'),   -- email sudah jadi anggota
  ('RU-TEST-0004', 'Gap Empat', 'gap4@test.local', 'g4', 'p4'),
  ('RU-TEST-0005', 'Gap Lima',  'gap5@test.local', 'g5', 'p5');
select set_config('test.g1', (select id::text from public.re_registrations where code = 'RU-TEST-0001'), true);
select set_config('test.g2', (select id::text from public.re_registrations where code = 'RU-TEST-0002'), true);
select set_config('test.g3', (select id::text from public.re_registrations where code = 'RU-TEST-0003'), true);
select set_config('test.g4', (select id::text from public.re_registrations where code = 'RU-TEST-0004'), true);
select set_config('test.g5', (select id::text from public.re_registrations where code = 'RU-TEST-0005'), true);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000c0","role":"authenticated"}', true);

select is(public.approve_re_registration(current_setting('test.g1')::uuid), 'FRC-001',
  'nomor anggota pertama = FRC-001');
select throws_ok($$select public.approve_re_registration(current_setting('test.g3')::uuid)$$,
  'P0001', 'EMAIL_ALREADY_MEMBER', 'approve yang gagal ditolak bersih');
select is(public.approve_re_registration(current_setting('test.g2')::uuid), 'FRC-002',
  'approve gagal TIDAK meninggalkan celah: berikutnya FRC-002 (bukan FRC-003)');

reset role;
select is((select last_value from public.member_counter), 2, 'counter tepat 2 setelah dua approve sukses');
update public.member_counter set last_value = 998;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000c0","role":"authenticated"}', true);
select is(public.approve_re_registration(current_setting('test.g4')::uuid), 'FRC-999', 'nomor terakhir = FRC-999');
select throws_ok($$select public.approve_re_registration(current_setting('test.g5')::uuid)$$,
  'P0001', 'MEMBER_NUMBER_EXHAUSTED', 'nomor ke-1000 ditolak (kuota 999 habis)');

reset role;
select is((select status::text from public.re_registrations where code = 'RU-TEST-0005'), 'pending',
  'pengajuan yang gagal karena kuota tetap pending');
select is((select last_value from public.member_counter), 999, 'counter tidak melewati 999');
select throws_ok($$insert into public.members (member_number, source, full_name, email, line_id)
  values ('FF-1000', 'recruitment', 'X', 'x@test.local', 'x')$$, '23514', null,
  'constraint format menolak nomor di luar 001..999');
select throws_ok($$insert into public.members (member_number, source, full_name, email, line_id)
  values ('FF-2026-0001', 'recruitment', 'X', 'x2@test.local', 'x')$$, '23514', null,
  'constraint format menolak format lama FF-YYYY-NNNN');

select * from finish();
rollback;
