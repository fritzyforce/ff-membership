# Setup pengiriman email (produksi, paket gratis)

## Jawaban singkat
**Bisa, dan gratis** — tapi sebaiknya punya **domain sendiri**. Vercel tidak terlibat: email dikirim oleh
**Supabase Auth** lewat server SMTP yang kamu pilih, jadi tidak peduli aplikasinya di-host di mana.

> **Status saat ini:** *Confirm email* **dimatikan** (keputusan pemilik) — pendaftaran akun tidak butuh email.
> Email **tetap dibutuhkan** untuk **lupa password** dan **reset password oleh superadmin**, jadi SMTP sendiri
> masih perlu dipasang sebelum produksi bila fitur itu dipakai.

Email dipakai untuk: **lupa password**, **reset password oleh superadmin**, dan (bila *Confirm email* dinyalakan lagi) **konfirmasi akun baru**.

## Kenapa tidak bisa pakai bawaan Supabase
SMTP bawaan Supabase hanya untuk uji coba: **2 email/jam** dan **hanya ke anggota tim organisasi Supabase** (alamat lain
ditolak "Email address not authorized"), tanpa jaminan pengiriman. Setelah SMTP sendiri dipasang, batas default menjadi
**30 email/jam** (bisa dinaikkan di Dashboard › Authentication › Rate Limits).
Sumber: [Supabase — custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

## Pilihan layanan SMTP gratis
| Layanan | Kuota gratis | Catatan |
|---|---|---|
| **Resend** (disarankan) | 3.000 email/bulan, maks. 100/hari | Setup paling mudah. **Wajib verifikasi domain sendiri** — tanpa itu hanya bisa kirim ke email pemilik akun Resend ([sumber](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain), [harga](https://resend.com/pricing)). |
| **Brevo** | 300 email/hari, SMTP relay | Mendukung autentikasi domain (SPF/DKIM/DMARC); verifikasi DNS bisa sampai 48 jam ([sumber](https://www.brevo.com/free-smtp-server)). |

Perkiraan pemakaian: 1 email per akun baru + 1 per reset password → komunitas ratusan anggota masih jauh di bawah kuota.

### Kalau belum punya domain
1. **Beli domain murah** (sekitar puluhan sampai ratusan ribu rupiah per tahun) — jalur paling disarankan; sekaligus bisa dipakai untuk alamat `noreply@`.
2. **Jangan** memakai Gmail/Yahoo sebagai pengirim lewat SMTP layanan lain: email akan masuk spam atau ditolak (DMARC).
3. Bila benar-benar tidak mau memakai email, lihat bagian *"Tanpa email"* di bawah.

## Langkah setup (Resend + Supabase cloud)
1. **Domain**: daftar di Resend → *Domains* → *Add Domain* → tambahkan record DNS (SPF, DKIM) yang diminta di pengelola domain → tunggu status *Verified*.
2. **API key**: Resend → *API Keys* → buat key khusus pengiriman. Simpan di password manager; jangan di-commit.
3. **Supabase** → project produksi → *Authentication* → pengaturan **SMTP** (Emails › SMTP Settings), aktifkan *Custom SMTP*:
   - Host `smtp.resend.com`, Port `465`
   - Username `resend`, Password = API key dari langkah 2
   - Sender email `noreply@domainmu.com` (harus di domain terverifikasi), Sender name `Fritzy Force`
4. **Rate limits** (Authentication › Rate Limits): atur batas email/jam sesuai kebutuhan.
5. **URL Configuration**:
   - *Site URL* = URL produksi (mis. `https://namamu.vercel.app` atau domain sendiri).
   - *Redirect URLs* = URL produksi + (opsional) pola preview Vercel, mis. `https://*-timmu.vercel.app/**`.
   Tanpa ini tautan konfirmasi/reset **gagal** (redirect ditolak).
6. **Template email**: salin isi `supabase/templates/confirmation.html` dan `recovery.html` ke
   *Authentication › Email Templates* (subjek: lihat `supabase/config.toml`). Alternatif: `supabase config push`
   (aktifkan blok `[auth.email.smtp]` di `config.toml` dan set `SMTP_PASS` di environment).
7. **Konfirmasi email** (Authentication › Providers › Email): **Confirm email = OFF** (sesuai keputusan saat ini; lihat risikonya di bawah);
   password minimal 8 + wajib huruf besar/kecil/angka.
8. **Vercel** → Settings › Environment Variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   (hanya dua ini — **jangan** menaruh service role key di Vercel).

## Cara menguji
1. Buat akun uji lewat `/register/` dengan email anggota yang valid → langsung masuk ke `/akun/` (tanpa email).
2. Coba `/lupa-password/` → cek inbox **dan folder spam** → klik tautan → buat password baru.
4. Di Resend → *Emails* lihat status terkirim/bounce bila ada masalah.

## Konfirmasi email dimatikan: risiko & cara menyalakan lagi
Dengan *Confirm email = OFF*, akun langsung aktif saat daftar. **Risiko**: siapa pun yang tahu email seorang anggota yang sudah
disetujui bisa membuat akunnya lebih dulu (tidak ada bukti kepemilikan email). Pengaman yang tetap berlaku: hanya email anggota
aktif yang bisa mendaftar, dan satu anggota hanya bisa punya satu akun; admin/superadmin bisa menonaktifkan akun yang bermasalah
dan mengirim reset password.

Untuk menyalakan lagi: pasang SMTP (langkah di atas) → Dashboard › Authentication › Providers › Email › **Confirm email = ON**
(lokal: `enable_confirmations = true` di `supabase/config.toml`). Aplikasi mendukung kedua mode tanpa perubahan kode.

Tanpa SMTP sama sekali, **lupa password tidak akan bekerja**; reset harus manual lewat Dashboard › Authentication › Users.

## Email notifikasi status (siap pakai, belum diaktifkan)
Setelah admin **Approve/Reject registrasi ulang**, pendaftar bisa dikirimi email (nomor anggota + tautan Buat Akun, atau
tautan Ajukan Ulang). Kodenya sudah ada, tetapi **pemanggilnya masih di-comment**:

| Bagian | Lokasi |
|---|---|
| Pengirim email (Resend) | `supabase/functions/send-status-email/index.ts` (Supabase Edge Function) |
| Template HTML + teks | `supabase/functions/send-status-email/templates.ts` |
| Pemanggil dari aplikasi | `lib/email/notify.ts` → `notifyReRegistrationReviewed(id)` |
| Titik pasang (di-comment) | `components/views/admin-reregistration-detail-view.tsx` (cari `TODO(email)`) |

Kenapa Edge Function: aplikasi ini statis (tanpa server), sedangkan kunci Resend tidak boleh ada di browser.
Fungsi memakai JWT admin pemanggil (RLS), mengambil **penerima dan isi dari database** berdasarkan `id`, jadi tidak bisa
dipakai mengirim email ke alamat/teks sembarang. Catatan review admin **tidak pernah** ikut dikirim.

### Cara mengaktifkan
1. Siapkan Resend + domain terverifikasi (langkah 1–2 di atas).
2. Isi secrets, lalu deploy fungsi:
   ```bash
   npx supabase secrets set RESEND_API_KEY=re_xxx EMAIL_FROM="Fritzy Force <noreply@domainmu.com>" SITE_URL=https://domainmu.com
   npx supabase functions deploy send-status-email
   ```
3. Hapus tanda comment pada import dan dua pemanggil `notifyReRegistrationReviewed` di
   `admin-reregistration-detail-view.tsx`.
4. Uji: approve satu registrasi ulang uji → cek inbox dan dasbor Resend.

Catatan: kegagalan email tidak membatalkan approve/reject (admin hanya melihat peringatan). Menekan tombol dua kali tidak
mungkin karena status sudah berubah, tetapi fungsi sendiri tidak membatasi pengiriman ulang.
Untuk uji lokal: `db:start` mengecualikan edge-runtime; jalankan `npx supabase functions serve` terpisah.
