-- RESET DATA KEANGGOTAAN (DESTRUKTIF, tidak bisa dibatalkan setelah COMMIT).
-- Menghapus: semua anggota, akun login anggota, registrasi ulang, pembayaran uang kas, audit log;
-- mengembalikan daftar anggota lama menjadi "belum registrasi ulang"; counter nomor anggota kembali ke 0
-- (nomor berikutnya = FRC-001).
-- TIDAK menghapus: akun staf (admin / admin_finance / superadmin), daftar anggota lama (legacy_members: nama,
-- display name, nomor, lebih bayar), pengaturan (app_settings).
-- File bukti pembayaran di Storage TIDAK ikut terhapus (kosongkan bucket payment-proofs lewat Dashboard › Storage).
--
-- Cara pakai: Supabase Dashboard › SQL Editor › tempel seluruh isi file ini › cek hasil `select` di akhir ›
-- bila sudah benar jalankan COMMIT. Jalankan di staging dulu. JANGAN jalankan di live yang sudah dipakai anggota sungguhan.

begin;

-- 1) staf yang dulunya tertaut ke anggota: lepas tautannya (akun staf tetap ada)
update public.profiles set member_id = null where role::text <> 'member';

-- 2) akun login anggota (profiles ikut terhapus lewat cascade dari auth.users)
delete from auth.users
 where id in (select id from public.profiles where role::text = 'member');

-- 3) data keanggotaan (urutan mengikuti foreign key)
delete from public.dues_payment_months;
delete from public.dues_payments;
update public.legacy_members
   set is_registered = false, member_id = null, registered_at = null;
delete from public.re_registrations;
delete from public.members;
delete from public.audit_log;

-- 4) nomor anggota kembali ke awal
update public.member_counter set last_value = 0;

-- 5) cek hasil SEBELUM commit
select (select count(*) from public.members)            as members,
       (select count(*) from public.re_registrations)    as re_registrations,
       (select count(*) from public.dues_payments)       as dues_payments,
       (select last_value from public.member_counter)    as counter,
       (select count(*) from public.legacy_members)      as legacy_total,
       (select count(*) from public.legacy_members where is_registered) as legacy_registered,
       (select count(*) from public.profiles)            as profil_tersisa_staf;

-- Bila angka di atas sudah benar:
-- commit;
-- Bila ragu / ada yang salah:
-- rollback;
