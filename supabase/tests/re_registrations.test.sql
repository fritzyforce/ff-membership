-- pgTAP: RLS + RPC registrasi ulang.  Jalankan: npm run db:test
begin;
select plan(40);

-- ---------------------------------------------------------------- fixtures
-- admin: didaftarkan di account_provisioning, profile dibuat trigger saat user dibuat
insert into public.account_provisioning (email, role, display_name) values ('admin@test.local', 'admin', 'Admin Test');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'admin@test.local');

-- member biasa: anggota nyata + sign-up -> profile dibuat trigger
insert into public.members (member_number, source, full_name, email, line_id)
values ('FF-900', 'recruitment', 'Member Test', 'member@test.local', 'mt');
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b1', 'member@test.local');

-- bukti yang "sudah diunggah" (sebagai postgres, melewati policy storage)
insert into storage.objects (bucket_id, name) values
  ('payment-proofs', 're-registrations/11111111-1111-4111-8111-111111111111.png'),
  ('payment-proofs', 're-registrations/22222222-2222-4222-8222-222222222222.png'),
  ('payment-proofs', 're-registrations/33333333-3333-4333-8333-333333333333.jpg'),
  ('payment-proofs', 're-registrations/44444444-4444-4444-8444-444444444444.png'),
  ('payment-proofs', 're-registrations/55555555-5555-4555-8555-555555555555.png');

-- =============================================================== ANON
set local role anon;

select throws_ok($$select * from public.re_registrations$$, '42501', null,
  'anon tidak bisa membaca re_registrations');
select throws_ok($$select * from public.members$$, '42501', null,
  'anon tidak bisa membaca members');
select throws_ok($$insert into public.re_registrations (code, full_name, email, line_id, proof_path)
  values ('RU-AAAA-BBBB', 'X', 'x@test.local', 'x', 'p')$$, '42501', null,
  'anon tidak bisa insert langsung ke re_registrations');
select throws_ok($$select public.approve_re_registration(gen_random_uuid())$$, '42501', null,
  'anon tidak bisa approve');
select ok(not has_function_privilege('anon', 'public.approve_re_registration(uuid)', 'execute'),
  'anon tidak punya EXECUTE pada approve_re_registration');
select ok(not has_function_privilege('anon', 'public.reject_re_registration(uuid, text)', 'execute'),
  'anon tidak punya EXECUTE pada reject_re_registration');
select ok(not has_function_privilege('anon', 'public.generate_re_registration_code()', 'execute'),
  'anon tidak punya EXECUTE pada fungsi internal generate_re_registration_code');
select ok(has_function_privilege('anon', 'public.submit_re_registration(text, text, text, text)', 'execute'),
  'anon punya EXECUTE pada submit_re_registration (jalur publik)');

-- storage: hanya boleh menambah file di path yang diizinkan
select throws_ok($$insert into storage.objects (bucket_id, name)
  values ('payment-proofs', 'evil/payload.png')$$, '42501', null,
  'anon tidak bisa upload di luar path re-registrations/<uuid>.<ext>');
select lives_ok($$insert into storage.objects (bucket_id, name)
  values ('payment-proofs', 're-registrations/66666666-6666-4666-8666-666666666666.png')$$,
  'anon boleh upload bukti di path yang benar');
select is((select count(*)::int from storage.objects where bucket_id = 'payment-proofs'), 0,
  'anon tidak bisa melihat isi bucket payment-proofs');

-- submit: validasi
select throws_ok($$select public.submit_re_registration('', 'a@test.local', 'a',
  're-registrations/11111111-1111-4111-8111-111111111111.png')$$, 'P0001', 'INVALID_NAME', 'nama kosong ditolak');
select throws_ok($$select public.submit_re_registration('Umar', 'bukan-email', 'a',
  're-registrations/11111111-1111-4111-8111-111111111111.png')$$, 'P0001', 'INVALID_EMAIL', 'email salah ditolak');
select throws_ok($$select public.submit_re_registration('Umar', 'a@test.local', '',
  're-registrations/11111111-1111-4111-8111-111111111111.png')$$, 'P0001', 'INVALID_LINE_ID', 'ID Line kosong ditolak');
select throws_ok($$select public.submit_re_registration('Umar', 'a@test.local', 'a', '../../etc/passwd.png')$$,
  'P0001', 'INVALID_PROOF', 'path bukti tidak valid ditolak');
select throws_ok($$select public.submit_re_registration('Umar', 'a@test.local', 'a',
  're-registrations/99999999-9999-4999-8999-999999999999.png')$$, 'P0001', 'PROOF_NOT_FOUND',
  'path valid tapi file belum diunggah ditolak');

-- submit: sukses (email dinormalisasi lower-case)
select lives_ok($$select set_config('test.code', public.submit_re_registration(
  'Umar Lama', 'Umar@Test.Local', 'umarlama',
  're-registrations/11111111-1111-4111-8111-111111111111.png'), true)$$, 'submit valid berhasil');
select matches(current_setting('test.code'), '^RU-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$',
  'kode berformat acak RU-XXXX-XXXX');
select throws_ok($$select public.submit_re_registration('Umar Dua', 'umar@test.local', 'u2',
  're-registrations/22222222-2222-4222-8222-222222222222.png')$$, 'P0001', 'ALREADY_SUBMITTED',
  'email yang sama tidak bisa mengajukan dua kali saat pending');

-- cek status publik: hanya data minimal
select is((select first_name from public.get_re_registration_status(lower(current_setting('test.code')))),
  'Umar', 'status publik: kode tidak case-sensitive & hanya nama depan');
select is((select count(*)::int from public.get_re_registration_status('RU-ZZZZ-ZZZZ')), 0,
  'status publik: kode tak dikenal -> kosong');

reset role;
select set_config('test.rid', (select id::text from public.re_registrations where email = 'umar@test.local'), true);
select is((select status::text from public.re_registrations where email = 'umar@test.local'), 'pending',
  'pengajuan baru berstatus pending');

-- ================================================ MEMBER BIASA (bukan admin)
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);

select is((select count(*)::int from public.re_registrations), 0,
  'member biasa tidak melihat re_registrations (RLS)');
select throws_ok($$select public.approve_re_registration(current_setting('test.rid')::uuid)$$,
  '42501', 'FORBIDDEN', 'member biasa tidak bisa approve');
select throws_ok($$select public.reject_re_registration(current_setting('test.rid')::uuid, 'x')$$,
  '42501', 'FORBIDDEN', 'member biasa tidak bisa reject');

-- ======================================================================= ADMIN
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

select is((select count(*)::int from public.re_registrations where email = 'umar@test.local'), 1,
  'admin melihat re_registrations (RLS)');
-- nilai persisnya dicek di member_auth.test.sql (data dev ikut memengaruhi counter)
select matches(public.approve_re_registration(current_setting('test.rid')::uuid), '^FF-\d{3}$',
  'approve membuat nomor anggota berformat FF-NNN');
select is((select email from public.get_re_registration_status(current_setting('test.code'))), 'umar@test.local',
  'status publik: email dibuka setelah approved (untuk prefill Registrasi Akun)');
select throws_ok($$select public.approve_re_registration(current_setting('test.rid')::uuid)$$,
  'P0001', 'ALREADY_REVIEWED', 'approve dua kali ditolak');
select throws_ok($$select public.reject_re_registration(current_setting('test.rid')::uuid, 'telat')$$,
  'P0001', 'ALREADY_REVIEWED', 'reject setelah approve ditolak');

reset role;
select is((select m.dues_start_period from public.members m join public.re_registrations r on r.member_id = m.id
           where r.email = 'umar@test.local'),
  (select to_char(r.created_at at time zone 'Asia/Jakarta', 'YYYY-MM') from public.re_registrations r where r.email = 'umar@test.local'),
  'bulan awal iuran = bulan registrasi ulang (WIB), bukan bulan approve');
select ok((select r.status = 'approved' and r.member_id is not null
                  and r.reviewed_by = '00000000-0000-0000-0000-0000000000a1' and r.reviewed_at is not null
           from public.re_registrations r where r.email = 'umar@test.local')
          and (select count(*) from public.members m where m.email = 'umar@test.local' and m.source = 're_registration') = 1,
  'approve: status, reviewer, & anggota tercatat konsisten');

-- email yang sudah jadi anggota tidak bisa mengajukan lagi
set local role anon;
select throws_ok($$select public.submit_re_registration('Umar Lagi', 'umar@test.local', 'u',
  're-registrations/22222222-2222-4222-8222-222222222222.png')$$, 'P0001', 'EMAIL_ALREADY_MEMBER',
  'email anggota yang sudah ada tidak bisa registrasi ulang');

-- reject lalu ajukan ulang dengan email yang sama
select lives_ok($$select set_config('test.code2', public.submit_re_registration(
  'Sari Baru', 'sari@test.local', 'sari',
  're-registrations/33333333-3333-4333-8333-333333333333.jpg'), true)$$, 'pengajuan kedua (jpg) berhasil');
reset role;
select set_config('test.rid2', (select id::text from public.re_registrations where email = 'sari@test.local'), true);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select lives_ok($$select public.reject_re_registration(current_setting('test.rid2')::uuid, '')$$,
  'admin bisa reject tanpa catatan (opsional)');
set local role anon;
select is((select email from public.get_re_registration_status(current_setting('test.code2'))),
  null, 'status publik: email tidak dibuka untuk yang rejected');
select is((select count(*)::int from information_schema.columns
            where table_schema = 'public' and table_name = 'get_re_registration_status' and column_name = 'review_note'), 0,
  'status publik tidak lagi memuat catatan review');
select lives_ok($$select public.submit_re_registration('Sari Baru', 'sari@test.local', 'sari',
  're-registrations/44444444-4444-4444-8444-444444444444.png')$$,
  'setelah rejected, email yang sama boleh mengajukan ulang');

-- race: email jadi anggota (jalur lain) sebelum approve
select lives_ok($$select set_config('test.code3', public.submit_re_registration(
  'Dup Orang', 'dup@test.local', 'dup',
  're-registrations/55555555-5555-4555-8555-555555555555.png'), true)$$, 'pengajuan ketiga berhasil');
reset role;
select set_config('test.rid3', (select id::text from public.re_registrations where email = 'dup@test.local'), true);
insert into public.members (member_number, source, full_name, email, line_id)
values ('FF-901', 'recruitment', 'Dup Lama', 'dup@test.local', 'dup');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select throws_ok($$select public.approve_re_registration(current_setting('test.rid3')::uuid)$$,
  'P0001', 'EMAIL_ALREADY_MEMBER', 'approve gagal bersih bila email sudah jadi anggota');

select * from finish();
rollback;
