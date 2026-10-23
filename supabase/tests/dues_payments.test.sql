-- pgTAP: uang kas per bulan (alokasi tunggakan, kelipatan, bayar di muka, RLS, storage, review).
begin;
select plan(61);

-- Isolasi: kosongkan data dev DI DALAM transaksi ini (di-rollback di akhir).
delete from public.dues_payments;
delete from public.re_registrations;
delete from public.recruitments;
delete from public.audit_log;
delete from public.profiles;
delete from public.members;

insert into public.account_provisioning (email, role, display_name) values ('adm@test.local', 'admin_finance', 'Admin Finance Test');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f1', 'adm@test.local');

insert into public.members (member_number, source, full_name, email, line_id) values
  ('FF-711', 'recruitment', 'Anggota Satu', 'a1@test.local', 'a1'),
  ('FF-712', 'recruitment', 'Anggota Dua',  'a2@test.local', 'a2');
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f2', 'a1@test.local'),
  ('00000000-0000-0000-0000-0000000000f3', 'a2@test.local');
select set_config('test.m1', (select id::text from public.members where member_number = 'FF-711'), true);
select set_config('test.m2', (select id::text from public.members where member_number = 'FF-712'), true);

-- bulan-bulan acuan (WIB). Anggota 1 mulai ditagih 3 bulan lalu.
select set_config('test.p3', to_char((now() at time zone 'Asia/Jakarta') - interval '3 month', 'YYYY-MM'), true);
select set_config('test.p2', to_char((now() at time zone 'Asia/Jakarta') - interval '2 month', 'YYYY-MM'), true);
select set_config('test.p1', to_char((now() at time zone 'Asia/Jakarta') - interval '1 month', 'YYYY-MM'), true);
select set_config('test.n0', to_char(now() at time zone 'Asia/Jakarta', 'YYYY-MM'), true);
select set_config('test.n1', to_char((now() at time zone 'Asia/Jakarta') + interval '1 month', 'YYYY-MM'), true);
select set_config('test.n2', to_char((now() at time zone 'Asia/Jakarta') + interval '2 month', 'YYYY-MM'), true);
update public.members set dues_start_period = current_setting('test.p3') where id = current_setting('test.m1')::uuid;

-- ============================================================= ANON
set local role anon;
select throws_ok($$select * from public.dues_payments$$, '42501', null, 'anon tidak bisa membaca dues_payments');
select throws_ok($$select * from public.dues_payment_months$$, '42501', null, 'anon tidak bisa membaca dues_payment_months');
select throws_ok($$select * from public.app_settings$$, '42501', null, 'anon tidak bisa membaca app_settings');
select ok(not has_function_privilege('anon', 'public.submit_dues_payment(integer, text)', 'execute')
      and not has_function_privilege('anon', 'public.preview_dues_payment(integer)', 'execute')
      and not has_function_privilege('anon', 'public.get_dues_summary(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.approve_dues_payment(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.reject_dues_payment(uuid, text)', 'execute'),
  'anon tidak bisa menjalankan RPC uang kas');
select ok(not has_function_privilege('authenticated', 'public.dues_next_periods(uuid, integer, boolean)', 'execute')
      and not has_function_privilege('authenticated', 'public.dues_months_for_amount(integer)', 'execute'),
  'fungsi alokasi internal tidak bisa dipanggil langsung dari browser');
select throws_ok($$insert into storage.objects (bucket_id, name)
  values ('payment-proofs', 'dues/' || current_setting('test.m1') || '/11111111-1111-4111-8111-111111111111.png')$$,
  '42501', null, 'anon tidak bisa upload bukti uang kas');

-- ====================================================== ANGGOTA 1: storage
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}', true);

select lives_ok($$insert into storage.objects (bucket_id, name)
  values ('payment-proofs', 'dues/' || current_setting('test.m1') || '/11111111-1111-4111-8111-111111111111.png')$$,
  'anggota bisa upload bukti ke folder miliknya');
select throws_ok($$insert into storage.objects (bucket_id, name)
  values ('payment-proofs', 'dues/' || current_setting('test.m2') || '/22222222-2222-4222-8222-222222222222.png')$$,
  '42501', null, 'anggota tidak bisa upload ke folder anggota lain');
select throws_ok($$insert into storage.objects (bucket_id, name)
  values ('payment-proofs', 'dues/liar.png')$$, '42501', null, 'anggota tidak bisa upload di luar pola path');
select is((select count(*)::int from storage.objects where bucket_id = 'payment-proofs'), 1,
  'anggota hanya melihat file di folder miliknya');

-- ========================================================= pengaturan & ringkasan
select is((select (value #>> '{}')::int from public.app_settings where key = 'dues_monthly_amount'), 20000,
  'iuran bulanan = Rp 20.000 (terbaca anggota)');
select throws_ok($$update public.app_settings set value = '1'$$, '42501', null, 'anggota tidak bisa mengubah pengaturan');

select is((select start_period || '|' || next_period || '|' || arrears_count::text || '|' || monthly_amount::text
             || '|' || coalesce(covered_through, '-') from public.get_dues_summary()),
  current_setting('test.p3') || '|' || current_setting('test.p3') || '|4|20000|-',
  'ringkasan awal: ditagih sejak 3 bulan lalu, belum ada yang dibayar, tunggakan 4 bulan');

-- ============================================================ pratinjau & validasi nominal
select is(public.preview_dues_payment(20000), array[current_setting('test.p3')], 'pratinjau 1 bulan: mulai dari bulan tertunggak paling awal');
select is(public.preview_dues_payment(60000),
  array[current_setting('test.p3'), current_setting('test.p2'), current_setting('test.p1')],
  'pratinjau 3 bulan: berurutan dari tunggakan paling awal');
select throws_ok($$select public.preview_dues_payment(10000)$$, 'P0001', 'INVALID_AMOUNT', 'di bawah minimum (Rp 20.000) ditolak');
select throws_ok($$select public.preview_dues_payment(30000)$$, 'P0001', 'INVALID_AMOUNT', 'bukan kelipatan Rp 20.000 ditolak');
select throws_ok($$select public.preview_dues_payment(0)$$, 'P0001', 'INVALID_AMOUNT', 'nominal 0 ditolak');
select throws_ok($$select public.preview_dues_payment(400000)$$, 'P0001', 'TOO_FAR_AHEAD', 'bayar di muka lebih dari 12 bulan ditolak');

-- ============================================================ submit
select throws_ok($$select public.submit_dues_payment(30000,
  'dues/' || current_setting('test.m1') || '/11111111-1111-4111-8111-111111111111.png')$$,
  'P0001', 'INVALID_AMOUNT', 'submit: bukan kelipatan ditolak');
select throws_ok($$select public.submit_dues_payment(40000,
  'dues/' || current_setting('test.m2') || '/22222222-2222-4222-8222-222222222222.png')$$,
  'P0001', 'INVALID_PROOF', 'bukti dari folder anggota lain ditolak');
select throws_ok($$select public.submit_dues_payment(40000,
  'dues/' || current_setting('test.m1') || '/99999999-9999-4999-8999-999999999999.png')$$,
  'P0001', 'PROOF_NOT_FOUND', 'bukti yang belum diunggah ditolak');
select lives_ok($$select set_config('test.d1', public.submit_dues_payment(40000,
  'dues/' || current_setting('test.m1') || '/11111111-1111-4111-8111-111111111111.png')::text, true)$$,
  'submit Rp 40.000 = 2 bulan berhasil');
select throws_ok($$select public.submit_dues_payment(40000,
  'dues/' || current_setting('test.m1') || '/11111111-1111-4111-8111-111111111111.png')$$,
  'P0001', 'ALREADY_SUBMITTED', 'file bukti yang sama tidak bisa dipakai dua kali');

select is((select period_from || '|' || period_to || '|' || months::text || '|' || status::text
           from public.dues_payments where id = current_setting('test.d1')::uuid),
  current_setting('test.p3') || '|' || current_setting('test.p2') || '|2|processing',
  'Rp 40.000 menutup 2 bulan tertunggak paling awal (p3 s.d. p2), status processing');
select is((select count(*)::int from public.dues_payment_months where payment_id = current_setting('test.d1')::uuid and active), 2,
  'tiap bulan tercatat di dues_payment_months');
select is((select next_period || '|' || covered_through || '|' || arrears_count::text from public.get_dues_summary()),
  current_setting('test.p1') || '|' || current_setting('test.p2') || '|2',
  'ringkasan: pembayaran yang masih diproses sudah menutup bulannya (tunggakan tinggal 2)');
select throws_ok($$update public.dues_payments set status = 'paid'$$, '42501', null, 'anggota tidak bisa mengubah status langsung');
select throws_ok($$select public.approve_dues_payment(current_setting('test.d1')::uuid)$$,
  '42501', 'FORBIDDEN', 'anggota tidak bisa approve');
select throws_ok($$select * from public.get_dues_summary(current_setting('test.m2')::uuid)$$,
  '42501', 'FORBIDDEN', 'anggota tidak bisa melihat ringkasan anggota lain');

reset role;
insert into storage.objects (bucket_id, name) values
  ('payment-proofs', 'dues/' || current_setting('test.m1') || '/33333333-3333-4333-8333-333333333333.jpg'),
  ('payment-proofs', 'dues/' || current_setting('test.m1') || '/44444444-4444-4444-8444-444444444444.png'),
  ('payment-proofs', 'dues/' || current_setting('test.m1') || '/55555555-5555-4555-8555-555555555555.png');

-- pengajuan kedua: sambung ke bulan berikutnya (tidak menimpa yang sedang diproses)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}', true);
select lives_ok($$select set_config('test.d2', public.submit_dues_payment(20000,
  'dues/' || current_setting('test.m1') || '/33333333-3333-4333-8333-333333333333.jpg')::text, true)$$,
  'pengajuan kedua (jpg) berhasil');
select is((select period_from from public.dues_payments where id = current_setting('test.d2')::uuid), current_setting('test.p1'),
  'pengajuan kedua disambung ke bulan berikutnya (p1)');

-- ======================================================= ANGGOTA 2: isolasi
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f3","role":"authenticated"}', true);
select is((select count(*)::int from public.dues_payments), 0, 'anggota lain tidak melihat pembayaran orang lain');
select is((select count(*)::int from public.dues_payment_months), 0, 'anggota lain tidak melihat bulan orang lain');
select is((select count(*)::int from storage.objects where bucket_id = 'payment-proofs'), 0,
  'anggota lain tidak melihat bukti orang lain');

-- ================================================================ ADMIN
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}', true);
select is((select count(*)::int from public.dues_payments), 2, 'admin melihat semua pembayaran');
select is((select count(*)::int from public.dues_payment_months), 3, 'admin melihat semua bulan');
select is((select arrears_count from public.get_dues_summary(current_setting('test.m1')::uuid)), 1,
  'admin bisa melihat ringkasan iuran anggota (tunggakan: bulan berjalan)');

-- reject d1: bulan p3 & p2 terbuka lagi
select throws_ok($$select public.reject_dues_payment(current_setting('test.d1')::uuid, '  ')$$,
  'P0001', 'NOTE_REQUIRED', 'reject tanpa catatan ditolak');
select lives_ok($$select public.reject_dues_payment(current_setting('test.d1')::uuid, 'Nominal tidak sesuai')$$,
  'admin bisa reject dengan catatan');
select throws_ok($$select public.approve_dues_payment(current_setting('test.d1')::uuid)$$,
  'P0001', 'ALREADY_REVIEWED', 'approve setelah reject ditolak');

reset role;
select is((select count(*)::int from public.dues_payment_months where payment_id = current_setting('test.d1')::uuid and active), 0,
  'reject membuka kembali bulan-bulannya');

-- anggota 1: bulan terbuka diisi LEBIH DULU, sebelum bulan berjalan / bulan depan
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}', true);
select is((select next_period from public.get_dues_summary()), current_setting('test.p3'),
  'setelah reject, bulan tertunggak paling awal (p3) kembali jadi yang berikutnya');
select lives_ok($$select set_config('test.d3', public.submit_dues_payment(40000,
  'dues/' || current_setting('test.m1') || '/44444444-4444-4444-8444-444444444444.png')::text, true)$$,
  'ajukan ulang Rp 40.000');
select is((select period_from || '|' || period_to from public.dues_payments where id = current_setting('test.d3')::uuid),
  current_setting('test.p3') || '|' || current_setting('test.p2'),
  'ajukan ulang mengisi celah (p3 s.d. p2), bukan melompat ke bulan berjalan');

-- bayar di muka: sisa tunggakan = bulan berjalan; 3 bulan => bulan berjalan + 2 bulan ke depan
select is(public.preview_dues_payment(60000),
  array[current_setting('test.n0'), current_setting('test.n1'), current_setting('test.n2')],
  'kelebihan bayar menutup bulan ke depan');
select lives_ok($$select set_config('test.d4', public.submit_dues_payment(60000,
  'dues/' || current_setting('test.m1') || '/55555555-5555-4555-8555-555555555555.png')::text, true)$$,
  'bayar 3 bulan (termasuk bulan ke depan) berhasil');
select is((select period_from || '|' || period_to || '|' || months::text from public.dues_payments where id = current_setting('test.d4')::uuid),
  current_setting('test.n0') || '|' || current_setting('test.n2') || '|3', 'rentang pembayaran di muka tercatat benar');
select is((select arrears_count::text || '|' || covered_through from public.get_dues_summary()),
  '0|' || current_setting('test.n2'), 'tunggakan 0 dan tertutup sampai bulan ke depan');

-- ======================================================== approve
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}', true);
select lives_ok($$select public.approve_dues_payment(current_setting('test.d4')::uuid)$$, 'admin bisa approve');
select throws_ok($$select public.approve_dues_payment(current_setting('test.d4')::uuid)$$,
  'P0001', 'ALREADY_REVIEWED', 'approve dua kali ditolak');
select throws_ok($$select public.approve_dues_payment(gen_random_uuid())$$, 'P0001', 'NOT_FOUND', 'id tidak dikenal');

reset role;
select ok((select d.status = 'paid' and d.paid_at = (now() at time zone 'Asia/Jakarta')::date
                  and d.reviewed_by = '00000000-0000-0000-0000-0000000000f1' and d.reviewed_at is not null
           from public.dues_payments d where d.id = current_setting('test.d4')::uuid),
  'approve: status paid, tanggal WIB, reviewer tercatat');
select is((select count(*)::int from public.dues_payment_months where payment_id = current_setting('test.d4')::uuid and active), 3,
  'bulan tetap tertutup setelah approve');
select is((select string_agg(action, ',' order by action) from public.audit_log where entity = 'dues_payment'),
  'dues.approved,dues.rejected', 'approve & reject tercatat di audit log');
select is((select (details ->> 'months')::int from public.audit_log where action = 'dues.approved'), 3,
  'audit approve memuat jumlah bulan');

-- anggota yang di-revoke tidak bisa mengajukan
update public.members set status = 'revoked' where id = current_setting('test.m1')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}', true);
select throws_ok($$select public.submit_dues_payment(20000,
  'dues/' || current_setting('test.m1') || '/44444444-4444-4444-8444-444444444444.png')$$,
  '42501', 'FORBIDDEN', 'anggota revoked tidak bisa mengajukan pembayaran');
select throws_ok($$select * from public.preview_dues_payment(20000)$$, '42501', 'FORBIDDEN',
  'anggota revoked tidak bisa melihat pratinjau');

-- ============================================================ integritas data
reset role;
select throws_ok($$insert into public.dues_payments (member_id, amount, status, proof_path, period_from, period_to, months)
  values (current_setting('test.m2')::uuid, 20000, 'paid', 'x', '2026-01', '2026-01', 1)$$, '23514', null,
  'constraint menolak status paid tanpa data review');
select throws_ok($$insert into public.dues_payment_months (payment_id, member_id, period)
  values (current_setting('test.d4')::uuid, current_setting('test.m1')::uuid, current_setting('test.n0'))$$, '23505', null,
  'satu bulan tidak bisa ditutup dua kali oleh pembayaran aktif');
select throws_ok($$update public.members set dues_start_period = '2026-13' where id = current_setting('test.m1')::uuid$$, '23514', null,
  'format bulan awal iuran divalidasi');

select * from finish();
rollback;
