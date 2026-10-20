-- pgTAP: RLS + RPC registrasi ulang.  Jalankan: npm run db:test
begin;
select plan(77);

-- ---------------------------------------------------------------- fixtures
-- admin: didaftarkan di account_provisioning, profile dibuat trigger saat user dibuat
insert into public.account_provisioning (email, role, display_name) values ('admin@test.local', 'admin_finance', 'Admin Finance Test');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'admin@test.local');

-- member biasa: anggota nyata + sign-up -> profile dibuat trigger
insert into public.members (member_number, source, full_name, email, line_id)
values ('FF-900', 'recruitment', 'Member Test', 'member@test.local', 'mt');
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b1', 'member@test.local');

-- daftar anggota lama (display name Line wajib & unik; nomor opsional)
insert into public.legacy_members (old_member_number, line_display_name) values
  ('TST-001', 'Test Satu'), ('TST-002', 'Test Dua'), ('TST-003', 'Test Tiga'),
  ('TST-004', 'Budi Santoso Line'), ('TST-005', 'Test Lima');
-- anggota "reset"/"ex admin": tidak punya nomor
insert into public.legacy_members (line_display_name, note) values ('Tes Tanpa Nomor', 'reset');
-- TST-001 punya kelebihan bayar kas 2 bulan (dari data lama)
update public.legacy_members set prepaid_months = 2 where old_member_number = 'TST-001';

-- bukti yang "sudah diunggah" (sebagai postgres, melewati policy storage)
insert into storage.objects (bucket_id, name) values
  ('payment-proofs', 're-registrations/11111111-1111-4111-8111-111111111111.png'),
  ('payment-proofs', 're-registrations/22222222-2222-4222-8222-222222222222.png'),
  ('payment-proofs', 're-registrations/33333333-3333-4333-8333-333333333333.jpg'),
  ('payment-proofs', 're-registrations/44444444-4444-4444-8444-444444444444.png'),
  ('payment-proofs', 're-registrations/55555555-5555-4555-8555-555555555555.png'),
  ('payment-proofs', 're-registrations/77777777-7777-4777-8777-777777777777.png');

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
select ok(has_function_privilege('anon', 'public.submit_re_registration(text, text, text, text, text, text, text, text, text, text)', 'execute'),
  'anon punya EXECUTE pada submit_re_registration (jalur publik)');
select ok(has_function_privilege('anon', 'public.check_old_member_number(text)', 'execute'),
  'anon punya EXECUTE pada check_old_member_number (dipakai form)');
select ok(not has_function_privilege('anon', 'public.admin_add_legacy_members(jsonb)', 'execute'),
  'anon tidak punya EXECUTE pada admin_add_legacy_members');
select throws_ok($$select * from public.legacy_members$$, '42501', null,
  'anon tidak bisa membaca legacy_members');

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
select throws_ok($$select public.submit_re_registration(repeat('a', 121), 'U', 'a@test.local', 'a', 'Jakarta', 'TST-001',
  're-registrations/11111111-1111-4111-8111-111111111111.png')$$, 'P0001', 'INVALID_NAME', 'nama lengkap lebih dari 120 karakter ditolak (kosong boleh)');
select throws_ok($$select public.submit_re_registration('Umar', 'U', 'bukan-email', 'a', 'Jakarta', 'TST-001',
  're-registrations/11111111-1111-4111-8111-111111111111.png')$$, 'P0001', 'INVALID_EMAIL', 'email salah ditolak');
select throws_ok($$select public.submit_re_registration('Umar', 'U', 'a@test.local', '', 'Jakarta', 'TST-001',
  're-registrations/11111111-1111-4111-8111-111111111111.png')$$, 'P0001', 'INVALID_LINE_ID', 'ID Line kosong ditolak');
select throws_ok($$select public.submit_re_registration('Umar', 'U', 'a@test.local', 'a', 'Jakarta', 'TST-001', '../../etc/passwd.png')$$,
  'P0001', 'INVALID_PROOF', 'path bukti tidak valid ditolak');
select throws_ok($$select public.submit_re_registration('Umar', 'U', 'a@test.local', 'a', 'Jakarta', 'TST-001',
  're-registrations/99999999-9999-4999-8999-999999999999.png')$$, 'P0001', 'PROOF_NOT_FOUND',
  'path valid tapi file belum diunggah ditolak');

-- submit: sukses (email dinormalisasi lower-case)
select lives_ok($$select set_config('test.code', public.submit_re_registration(
  'Umar Lama', 'Umar', 'Umar@Test.Local', 'umarlama', 'Bandung', ' tst-001 ',
  're-registrations/11111111-1111-4111-8111-111111111111.png',
  '@umar', '', '@umar_tt'), true)$$, 'submit valid berhasil');
select matches(current_setting('test.code'), '^RU-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$',
  'kode berformat acak RU-XXXX-XXXX');
select throws_ok($$select public.submit_re_registration('Umar Dua', 'U2', 'umar@test.local', 'u2', 'Jakarta', 'TST-002',
  're-registrations/22222222-2222-4222-8222-222222222222.png', '@u2')$$, 'P0001', 'ALREADY_SUBMITTED',
  'email yang sama tidak bisa mengajukan dua kali saat pending');

-- nomor anggota lama: status & validasi
select is(public.check_old_member_number(' tst-001'), 'in_use', 'nomor lama yang sedang diajukan -> in_use (spasi/huruf kecil ditoleransi)');
select is(public.check_old_member_number('TST-002'), 'ok', 'nomor lama belum dipakai -> ok');
select is(public.check_old_member_number('TST-404'), 'not_found', 'nomor lama tidak ada di daftar -> not_found');
select is((select r.old_member_number from public.resolve_old_member_number('  budi   SANTOSO line ') r), 'TST-004',
  'display name Line dikenali (huruf besar/kecil & spasi ganda diabaikan)');
select is(public.check_old_member_number('tes tanpa  NOMOR'), 'ok', 'anggota tanpa nomor ditemukan lewat display name Line');
select is(public.check_old_member_number('Nama Tidak Ada'), 'not_found', 'display name tidak dikenal -> not_found');
select lives_ok($$select public.submit_re_registration('', 'Nn', 'nonum@test.local', 'nn.line', 'Jakarta', 'Tes Tanpa Nomor',
  're-registrations/77777777-7777-4777-8777-777777777777.png', '@nn')$$,
  'nama lengkap opsional; anggota tanpa nomor bisa registrasi ulang lewat display name');
select lives_ok($$select public.submit_re_registration('Budi Santoso', 'Budi', 'dispname@test.local', 'budi.line', 'Jakarta', 'budi santoso line',
  're-registrations/66666666-6666-4666-8666-666666666666.png', '@budi')$$,
  'submit memakai display name Line (bukan nomor) berhasil');
select throws_ok($$select public.submit_re_registration('Budi', 'B', 'budi@test.local', 'b', 'Jakarta', 'TST-404',
  're-registrations/22222222-2222-4222-8222-222222222222.png')$$, 'P0001', 'OLD_NUMBER_NOT_FOUND',
  'nomor lama yang tidak ada di daftar ditolak');
select throws_ok($$select public.submit_re_registration('Budi', 'B', 'budi@test.local', 'b', 'Jakarta', 'TST-001',
  're-registrations/22222222-2222-4222-8222-222222222222.png')$$, 'P0001', 'OLD_NUMBER_IN_USE',
  'nomor lama yang sedang diajukan orang lain ditolak');
select throws_ok($$select public.submit_re_registration('Budi', 'B', 'budi@test.local', 'b', 'Jakarta', '  ',
  're-registrations/22222222-2222-4222-8222-222222222222.png')$$, 'P0001', 'INVALID_OLD_NUMBER',
  'nomor lama kosong ditolak');
select throws_ok($$select public.submit_re_registration('Budi', 'B', 'budi@test.local', 'b', 'Jakarta', 'TST-003',
  're-registrations/22222222-2222-4222-8222-222222222222.png', '', ' ', '')$$, 'P0001', 'SOCIAL_REQUIRED',
  'semua sosial media kosong ditolak (minimal salah satu)');
select throws_ok($$select public.submit_re_registration('Budi', '', 'budi@test.local', 'b', 'Jakarta', 'TST-003',
  're-registrations/22222222-2222-4222-8222-222222222222.png')$$, 'P0001', 'INVALID_NICKNAME', 'nickname kosong ditolak');
select throws_ok($$select public.submit_re_registration('Budi', 'B', 'budi@test.local', 'b', ' ', 'TST-003',
  're-registrations/22222222-2222-4222-8222-222222222222.png')$$, 'P0001', 'INVALID_DOMICILE', 'domisili kosong ditolak');

-- cek status publik: hanya data minimal
select is((select first_name from public.get_re_registration_status(lower(current_setting('test.code')))),
  'Umar', 'status publik: kode tidak case-sensitive & hanya nama depan');
select is((select count(*)::int from public.get_re_registration_status('RU-ZZZZ-ZZZZ')), 0,
  'status publik: kode tak dikenal -> kosong');

reset role;
select set_config('test.rid', (select id::text from public.re_registrations where email = 'umar@test.local'), true);
select set_config('test.ridn', (select id::text from public.re_registrations where email = 'nonum@test.local'), true);
select ok((select r.old_member_number is null and r.legacy_member_id is not null
           from public.re_registrations r where r.email = 'nonum@test.local'),
  'pengajuan anggota tanpa nomor tertaut ke daftar lama lewat legacy_member_id (nomor kosong)');
select is((select old_member_number from public.re_registrations where email = 'dispname@test.local'), 'TST-004',
  'pengajuan lewat display name menyimpan nomor anggota lama kanonik (TST-004)');
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
select throws_ok($$select public.admin_add_legacy_members('[{"number":"ZZ-1"}]'::jsonb)$$, '42501', 'FORBIDDEN',
  'member biasa tidak bisa menambah nomor anggota lama');
select is((select count(*)::int from public.legacy_members), 0, 'member biasa tidak melihat legacy_members (RLS)');
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

select matches(public.approve_re_registration(current_setting('test.ridn')::uuid), '^FF-\d{3}$',
  'approve registrasi tanpa nomor lama & tanpa nama lengkap berhasil');

-- admin: daftar nomor anggota lama
select cmp_ok((select count(*)::int from public.legacy_members), '>=', 5, 'admin melihat legacy_members (RLS)');
select is(public.admin_add_legacy_members('[{"line_name":"Orang Satu","number":"x-100","prepaid":1},
  {"line_name":" orang   dua ","name":"Nama Dua","prepaid":2},{"line_name":"Orang Tiga","number":"bad!"},
  {"line_name":"Orang Empat","prepaid":13},{"line_name":""}]'::jsonb),
  '{"added": 2, "updated": 0, "duplicate": 0, "invalid": 3}'::jsonb,
  'impor: display name wajib & dinormalisasi; nomor / kelebihan bayar tidak valid dan display name kosong dihitung invalid');
select is(public.admin_add_legacy_members('[{"line_name":"Orang Satu","note":"reset"},{"line_name":"orang dua","prepaid":2}]'::jsonb),
  '{"added": 0, "updated": 1, "duplicate": 1, "invalid": 0}'::jsonb,
  'impor ulang: field yang dicantumkan & berbeda diperbarui, selebihnya dilewati');
select is((select string_agg(line_display_name || '|' || member_name || '|' || coalesce(old_member_number, '-') || '|' || prepaid_months || '|' || note,
                             ';' order by lower(regexp_replace(btrim(line_display_name), '\s+', ' ', 'g')))
           from public.legacy_members where lower(regexp_replace(btrim(line_display_name), '\s+', ' ', 'g')) in ('orang satu', 'orang dua')),
  'orang   dua|Nama Dua|-|2|;Orang Satu||X-100|1|reset', 'data impor tersimpan (nomor opsional, nama, kelebihan bayar, catatan)');
select is(public.admin_add_legacy_members('[{"line_name":"Orang Baru","number":"x-100"}]'::jsonb),
  '{"added": 0, "updated": 0, "duplicate": 0, "invalid": 1}'::jsonb, 'nomor yang sudah dipakai anggota lain ditolak');

-- uang kas: pembayaran registrasi = kas bulan registrasi; kelebihan bayar 2 bulan = 2 bulan berikutnya
select is((select s.arrears_count from public.get_dues_summary((select id from public.members where email = 'umar@test.local')) s),
  0, 'tunggakan 0: pembayaran registrasi ulang dihitung sebagai kas bulan registrasi');
select is((select s.next_period from public.get_dues_summary((select id from public.members where email = 'umar@test.local')) s),
  to_char((now() at time zone 'Asia/Jakarta') + interval '3 months', 'YYYY-MM'),
  'bulan dibayar berikutnya = bulan registrasi + 1 + kelebihan bayar (2 bulan)');

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
select ok((select d.status = 'paid' and d.months = 1 and d.proof_path is not null
                  and d.period_from = to_char(now() at time zone 'Asia/Jakarta', 'YYYY-MM') and d.period_to = d.period_from
                  and d.amount = public.dues_monthly_amount()
                  and d.paid_on = (now() at time zone 'Asia/Jakarta')::date and d.paid_at is not null
           from public.dues_payments d join public.members m on m.id = d.member_id
           where m.email = 'umar@test.local' and d.source = 're_registration'),
  'approve mencatat pembayaran registrasi sebagai uang kas bulan registrasi (tanggal bayar & tanggal approve terpisah)');
select ok((select d.status = 'paid' and d.months = 2 and d.proof_path is null
                  and d.period_from = to_char((now() at time zone 'Asia/Jakarta') + interval '1 month', 'YYYY-MM')
                  and d.period_to = to_char((now() at time zone 'Asia/Jakarta') + interval '2 months', 'YYYY-MM')
                  and d.amount = 2 * public.dues_monthly_amount()
           from public.dues_payments d join public.members m on m.id = d.member_id
           where m.email = 'umar@test.local' and d.source = 'legacy_credit'),
  'kelebihan bayar 2 bulan melunasi 2 bulan setelah bulan registrasi (tanpa bukti)');
select is((select array_agg(pm.period order by pm.period) from public.dues_payment_months pm
            join public.members m on m.id = pm.member_id where m.email = 'umar@test.local' and pm.active),
  array[to_char(now() at time zone 'Asia/Jakarta', 'YYYY-MM'),
        to_char((now() at time zone 'Asia/Jakarta') + interval '1 month', 'YYYY-MM'),
        to_char((now() at time zone 'Asia/Jakarta') + interval '2 months', 'YYYY-MM')],
  'tiga bulan tercatat dibayar: bulan registrasi + 2 bulan kelebihan bayar');
select ok((select l.is_registered and l.registered_at is not null
                  and l.member_id = (select m.id from public.members m where m.email = 'umar@test.local')
           from public.legacy_members l where l.old_member_number = 'TST-001'),
  'approve menandai nomor lama is_registered = true dan menautkannya ke anggota');
select is((select m.nickname || '|' || m.domicile || '|' || m.social_x || '|' || m.social_tiktok || '|' || m.old_member_number
           from public.members m where m.email = 'umar@test.local'),
  'Umar|Bandung|@umar|@umar_tt|TST-001',
  'approve menyalin nickname, domisili, sosmed, & nomor lama ke members');
select ok((select m.full_name = 'Nn' and m.old_member_number is null
                  and (select l.is_registered and l.member_id = m.id from public.legacy_members l where l.line_display_name = 'Tes Tanpa Nomor')
           from public.members m where m.email = 'nonum@test.local'),
  'nama lengkap kosong -> nickname dipakai; anggota tanpa nomor tertaut ke daftar lama (is_registered)');

-- email yang sudah jadi anggota tidak bisa mengajukan lagi
set local role anon;
select is(public.check_old_member_number('TST-001'), 'registered', 'nomor lama yang sudah approve -> registered');
select throws_ok($$select public.submit_re_registration('Orang Lain', 'O', 'lain@test.local', 'lain', 'Jakarta', 'TST-001',
  're-registrations/22222222-2222-4222-8222-222222222222.png')$$, 'P0001', 'OLD_NUMBER_ALREADY_REGISTERED',
  'nomor lama yang sudah registrasi ulang tidak bisa dipakai lagi');
select throws_ok($$select public.submit_re_registration('Umar Lagi', 'U', 'umar@test.local', 'u', 'Jakarta', 'TST-002',
  're-registrations/22222222-2222-4222-8222-222222222222.png')$$, 'P0001', 'EMAIL_ALREADY_MEMBER',
  'email anggota yang sudah ada tidak bisa registrasi ulang');

-- reject lalu ajukan ulang dengan email yang sama
select lives_ok($$select set_config('test.code2', public.submit_re_registration(
  'Sari Baru', 'Sari', 'sari@test.local', 'sari', 'Depok', 'TST-002',
  're-registrations/33333333-3333-4333-8333-333333333333.jpg', '@sari'), true)$$, 'pengajuan kedua (jpg) berhasil');
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
select lives_ok($$select public.submit_re_registration('Sari Baru', 'Sari', 'sari@test.local', 'sari', 'Depok', 'TST-002',
  're-registrations/44444444-4444-4444-8444-444444444444.png', '', '@sari')$$,
  'setelah rejected, email & nomor lama yang sama boleh mengajukan ulang (nomor tidak terkunci)');

-- race: email jadi anggota (jalur lain) sebelum approve
select lives_ok($$select set_config('test.code3', public.submit_re_registration(
  'Dup Orang', 'Dup', 'dup@test.local', 'dup', 'Bekasi', 'TST-003',
  're-registrations/55555555-5555-4555-8555-555555555555.png', '', '', '@dup'), true)$$, 'pengajuan ketiga berhasil');
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
