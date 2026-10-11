-- pgTAP: manajemen anggota oleh admin/superadmin + audit log.
begin;
select plan(38);

-- Isolasi: kosongkan data dev DI DALAM transaksi ini (di-rollback di akhir).
delete from public.dues_payments;
delete from public.re_registrations;
delete from public.audit_log;
delete from public.profiles;
delete from public.members;

insert into public.account_provisioning (email, role, display_name) values
  ('sup@test.local', 'superadmin', 'Super Test'),
  ('adm@test.local', 'admin', 'Admin Test');
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'sup@test.local'),
  ('00000000-0000-0000-0000-0000000000e2', 'adm@test.local');

insert into public.members (member_number, source, full_name, email, line_id) values
  ('FF-701', 'recruitment', 'Member Satu', 'm1@test.local', 'm1'),
  ('FF-702', 'recruitment', 'Member Dua',  'm2@test.local', 'm2');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e3', 'm1@test.local'); -- profile dibuat trigger
select set_config('test.m1', (select id::text from public.members where member_number = 'FF-701'), true);
select set_config('test.m2', (select id::text from public.members where member_number = 'FF-702'), true);

-- ================================================================ ADMIN
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}', true);

select lives_ok($$select public.admin_update_member(current_setting('test.m1')::uuid,
  'Member Satu Baru', 'Bandung', date '2001-05-14', 'Jl. Melati 12', '0812-1111-2222', 'm1.baru', '@m1', '', '', to_char(now() at time zone 'Asia/Jakarta', 'YYYY-MM'))$$,
  'admin bisa mengubah data anggota');
select throws_ok($$select public.admin_update_member(current_setting('test.m1')::uuid,
  '  ', '', null, '', '', 'x', '', '', '', to_char(now() at time zone 'Asia/Jakarta', 'YYYY-MM'))$$, 'P0001', 'INVALID_NAME', 'nama kosong ditolak');
select throws_ok($$select public.admin_update_member(current_setting('test.m1')::uuid,
  'A', '', null, '', '12345', 'x', '', '', '', to_char(now() at time zone 'Asia/Jakarta', 'YYYY-MM'))$$, 'P0001', 'INVALID_PHONE', 'nomor HP tidak valid ditolak');
select throws_ok($$select public.admin_update_member(current_setting('test.m1')::uuid,
  'A', '', current_date + 1, '', '', 'x', '', '', '', to_char(now() at time zone 'Asia/Jakarta', 'YYYY-MM'))$$, 'P0001', 'INVALID_BIRTH_DATE', 'tanggal lahir di masa depan ditolak');
select throws_ok($$select public.admin_update_member(current_setting('test.m1')::uuid,
  'A', '', null, '', '', 'x', '', '', '', '2019-12')$$, 'P0001', 'INVALID_DUES_START', 'bulan awal iuran sebelum 2020 ditolak');
select throws_ok($$select public.admin_update_member(gen_random_uuid(),
  'A', '', null, '', '', 'x', '', '', '', to_char(now() at time zone 'Asia/Jakarta', 'YYYY-MM'))$$, 'P0001', 'NOT_FOUND', 'anggota tidak ditemukan');
select lives_ok($$select public.admin_update_member(current_setting('test.m2')::uuid,
  'Member Dua', '', null, '', '', 'm2', '', '', '', to_char(now() at time zone 'Asia/Jakarta', 'YYYY-MM'))$$, 'admin boleh mengosongkan No. HP & alamat');

reset role;
select is((select phone || '|' || line_id || '|' || birth_place from public.members where member_number = 'FF-701'),
  '081211112222|m1.baru|Bandung', 'data tersimpan & No. HP dinormalisasi');
select is((select display_name from public.profiles where member_id = current_setting('test.m1')::uuid),
  'Member Satu Baru', 'display_name akun ikut tersinkron saat nama diubah');
select is((select count(*)::int from public.audit_log where action = 'member.updated' and entity_id = current_setting('test.m1')::uuid
           and actor_id = '00000000-0000-0000-0000-0000000000e2'), 1, 'perubahan data tercatat di audit log (beserta pelakunya)');

-- ------------------------------------------------------------- status anggota
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}', true);

select throws_ok($$select public.admin_set_member_status(current_setting('test.m1')::uuid, 'revoked', '  ')$$,
  'P0001', 'NOTE_REQUIRED', 'revoke tanpa alasan ditolak');
select lives_ok($$select public.admin_set_member_status(current_setting('test.m1')::uuid, 'revoked', 'Melanggar aturan')$$,
  'admin bisa revoke dengan alasan');
select throws_ok($$select public.admin_set_member_status(current_setting('test.m1')::uuid, 'revoked', 'lagi')$$,
  'P0001', 'NO_CHANGE', 'status yang sama ditolak');
select is((select details ->> 'note' from public.audit_log
           where action = 'member.status_changed' and entity_id = current_setting('test.m1')::uuid), 'Melanggar aturan',
  'alasan revoke tercatat di audit log');

-- anggota yang di-revoke kehilangan akses walau sesinya masih ada
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e3","role":"authenticated"}', true);
select is((select count(*)::int from public.members), 0, 'anggota revoked tidak bisa membaca datanya lagi (RLS)');
select throws_ok($$select public.update_my_member_profile('Jl. X', '081234567890', 'x', '@x', '', '')$$,
  '42501', 'FORBIDDEN', 'anggota revoked tidak bisa edit profil');
select is(public.current_member_id(), null, 'current_member_id() = null untuk anggota revoked');

-- anggota biasa tidak bisa memakai fungsi admin
select throws_ok($$select public.admin_set_member_status(current_setting('test.m1')::uuid, 'active', '')$$,
  '42501', 'FORBIDDEN', 'anggota biasa tidak bisa mengubah status');
select throws_ok($$select public.admin_update_member(current_setting('test.m1')::uuid,
  'Hack', '', null, '', '', 'x', '', '', '', to_char(now() at time zone 'Asia/Jakarta', 'YYYY-MM'))$$, '42501', 'FORBIDDEN', 'anggota biasa tidak bisa mengubah data anggota');
select throws_ok($$select * from public.admin_get_member_account(current_setting('test.m1')::uuid)$$,
  '42501', 'FORBIDDEN', 'anggota biasa tidak bisa melihat info akun');
select is((select count(*)::int from public.audit_log), 0, 'anggota biasa tidak bisa membaca audit log');

-- pulihkan keanggotaan
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}', true);
select lives_ok($$select public.admin_set_member_status(current_setting('test.m1')::uuid, 'active', '')$$,
  'admin bisa memulihkan keanggotaan tanpa alasan');
select cmp_ok((select count(*)::int from public.audit_log), '>=', 3, 'admin bisa membaca audit log');

-- ------------------------------------------------------------ info akun (admin)
select is((select has_account from public.admin_get_member_account(current_setting('test.m1')::uuid)), true,
  'info akun: anggota dengan akun');
select is((select has_account from public.admin_get_member_account(current_setting('test.m2')::uuid)), false,
  'info akun: anggota tanpa akun');

-- admin biasa tidak boleh memakai fungsi superadmin
select throws_ok($$select public.superadmin_set_account_role(current_setting('test.m1')::uuid, 'admin')$$,
  '42501', 'FORBIDDEN', 'admin biasa tidak bisa mengubah role');
select throws_ok($$select public.superadmin_set_account_active(current_setting('test.m1')::uuid, false)$$,
  '42501', 'FORBIDDEN', 'admin biasa tidak bisa menonaktifkan akun');
select throws_ok($$select public.superadmin_log_password_reset(current_setting('test.m1')::uuid)$$,
  '42501', 'FORBIDDEN', 'admin biasa tidak bisa mencatat reset password');

-- ============================================================== SUPERADMIN
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);

select lives_ok($$select public.superadmin_set_account_role(current_setting('test.m1')::uuid, 'admin')$$,
  'superadmin bisa mengubah role akun');
select throws_ok($$select public.superadmin_set_account_role(current_setting('test.m1')::uuid, 'admin')$$,
  'P0001', 'NO_CHANGE', 'role yang sama ditolak');
select throws_ok($$select public.superadmin_set_account_role(current_setting('test.m2')::uuid, 'admin')$$,
  'P0001', 'NO_ACCOUNT', 'anggota tanpa akun tidak bisa diubah rolenya');
select lives_ok($$select public.superadmin_set_account_role(current_setting('test.m1')::uuid, 'member')$$,
  'role dikembalikan ke member');

select lives_ok($$select public.superadmin_set_account_active(current_setting('test.m1')::uuid, false)$$,
  'superadmin bisa menonaktifkan akun');
select lives_ok($$select public.superadmin_log_password_reset(current_setting('test.m1')::uuid)$$,
  'superadmin bisa mencatat permintaan reset password');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e3","role":"authenticated"}', true);
select is(public.current_member_id(), null, 'akun yang dinonaktifkan kehilangan akses anggota');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
select lives_ok($$select public.superadmin_set_account_active(current_setting('test.m1')::uuid, true)$$,
  'akun diaktifkan kembali');

reset role;
select is((select string_agg(action, ',' order by action) from public.audit_log
           where action like 'account.%' and entity_id = current_setting('test.m1')::uuid),
  'account.active_changed,account.active_changed,account.password_reset_requested,account.role_changed,account.role_changed',
  'semua aksi akun tercatat di audit log');

-- tidak ada akses langsung untuk anon pada fungsi baru
select ok(not has_function_privilege('anon', 'public.admin_update_member(uuid, text, text, date, text, text, text, text, text, text, text)', 'execute')
      and not has_function_privilege('anon', 'public.admin_set_member_status(uuid, public.member_status, text)', 'execute')
      and not has_function_privilege('anon', 'public.superadmin_set_account_role(uuid, public.app_role)', 'execute')
      and not has_function_privilege('anon', 'public.admin_get_member_account(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.write_audit(text, text, uuid, jsonb)', 'execute')
      and not has_function_privilege('authenticated', 'public.write_audit(text, text, uuid, jsonb)', 'execute'),
  'fungsi admin tidak bisa dieksekusi anon; write_audit tertutup untuk klien');

select * from finish();
rollback;
