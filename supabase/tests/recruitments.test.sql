-- pgTAP: rekrutmen anggota baru (Join Us).  Jalankan: npm run db:test
begin;
select plan(44);

-- fixtures: admin biasa, admin finance; bukti yang "sudah diunggah"
insert into public.account_provisioning (email, role, display_name) values
  ('rc-plain@test.local', 'admin', 'Admin Biasa'),
  ('rc-fin@test.local', 'admin_finance', 'Admin Finance');
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'rc-plain@test.local'),
  ('00000000-0000-0000-0000-0000000000d2', 'rc-fin@test.local');
insert into storage.objects (bucket_id, name) values
  ('payment-proofs', 'recruitment/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png'),
  ('payment-proofs', 'recruitment/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png');
insert into public.members (member_number, source, full_name, email, line_id)
values ('FF-960', 'recruitment', 'Sudah Anggota', 'sudah@test.local', 'sa');

-- =============================================================== ANON
set local role anon;

select throws_ok($$select * from public.recruitments$$, '42501', null, 'anon tidak bisa membaca recruitments');
select throws_ok($$select public.pre_approve_recruitment(gen_random_uuid())$$, '42501', null, 'anon tidak bisa pre-approve');
select ok(not has_function_privilege('anon', 'public.approve_recruitment(uuid)', 'execute'), 'anon tidak punya EXECUTE pada approve_recruitment');
select ok(has_function_privilege('anon', 'public.submit_recruitment(text, text, text, text, text, text, text, text, text)', 'execute'),
  'anon boleh mengirim pendaftaran');

-- validasi
select throws_ok($$select public.submit_recruitment('', '', 'a@test.local', 'a', 'Jakarta', 'ingin join', '@a')$$,
  'P0001', 'INVALID_NICKNAME', 'nickname kosong ditolak');
select throws_ok($$select public.submit_recruitment('', 'A', 'bukan-email', 'a', 'Jakarta', 'ingin join', '@a')$$,
  'P0001', 'INVALID_EMAIL', 'email salah ditolak');
select throws_ok($$select public.submit_recruitment('', 'A', 'a@test.local', 'a', 'Jakarta', '   ', '@a')$$,
  'P0001', 'INVALID_REASON', 'alasan join wajib');
select throws_ok($$select public.submit_recruitment('', 'A', 'a@test.local', 'a', 'Jakarta', 'ingin join')$$,
  'P0001', 'SOCIAL_REQUIRED', 'minimal satu sosial media wajib');
select throws_ok($$select public.submit_recruitment('', 'A', 'sudah@test.local', 'a', 'Jakarta', 'ingin join', '@a')$$,
  'P0001', 'EMAIL_ALREADY_MEMBER', 'email anggota ditolak');

-- sukses (nama lengkap opsional, email dinormalisasi)
select lives_ok($$select set_config('test.code', public.submit_recruitment(
  '', 'Calon', 'Calon@Test.Local', 'calon.line', 'Bandung', 'Suka komunitasnya', '', '@calon'), true)$$,
  'pendaftaran valid berhasil (nama lengkap kosong)');
select matches(current_setting('test.code'), '^REG-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$', 'kode REG-XXXX-XXXX acak');
select throws_ok($$select public.submit_recruitment('', 'Calon2', 'calon@test.local', 'c2', 'Bandung', 'alasan', '@c2')$$,
  'P0001', 'ALREADY_SUBMITTED', 'email yang sama tidak bisa mendaftar dua kali');

-- status publik
select is((select first_name from public.get_recruitment_status(lower(current_setting('test.code')))), 'Calon',
  'status publik: kode tak peka huruf besar/kecil; nama depan jatuh ke nickname');
select is((select status::text from public.get_recruitment_status(current_setting('test.code'))), 'pending', 'status awal pending');
select is((select amount from public.get_recruitment_status(current_setting('test.code'))), 20000, 'status memuat iuran 1 bulan');
-- pembayaran sebelum pre-approved ditolak
select throws_ok($$select public.submit_recruitment_payment(current_setting('test.code'),
  'recruitment/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png')$$, 'P0001', 'NOT_PAYABLE', 'bayar sebelum pre-approved ditolak');
select throws_ok($$select public.submit_recruitment_payment(current_setting('test.code'), '../x.png')$$,
  'P0001', 'INVALID_PROOF', 'path bukti tidak valid ditolak');

reset role;
select set_config('test.rid', (select id::text from public.recruitments where email = 'calon@test.local'), true);

-- email yang sedang registrasi ulang aktif ditolak
insert into public.re_registrations (code, full_name, nickname, email, line_id, domicile, proof_path)
values ('RU-RCRC-0001', 'Ru', 'Ru', 'ru@test.local', 'ru', 'Jakarta', 'p-ru');
set local role anon;
select throws_ok($$select public.submit_recruitment('', 'Ru', 'ru@test.local', 'ru', 'Jakarta', 'alasan', '@ru')$$,
  'P0001', 'EMAIL_IN_RE_REGISTRATION', 'email yang sedang registrasi ulang ditolak');
reset role;

-- =========================================================== admin biasa
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
select is((select count(*)::int from public.recruitments where email = 'calon@test.local'), 1, 'admin biasa bisa MELIHAT pendaftaran');
select throws_ok($$select public.pre_approve_recruitment(current_setting('test.rid')::uuid)$$, '42501', 'FORBIDDEN',
  'admin biasa tidak bisa pre-approve');
select throws_ok($$select public.reject_recruitment(current_setting('test.rid')::uuid, 'x')$$, '42501', 'FORBIDDEN',
  'admin biasa tidak bisa menolak');

-- ======================================================== admin finance
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}', true);
select throws_ok($$select public.approve_recruitment(current_setting('test.rid')::uuid)$$, 'P0001', 'NOT_PAID',
  'approve sebelum ada pembayaran ditolak');
select lives_ok($$select public.pre_approve_recruitment(current_setting('test.rid')::uuid)$$, 'admin finance bisa pre-approve');
select throws_ok($$select public.pre_approve_recruitment(current_setting('test.rid')::uuid)$$, 'P0001', 'ALREADY_REVIEWED',
  'pre-approve dua kali ditolak');

-- pendaftar membayar
set local role anon;
select is((select status::text from public.get_recruitment_status(current_setting('test.code'))), 'pre_approved', 'status publik: pre_approved');
select lives_ok($$select public.submit_recruitment_payment(current_setting('test.code'),
  'recruitment/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png')$$, 'bukti bayar terkirim setelah pre-approved');
select is((select status::text from public.get_recruitment_status(current_setting('test.code'))), 'payment_submitted',
  'status: payment_submitted');
select throws_ok($$select public.submit_recruitment_payment(current_setting('test.code'),
  'recruitment/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png')$$, 'P0001', 'NOT_PAYABLE', 'tidak bisa mengirim bukti dua kali');

-- bukti ditolak -> kembali ke pre_approved dengan catatan (tampil ke pendaftar), lalu unggah ulang
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}', true);
select throws_ok($$select public.reject_recruitment_payment(current_setting('test.rid')::uuid, ' ')$$, 'P0001', 'NOTE_REQUIRED',
  'catatan wajib saat menolak bukti bayar');
select lives_ok($$select public.reject_recruitment_payment(current_setting('test.rid')::uuid, 'Nominal kurang')$$,
  'bukti bayar bisa ditolak');
set local role anon;
select is((select status::text || '|' || payment_note from public.get_recruitment_status(current_setting('test.code'))),
  'pre_approved|Nominal kurang', 'pendaftar melihat catatan penolakan bukti & kembali ke pre_approved');
select lives_ok($$select public.submit_recruitment_payment(current_setting('test.code'),
  'recruitment/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png')$$, 'bukti baru bisa diunggah');

-- approve
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}', true);
select matches(public.approve_recruitment(current_setting('test.rid')::uuid), '^FRC-\d{3}$', 'approve membuat anggota FRC-NNN');
select throws_ok($$select public.approve_recruitment(current_setting('test.rid')::uuid)$$, 'P0001', 'NOT_PAID', 'approve dua kali ditolak');
select is((select s.arrears_count from public.get_dues_summary((select id from public.members where email = 'calon@test.local')) s),
  0, 'tidak ada tunggakan: pembayaran pendaftaran = uang kas pertama (bulan pembayaran)');

reset role;
select ok((select m.source = 'recruitment' and m.full_name = 'Calon' and m.nickname = 'Calon' and m.domicile = 'Bandung'
                  and m.social_instagram = '@calon' and m.old_member_number is null
                  and m.dues_start_period = greatest(to_char(now() at time zone 'Asia/Jakarta', 'YYYY-MM'),
                        (select s.value #>> '{}' from public.app_settings s where s.key = 'recruitment_dues_start'))
           from public.members m where m.email = 'calon@test.local'),
  'anggota baru: sumber recruitment, nama = nickname bila kosong, data tersalin, bulan awal = bulan pembayaran tetapi tidak sebelum recruitment_dues_start');
select ok((select d.source = 'recruitment' and d.status = 'paid' and d.months = 1 and d.proof_path like 'recruitment/bbbbbbbb%'
                  and d.amount = public.dues_monthly_amount()
           from public.dues_payments d join public.members m on m.id = d.member_id where m.email = 'calon@test.local'),
  'pembayaran tercatat sebagai uang kas pertama (sumber recruitment, bukti yang terakhir)');
select is((select status::text from public.recruitments where email = 'calon@test.local'), 'approved', 'status akhir approved');
select is((select d.period_from from public.dues_payments d join public.members m on m.id = d.member_id
           where m.email = 'calon@test.local' and d.source = 'recruitment'),
  (select m.dues_start_period from public.members m where m.email = 'calon@test.local'),
  'uang kas pertama jatuh pada bulan awal penagihan (dihitung mulai recruitment_dues_start)');

-- bulan yang ditampilkan ke pendaftar sebelum membayar = bulan uang kas pertama
update public.app_settings set value = '"2099-05"' where key = 'recruitment_dues_start';
set local role anon;
select is((select first_period from public.get_recruitment_status(current_setting('test.code'))), '2099-05',
  'status publik memuat first_period (dibatasi recruitment_dues_start)');
reset role;

-- tolak pendaftaran baru; yang ditolak boleh mendaftar lagi
set local role anon;
select lives_ok($$select set_config('test.code2', public.submit_recruitment('', 'Tolak', 'tolak@test.local', 't', 'Jakarta', 'alasan', '@t'), true)$$,
  'pendaftaran kedua');
reset role;
select set_config('test.rid2', (select id::text from public.recruitments where email = 'tolak@test.local'), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}', true);
select lives_ok($$select public.reject_recruitment(current_setting('test.rid2')::uuid, '')$$, 'admin finance bisa menolak (catatan opsional)');
set local role anon;
select lives_ok($$select public.submit_recruitment('', 'Tolak', 'tolak@test.local', 't', 'Jakarta', 'alasan lagi', '@t')$$,
  'setelah ditolak, email yang sama boleh mendaftar lagi');
select is((select email from public.get_recruitment_status(current_setting('test.code'))), 'calon@test.local',
  'status publik: email dibuka setelah approved (untuk registrasi akun)');

select * from finish();
rollback;
