-- Role baru: admin_finance (admin + hak approve/reject pembayaran & registrasi ulang).
-- Dipisah dari migrasi berikutnya karena nilai enum baru baru bisa dipakai setelah commit.
alter type public.app_role add value if not exists 'admin_finance';
