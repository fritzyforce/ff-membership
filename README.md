# Fritzy Force — Recruitment & Member Portal

Implementasi design canvas **"Fritzy Force Recruitment & Member Portal"** (mobile + desktop, dark + light).
Stack sama dengan `fritzyforce-nextjs`: Next.js 16 App Router, React 19, TypeScript, Tailwind 3.4, static export (`out/`).

Tema mengikuti setting device (light/dark) secara otomatis; tombol ☀/🌙 bisa meng-override
(pilihan disimpan per browser, dan kembali "ikut device" bila dipilih tema yang sama dengan device).

Backend dimigrasi **bertahap ke Supabase**:

| Fitur | Sumber data |
|---|---|
| **Registrasi ulang** (form, daftar & detail admin, approve/reject, cek status) | ✅ Supabase |
| **Daftar & login member** (email + password, profil sendiri) | ✅ Supabase Auth |
| **Login admin / superadmin** | ✅ Supabase Auth (+ tabel `profiles`) |
| **Penomoran anggota `FF-001`–`FF-999`** | ✅ Supabase |
| **Manajemen anggota (admin/superadmin)** — daftar, detail, edit, status, aksi akun, audit log | ✅ Supabase |
| **Uang kas** — anggota mengajukan pembayaran, admin cek bukti & approve/reject | ✅ Supabase |
| **Lupa / reset password** (email) | ✅ Supabase Auth |
| Rekrutmen baru (form, cek status, Recruitment Management admin) | dummy (`localStorage`) — fase berikutnya |

Copy panjang masih Lorem Ipsum.

## Jalankan
Butuh **Docker** (Supabase lokal). Pertama kali akan mengunduh image (beberapa menit).
```bash
npm install
npm run db:start                 # Supabase lokal (API http://127.0.0.1:54321, Studio :54323)
cp .env.example .env.local       # isi anon key & service role key dari `npx supabase status`
npm run db:seed                  # akun admin + contoh registrasi ulang (idempotent)
npm run dev                      # http://localhost:3000
```
Email lokal (mis. reset password) masuk ke **Mailpit**: http://127.0.0.1:54324 (tidak ada email sungguhan yang terkirim).
Perintah lain: `npm run db:test` (tes pgTAP RLS/RPC), `npm run db:reset` (migrasi ulang, lalu `db:seed`),
`npm run db:stop`, `npm run build` (hasil di `./out`).

> `SUPABASE_SERVICE_ROLE_KEY` hanya dipakai `scripts/seed-dev.mjs` (tanpa prefix `NEXT_PUBLIC_`,
> tidak masuk bundle browser). Script menolak host non-lokal.

## Akun dev (hasil `npm run db:seed`)
| Peran | Email | Password |
|---|---|---|
| Superadmin | `superadmin@fritzyforce.test` | `Superadmin123` |
| Admin | `admin@fritzyforce.test` | `Admin12345` |
| Member **FF-001** (Teguh Prakoso) — sudah punya akun | `teguh.prakoso@fritzyforce.test` | `Member12345` |
| Anggota **FF-002** (Wulan Sari) — **belum** punya akun | `wulan.sari@fritzyforce.test` | buat sendiri di `/register/` |

Semua akun di atas ada di Supabase Auth. Password mengikuti kebijakan server (huruf besar + kecil + angka, min. 8),
termasuk akun admin. Teguh (FF-001) punya riwayat uang kas contoh; Wulan (FF-002) punya satu pembayaran ditolak + satu menunggu.

## Daftar & login member (backend Supabase)
**Daftar** — `/register/`: email + password. Hanya email **anggota aktif yang sudah disetujui admin** dan belum punya akun
yang bisa membuat akun; pengecekan dilakukan trigger database (`handle_new_auth_user`), bukan hanya di UI.
Profile (`profiles`) dibuat otomatis dan tertaut ke anggota. Pesan penolakan sengaja sama untuk "bukan anggota" dan
"sudah punya akun" agar form tidak bisa dipakai menebak siapa anggotanya.

**Syarat password** — huruf besar, huruf kecil, angka, minimal 8 karakter. Ditegakkan **server**
(`password_requirements = "lower_upper_letters_digits"` di `supabase/config.toml`); form menampilkan checklist langsung.

**Konfirmasi email: DIMATIKAN** (keputusan pemilik) — akun langsung aktif dan masuk ke `/akun/`. Risikonya: siapa pun yang tahu
email anggota yang sudah disetujui bisa membuat akunnya lebih dulu. Bisa dinyalakan lagi tanpa ubah kode (butuh SMTP) —
lihat [docs/email-setup.md](docs/email-setup.md). Alur konfirmasi & kirim ulang tetap ada di aplikasi untuk saat dinyalakan.

**Login** — `/login/`: admin ke `/admin/…`, member ke `/akun/`. Anggota yang di-revoke/nonaktif ditolak.
**Akun Saya** — profil dibaca dari Supabase; *Edit Profil* lewat RPC `update_my_member_profile` (alamat, No. HP, ID Line, sosmed).
Riwayat uang kas di halaman itu juga dari Supabase (lihat bagian *Uang kas*).

**Penomoran anggota** — `FF-001` … `FF-999`, berurutan **tanpa celah**, diberikan saat admin Approve. Memakai tabel
counter satu baris (bukan `sequence`) sehingga approve yang gagal tidak menghabiskan nomor. Setelah `FF-999`, approve
ditolak (`MEMBER_NUMBER_EXHAUSTED`). Constraint database menolak format lain. Data dummy rekrutmen masih memakai format
lama `FF-2026-xxxx` sampai fitur rekrutmen dimigrasi.

**Membuat akun staf (admin/superadmin)** — sign-up publik tidak bisa membuat admin. Daftarkan emailnya (sekali pakai),
lalu buat user (Dashboard › Authentication › Add user, atau Admin API); trigger membuat profile ber-role itu:
```sql
insert into public.account_provisioning (email, role, display_name)
values ('nama@domain.com', 'admin', 'Nama Admin');   -- role: 'admin' | 'superadmin'
```

**Deploy preview ke Vercel + Supabase cloud (langkah demi langkah):** [docs/deploy-vercel-supabase.md](docs/deploy-vercel-supabase.md)

### Checklist sebelum produksi
Beberapa pengaturan hanya ada di `supabase/config.toml` (lokal) — **di project cloud harus diset manual**:
- Authentication › Providers › Email: **Confirm email = OFF** (keputusan saat ini), password minimal 8 + wajib huruf besar/kecil/angka.
- Authentication › URL Configuration: **Site URL** dan **Redirect URLs** ke domain produksi (tautan konfirmasi gagal bila tidak terdaftar).
- **SMTP sendiri** (SMTP bawaan Supabase sangat terbatas) + atur rate limit email; pertimbangkan CAPTCHA (Turnstile) di form publik.
- Terapkan migrasi: `supabase link` lalu `supabase db push`. Jangan jalankan `db:seed` ke produksi (script menolak host non-lokal).
- Buat akun admin pertama lewat `account_provisioning` (lihat atas); ganti semua password dev.
- **Setup email produksi (SMTP gratis, Vercel):** ikuti [docs/email-setup.md](docs/email-setup.md). Tanpa SMTP sendiri, konfirmasi email & lupa password tidak akan terkirim ke anggota.

## Lupa & reset password
`/lupa-password/` → email berisi tautan → `/reset-password/` (password baru wajib memenuhi syarat yang sama). Respons form
sengaja netral (tidak membocorkan email terdaftar atau tidak). Superadmin juga bisa mengirim email reset dari detail anggota.
Template email (Indonesia): `supabase/templates/`; panduan SMTP produksi: [docs/email-setup.md](docs/email-setup.md).

## Manajemen anggota (admin & superadmin)
Menu **Member Management** (`/admin/members/`): daftar dengan pencarian (nama/email/nomor), filter status, pagination dari server.
Detail (`/admin/members/detail/?id=`):
- **Edit data** anggota (nama, tempat/tgl lahir, alamat, No. HP, ID Line, sosmed). Email tidak bisa diubah (penghubung ke akun).
- **Status keanggotaan**: *Aktif* / *Nonaktif* / *Revoked*. Nonaktif/revoke **wajib beralasan** dan langsung menutup akses anggota
  ke profil & pembayarannya (ditegakkan RLS, bukan hanya UI), termasuk bila ia masih login. Tidak bisa mengubah diri sendiri.
- **Info akun** (sudah punya akun, role, email terkonfirmasi, login terakhir) dan **riwayat uang kas** anggota.
- **Superadmin only**: kirim email reset password, ubah role (member/admin/superadmin), aktif/nonaktifkan akun.
- **Riwayat aktivitas** (`audit_log`): setiap tindakan admin tercatat — siapa, apa, kapan.

## Uang kas (per bulan)
**Aturan:** iuran **Rp 20.000 per bulan** (`app_settings.dues_monthly_amount`, ubah lewat SQL/dashboard). Anggota membayar
**kelipatan Rp 20.000** (minimal 1 bulan); tiap kelipatan = 1 bulan.
- **Mulai ditagih** dari bulan registrasi / registrasi ulang (`members.dues_start_period`, WIB — bulan pengajuan, bukan bulan approve).
- Anggota **tidak memilih periode**. Pembayaran otomatis menutup **bulan yang belum tertutup paling awal** lebih dulu, jadi tunggakan
  dibayar berurutan dari yang tertua; kelebihan menutup **bulan ke depan** (maks. 12 bulan dari bulan berjalan).
  Contoh: ditagih sejak Juli, belum bayar, sekarang Oktober → bayar Rp 60.000 menutup Juli–September; Rp 100.000 menutup Juli–November.
- Pembayaran yang **ditolak** membuka kembali bulan-bulannya (terisi lebih dulu pada pembayaran berikutnya); yang masih
  *Menunggu verifikasi* sudah dianggap menutup bulannya (tidak dihitung tunggakan).
- Ringkasan per anggota: tunggakan (n bulan), tertutup sampai bulan apa, dan bulan pembayaran berikutnya.

**Anggota** (`/akun/bayar/`): pilih jumlah bulan (1–12; default = jumlah tunggakan), lihat total transfer dan bulan yang akan tertutup
(dihitung server), upload bukti JPG/PNG ≤ 5MB. Riwayat & ringkasan di `/akun/`; catatan penolakan terlihat.

**Admin** (`/admin/uang-kas/`): antrean *Menunggu Verifikasi* (default), filter status, cari nama/email/nomor. *Review* →
bukti (URL sementara 5 menit) → **Approve** (lunas, tanggal verifikasi WIB) atau **Reject** (catatan wajib). Di detail anggota admin
melihat ringkasan iuran dan bisa menyesuaikan **"Iuran dihitung sejak"** untuk kasus khusus.

Keamanan: anggota hanya mengunggah ke folder `dues/<id-anggota>/` miliknya dan hanya melihat pembayarannya sendiri; semua tulis lewat
RPC (`submit_dues_payment`, `approve_dues_payment`, `reject_dues_payment`); alokasi bulan dihitung & dikunci di database (satu bulan
hanya bisa ditutup satu pembayaran aktif; pengajuan per anggota diserialkan).

> Catatan: bukti pembayaran saat **registrasi ulang** belum dicatat sebagai uang kas bulan pertama (form-nya tidak mengisi nominal).

## Kode pendaftaran dummy (untuk `/cek-status/`)
| Kode | Status |
|---|---|
| `REG-2026-0418`, `REG-2026-0416`, `REG-2026-0415` | Menunggu Review |
| `REG-2026-0419` | Pre-approved (QRIS + upload bukti bayar) |
| `REG-2026-0420` | Bukti bayar terkirim, menunggu verifikasi |
| `REG-2026-0413` | Approved, **belum punya akun** → bisa tes Register dengan `jasmine.putri@fritzyforce.test` |
| `REG-2026-0417` | Approved, sudah punya akun |
| `REG-2026-0414` | Rejected |

Cek status juga bisa pakai email pendaftaran.

## Registrasi ulang anggota lama (backend Supabase)
**Pendaftar** — `/registrasi-ulang/` (link di homepage): nama, email, ID Line, bukti pembayaran kas (JPG/PNG ≤ 5MB).
Bukti diunggah ke bucket privat `payment-proofs`, lalu RPC `submit_re_registration` membuat pengajuan
berstatus **pending** dan mengembalikan kode acak `RU-XXXX-XXXX`. Status bisa dicek di `/cek-status/`
dengan kode tersebut (hanya nama depan & status yang terlihat).

**Admin** — menu *Registrasi Ulang* (`/admin/registrasi-ulang/`): antrean pending (default), filter status,
cari nama/email/kode, pagination server-side. *Review* → detail + bukti bayar (signed URL 5 menit) →
**Approve** (membuat anggota + nomor `FF-NNN` secara atomik) atau **Reject**. Catatan review **opsional** dan hanya terlihat admin (tidak tampil di halaman pendaftar). Status publik hanya
mengembalikan email pendaftar bila sudah approved, untuk mengisi otomatis halaman Registrasi Akun.
Email notifikasi hasil review: kode siap tetapi pemanggilnya di-comment — lihat `docs/email-setup.md`.

Aturan: satu pengajuan aktif per email; email yang sudah jadi anggota ditolak; yang *rejected* boleh mengajukan lagi.

Keamanan: browser tidak menulis tabel langsung. Semua tulis lewat RPC `security definer`; tabel dilindungi RLS
(hanya admin aktif yang bisa membaca); anon hanya boleh upload `re-registrations/<uuid>.jpg|png`.
Definisi: `supabase/migrations/20261011000000_re_registrations.sql`, teruji di `supabase/tests/`.

Data contoh (`db:seed`): 2 pending, 1 approved, 1 rejected — kodenya tercetak di output seed.

## Alur rekrutmen baru (masih dummy)
> Anggota hasil alur dummy ini **tidak bisa** membuat akun nyata — hanya anggota di Supabase (hasil registrasi ulang) yang bisa.

1. **Daftar** (`/daftar/`) → dapat kode `REG-…` → status *Menunggu Review*.
2. Admin **Approve** di Recruitment Management → *Pre-approved*.
3. Pendaftar buka **Cek Status**, scan QRIS, upload bukti → *Verifikasi Bayar*.
4. Admin klik **Verifikasi Bayar** → *Approved* + nomor anggota `FF-…` dibuat.
5. Anggota **Register** dengan email pendaftaran → **Login** → Akun Saya & Bayar Uang Kas.
6. Uang kas diverifikasi admin di menu **Uang Kas**.

Reset data dummy (bukan data Supabase): tombol **Reset data dummy** di sidebar admin (desktop), atau hapus key
`ff-membership-db-v3` di localStorage. Reset data Supabase lokal: `npm run db:reset && npm run db:seed`.

## Struktur
- `app/` — route (`/`, `/daftar`, `/daftar/berhasil`, `/cek-status`, `/login`, `/register`, `/akun`, `/akun/bayar`, `/admin/members`, `/admin/members/detail?id=`, `/admin/recruitment`, `/admin/recruitment/detail?id=`, `/registrasi-ulang`, `/admin/registrasi-ulang`)
- `components/views/` — isi tiap halaman; `components/layout/` — header, topbar, admin shell, auth guard; `components/ui/` — komponen design system
- `app/globals.css` — token warna & kelas komponen dari design (tema ikut device; override via `html[data-theme]`)
- `lib/types.ts` — model data; `lib/data/seed.ts` — data dummy rekrutmen
- `lib/data/re-registrations.ts`, `lib/data/members.ts` (anggota: sendiri & admin), `lib/data/dues.ts` (uang kas), `lib/data/proofs.ts` (bukti bayar) — repository Supabase; `lib/validation/password.ts` — aturan password; `lib/supabase/client.ts` — client browser
- `lib/data/store.ts` — repository dummy (hanya rekrutmen baru); `lib/auth.ts` — auth Supabase untuk semua peran
- `supabase/migrations/` — skema nyata; `supabase/tests/` — pgTAP; `scripts/seed-dev.mjs` — seed dev
- `supabase/schema.sql` — draft skema lengkap fase berikutnya (belum dipakai)

Halaman detail memakai query param (`?id=`) agar tetap kompatibel dengan static export saat data sudah dinamis.

## Deploy
Sama seperti `fritzyforce-nextjs`: `npm run deploy:workers` / `npm run deploy:pages` (Cloudflare), Vercel, atau Netlify (`netlify.toml`).

## Pengaturan sementara
- **Join Us (pendaftaran anggota baru) ditutup**: `RECRUITMENT_OPEN = false` di `lib/config.ts`. Tombol di homepage nonaktif dan
  `/daftar/` menampilkan pemberitahuan. Ubah ke `true` untuk membuka lagi.
- **QRIS** memakai satu gambar: `public/qris.jpg` (komponen `QrisImage`). Ganti file itu untuk memperbarui di semua halaman.
