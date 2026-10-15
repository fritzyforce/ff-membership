# Panduan deploy: Supabase + Vercel (dua lingkungan)

Panduan ini dipakai **dua kali** dengan langkah yang sama, hanya nilainya berbeda:

| | **1. Pribadi (uji coba)** | **2. Live (produksi)** |
|---|---|---|
| Akun Vercel / Supabase | akun pribadi | akun **lain** (milik organisasi/klien) |
| Project Supabase | `ff-membership-staging` | `ff-membership-prod` (**terpisah**, jangan dipakai bareng) |
| Domain | `*.vercel.app` | domain sendiri (disarankan) |
| Email (Resend) | **domain terverifikasi** (boleh subdomain, mis. `mail-staging.domainmu.com`) → bisa kirim ke semua email | **domain terverifikasi** milik pihak live → bisa kirim ke semua email |
| Data | data uji, boleh dihapus | data nyata; backup & hati-hati |

Semua memakai paket gratis. Estimasi: 45–60 menit untuk lingkungan pertama, ±30 menit untuk yang kedua (karena sudah hafal).

Gambaran: aplikasi ini **static export** (tanpa server). Browser bicara langsung ke Supabase memakai *anon/publishable key*;
keamanan dijaga RLS + RPC di database (lihat README). Vercel hanya menyajikan file statis. Email approve registrasi ulang dikirim
oleh **Supabase Edge Function** (kunci Resend tidak boleh ada di browser).

```
Browser ──> Vercel (file statis)
   ├──────> Supabase (Auth + Postgres + Storage)
   └──────> Supabase Edge Function send-status-email ──> Resend ──> email pendaftar
Supabase Auth ──(SMTP)──> email konfirmasi akun & reset password
```

## Isi
- [Persiapan](#persiapan)
- [Bagian A — Supabase](#bagian-a--supabase)
- [Bagian B — Kode di GitHub](#bagian-b--kode-di-github)
- [Bagian C — Vercel](#bagian-c--vercel)
- [Bagian D — Hubungkan URL ke Supabase](#bagian-d--hubungkan-url-ke-supabase)
- [Bagian E — Uji asap](#bagian-e--uji-asap-smoke-test)
- [Bagian F — Khusus lingkungan live](#bagian-f--khusus-lingkungan-live)
- [Pemecahan masalah](#pemecahan-masalah) · [Update rutin](#update-rutin)

---

## Persiapan

- Akun **GitHub**, **Vercel** (login pakai GitHub), **Supabase**, dan **Resend** — untuk lingkungan live semuanya milik pihak live.
- **Satu domain** yang DNS-nya bisa Anda atur, untuk verifikasi Resend — **juga untuk staging**. Resend hanya mengizinkan kirim ke alamat
  sembarang bila domain pengirim terverifikasi. Tanpa domain sendiri, staging hanya bisa mengirim ke email pemilik akun Resend.
  Bila sudah punya domain, pakai **subdomain** khusus staging (mis. `mail-staging.domainmu.com`); kalau belum, beli domain murah.
- Node 20+ dan folder proyek ini. CLI Supabase sudah ada di `devDependencies` → pakai `npx supabase …`.
- Dua akun Supabase berbeda di satu komputer: CLI hanya login ke **satu akun sekaligus**. Sebelum mengerjakan lingkungan lain:
  ```bash
  npx supabase logout
  npx supabase login            # login ke akun lingkungan yang akan dikerjakan
  ```
  (alternatif tanpa login interaktif: `export SUPABASE_ACCESS_TOKEN=sbp_…` dari Dashboard › Account › Access Tokens.)
  Setiap lingkungan di-`link` ke project-nya sendiri (`npx supabase link --project-ref <ref>`), jadi **selalu cek ref** sebelum
  `db push` / `functions deploy` agar tidak menimpa project yang salah.
- Siapkan **catatan** (password manager) per lingkungan: Database password, Project ref, URL, publishable key, API key Resend.
  **Jangan pernah** commit ke git atau menaruh `service_role` / *secret key* di Vercel atau kode.

---

## Bagian A — Supabase

### A1. Buat project
1. https://supabase.com/dashboard → **New project**.
2. Name (`ff-membership-staging` / `ff-membership-prod`), **Region: Southeast Asia (Singapore)**, buat **Database password** yang kuat
   dan simpan (dipakai di A3).
3. Tunggu status *Healthy* (±2 menit).
4. Catat **Project ref** (potongan acak di URL dashboard: `…/project/<ref>`).

> Paket gratis: project yang tidak aktif ±1 minggu akan **di-pause**. Wajar untuk uji coba; untuk live pertimbangkan Pro (lihat Bagian F).

### A2. Ambil URL & key
Dashboard → **Project Settings › API Keys** (atau tombol *Connect*):
- **Project URL**: `https://<ref>.supabase.co`
- **Publishable key** (`sb_publishable_…`) — atau *anon key* lama (`eyJ…`); keduanya bisa dipakai aplikasi ini.

⚠️ Hanya URL + publishable/anon key yang boleh dipakai di Vercel. **Jangan** pakai `service_role` / *secret key*.

### A3. Terapkan migrasi database
Dari folder proyek (pastikan CLI login ke akun yang benar):
```bash
npx supabase link --project-ref <ref>      # minta Database password dari A1
npx supabase db push                       # terapkan SEMUA file di supabase/migrations/
```
`db push` menampilkan daftar migrasi (`20261011…` dan seterusnya) — jawab **Y**. Ini sekaligus membuat tabel, RLS, fungsi RPC,
trigger akun, role (`admin`, `admin_finance`, `superadmin`), tabel nomor anggota lama, dan bucket privat `payment-proofs`.

Cek: Dashboard → **Table Editor** berisi `members`, `re_registrations`, `legacy_members`, `dues_payments`, `profiles`, dst.;
**Storage** berisi bucket `payment-proofs` (Private).

Jika `db push` gagal terhubung (error IPv6 / “network unreachable”): Dashboard → *Connect* → **Session pooler** → salin connection
string, lalu `npx supabase db push --db-url "<string pooler>"`.

> **Jangan** menjalankan `npm run db:seed` ke cloud — script memang menolak host non-lokal. Data uji dibuat lewat aplikasi (A9 & Bagian E).

### A4. Pengaturan Auth (wajib — tidak ikut terbawa dari `config.toml`)
Dashboard → **Authentication**:

| Menu | Setel |
|---|---|
| **Sign In / Providers › Email** | Enabled; **Confirm email = ON** (akun baru wajib konfirmasi email sebelum bisa login) |
| **Sign In / Providers › Allow new users to sign up** | **ON** (pendaftaran akun anggota memakainya; trigger database yang membatasi siapa yang boleh) |
| **Policies / Password** | Minimum length **8**; Password requirements: **huruf kecil + besar + angka** (*Lowercase, uppercase letters and digits*) |
| **URL Configuration** | diisi di [Bagian D](#bagian-d--hubungkan-url-ke-supabase) setelah URL Vercel diketahui |

> Jangan `supabase config push`: akan menimpa Site URL cloud dengan `http://localhost:3000` dari `config.toml`.

### A5. Resend: akun, API key, (domain)
Email dikirim lewat Resend (gratis 3.000 email/bulan). Rinci & alasannya: [email-setup.md](email-setup.md).

1. https://resend.com → daftar (akun lingkungan yang bersangkutan).
2. **API Keys** → buat key khusus pengiriman. Simpan di password manager.
3. **Domain** (wajib di kedua lingkungan, supaya bisa mengirim ke semua email):
   - Resend → **Domains → Add Domain** → masukkan domain/subdomain pengirim:
     - **Staging**: mis. `mail-staging.domainmu.com` (subdomain dari domain yang Anda punya).
     - **Live**: domain milik pihak live, mis. `domainmu.com` atau `mail.domainmu.com`.
   - Pasang record DNS yang diminta (SPF, DKIM) di pengelola DNS domain, tunggu status **Verified** (bisa beberapa menit–jam).
   - Pengirim yang dipakai: `noreply@<domain-terverifikasi>`.
   - Paket gratis Resend membatasi jumlah domain per akun (saat ini 1; cek https://resend.com/pricing). Staging (akun pribadi) dan
     live (akun lain) memakai **akun Resend masing-masing**, jadi tiap akun cukup 1 domain.

> Selama domain staging belum *Verified*, Resend menolak pengiriman ke selain email pemilik akun (error 403 `validation_error`).
> Jangan lanjut ke uji email sebelum statusnya Verified.

### A6. SMTP untuk email Auth (konfirmasi akun & reset password)
SMTP bawaan Supabase hanya mengirim ke anggota tim organisasi Supabase (±2 email/jam) — **tidak cukup** karena *Confirm email* ON.
Dashboard → **Authentication › Emails › SMTP Settings** → aktifkan **Custom SMTP**:

| Field | Nilai |
|---|---|
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | API key Resend (A5) |
| Sender email | `noreply@<domain-terverifikasi>` (staging dan live) |
| Sender name | `Fritzy Force` |

Lalu **Authentication › Rate Limits** → atur batas email per jam sesuai kebutuhan (default setelah SMTP sendiri: 30/jam).


### A7. Template email Auth
Dashboard → **Authentication › Emails › Templates**:
- **Confirm signup** → salin isi `supabase/templates/confirmation.html` ; subjek: `Konfirmasi email akun Fritzy Force`
- **Reset Password** → salin isi `supabase/templates/recovery.html` ; subjek: `Reset password akun Fritzy Force`

### A8. Edge Function: email approve registrasi ulang
Fungsi `send-status-email` mengirim email saat admin Approve (status disetujui + tombol **Cek Status Registrasi** + link Buat Akun).

```bash
# secrets disimpan di Supabase (bukan di git / Vercel)
npx supabase secrets set --project-ref <ref> \
  RESEND_API_KEY=re_xxxxxxxx \
  EMAIL_FROM="Fritzy Force <noreply@mail-staging.domainmu.com>" \
  SITE_URL=https://<url-situs-ini>

npx supabase functions deploy send-status-email --project-ref <ref>
```
- `EMAIL_FROM`: `Fritzy Force <noreply@<domain-terverifikasi>>` — staging dan live (alamat di domain yang *Verified* di Resend).
- `SITE_URL`: URL produksi lingkungan ini **tanpa** garis miring akhir (mis. `https://ff-membership.vercel.app` atau
  `https://anggota.domainmu.com`). Dipakai untuk membuat link di email. Bila URL belum diketahui (belum deploy Vercel), jalankan
  `secrets set` lagi setelah [Bagian C](#bagian-c--vercel); fungsi tidak perlu di-deploy ulang untuk mengubah secrets.
- Cek: Dashboard → **Edge Functions** harus menampilkan `send-status-email` (Active).

Sebelum fungsi ini jalan, Approve tetap berhasil; admin hanya melihat peringatan "email gagal dikirim" dan bisa memakai tombol
*Kirim ulang email* di detail registrasi.

### A9. Buat akun staf pertama
Sign-up publik tidak bisa membuat akun staf; email staf harus didaftarkan dulu (sekali pakai). Role yang tersedia:

| Role | Hak |
|---|---|
| `superadmin` | semuanya (termasuk approve/reject & kelola role akun) |
| `admin_finance` | lihat semua + kelola anggota + **approve/reject uang kas & registrasi ulang** |
| `admin` | lihat semua + kelola anggota; **tidak** bisa approve/reject |

1. Dashboard → **SQL Editor** → jalankan (ganti email/nama; ulangi per orang):
   ```sql
   insert into public.account_provisioning (email, role, display_name) values
     ('superadmin@domainmu.com', 'superadmin',    'Nama Superadmin'),
     ('finance@domainmu.com',    'admin_finance', 'Nama Finance'),
     ('admin@domainmu.com',      'admin',         'Nama Admin');
   ```
2. Dashboard → **Authentication › Users › Add user › Create new user** untuk **tiap** email di atas: password kuat
   (huruf besar+kecil+angka, ≥ 8), centang **Auto Confirm User**.
3. Cek: tabel `profiles` punya baris dengan role masing-masing, dan `account_provisioning` kosong lagi (sekali pakai).

> Email staf **tidak harus** email sungguhan karena memakai *Auto Confirm* (tidak ada email yang dikirim). Pakai email
> sungguhan untuk akun yang akan dipakai login nyata/reset password.

---

## Bagian B — Kode di GitHub

Repo git sudah ada di folder proyek. Pastikan bersih dan terkirim ke GitHub:
```bash
git status          # PASTIKAN tidak ada .env.local / supabase/functions/.env yang ikut (harus tidak ada)
git branch -M main  # branch utama bernama main (Vercel production mengikuti branch ini)
```
Buat repo **kosong & private** di GitHub, lalu:
```bash
git remote add origin git@github.com:<username>/ff-membership.git
git push -u origin main
```
`.gitignore` sudah mengecualikan `.env*`, `node_modules`, `out`, `.next`.

**Lingkungan live di akun Vercel berbeda:** Vercel hanya bisa meng-import repo yang akun GitHub-nya terhubung ke akun Vercel itu.
Pilih salah satu:
- Repo dipindah/dimiliki akun GitHub pihak live (*Settings › Transfer ownership*), atau
- Buat repo kedua (fork/mirror) di akun GitHub pihak live, atau
- Undang akun GitHub pihak live sebagai collaborator dan hubungkan ke akun Vercel mereka.

---

## Bagian C — Vercel

### C1. Import project
1. https://vercel.com/new (login ke akun Vercel lingkungan ini) → **Import** repo `ff-membership`.
2. **Framework Preset**: *Next.js* (terdeteksi otomatis; `vercel.json` sudah ada). **Jangan** ubah Build/Output command —
   Vercel otomatis menyajikan hasil `output: "export"`.
3. **Environment Variables** — tambahkan (centang **Production, Preview, dan Development**):

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL dari A2 (**project lingkungan ini**) |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Publishable (atau anon) key dari A2 |

   Hanya dua ini. Variabel `NEXT_PUBLIC_*` **ditanam saat build** — kalau diubah kemudian, harus **Redeploy**.
4. Klik **Deploy**. Selesai → catat URL produksi, mis. `https://ff-membership.vercel.app`.

Setelah itu: setiap `git push` ke `main` = deploy produksi; push ke branch/PR lain = **preview deployment** dengan URL sendiri.

*Alternatif tanpa GitHub:* `npx vercel` (login, jawab prompt, isi env di Project Settings), lalu `npx vercel --prod`.

### C2. Domain sendiri (live)
Vercel → Project → **Settings › Domains** → tambahkan `anggota.domainmu.com` → ikuti instruksi DNS (CNAME/A) → tunggu *Valid*.
Setelah ini **URL produksi = domain itu**; pakai di Bagian D dan `SITE_URL` (A8).

### C3. Akses preview untuk orang lain
Vercel menyalakan **Deployment Protection** (login Vercel) pada preview. Agar reviewer bisa membuka:
Project → **Settings › Deployment Protection** → matikan *Vercel Authentication* untuk Preview, **atau** buat
*Shareable Link* per deployment. Pilih sesuai kebutuhan privasi.

---

## Bagian D — Hubungkan URL ke Supabase

Wajib, kalau tidak: tautan konfirmasi email & reset password gagal.

1. Supabase → **Authentication › URL Configuration**:
   - **Site URL**: URL produksi (domain sendiri bila ada, kalau tidak `https://ff-membership.vercel.app`).
   - **Redirect URLs** (tambahkan):
     - `https://<url-produksi>/**`
     - `https://ff-membership-*-<scope-slug>.vercel.app/**` — untuk preview deployment
       (`<scope-slug>` = nama akun/tim Vercel; lihat pola URL preview di dashboard Vercel). Opsional.
     - `http://localhost:3000/**` — hanya untuk lingkungan pribadi/dev, **jangan** di live.
2. Pastikan secret `SITE_URL` di Edge Function (A8) sama dengan URL produksi; kalau belum/salah:
   ```bash
   npx supabase secrets set --project-ref <ref> SITE_URL=https://<url-produksi>
   ```

---

## Bagian E — Uji asap (smoke test)

Buka URL produksi, lalu:
1. Homepage tampil; tombol **Registrasi Ulang** aktif, **Join Us Now!** nonaktif.
2. `/login/` dengan akun `admin_finance` atau `superadmin` dari A9 → masuk ke `/admin/members/`.
3. Menu **Nomor Anggota Lama** → **Tambah Nomor** → tempel beberapa nomor uji (mis. `TEST-001`, `TEST-002`) → tabel terisi.
4. Logout. Buka `/registrasi-ulang/` → isi form (nomor lama `TEST-001`, minimal satu sosmed, email yang bisa menerima email — lihat
   semua email boleh karena domain sudah Verified) + unggah bukti (JPG/PNG ≤ 5MB) → dapat kode `RU-XXXX-XXXX`.
5. Login admin finance → **Registrasi Ulang** → detail → bukti tampil → **Approve** → muncul nomor `FF-001` dan pesan
   "Email pemberitahuan terkirim". Cek inbox: email berisi tombol **Cek Status Registrasi**.
   Nomor `TEST-001` di menu *Nomor Anggota Lama* kini berstatus **Sudah**.
6. Login sebagai `admin` biasa → detail registrasi pending tidak punya tombol Approve/Reject (hanya catatan "Admin Finance").
7. Klik tombol di email → `/cek-status/?kode=…` → *Approved* → **Registrasi Akun** (email terisi otomatis) → buat password →
   muncul "Cek Email Kamu" → buka email konfirmasi → klik tautan → masuk ke `/akun/`.
8. `/akun/bayar/` → pilih jumlah bulan, unggah bukti → admin finance **Uang Kas** → Approve.
9. Mode gelap/terang mengikuti perangkat.

Hapus data uji (nomor `TEST-…`, anggota/registrasi uji) sebelum dipakai nyata, terutama di lingkungan live (lihat Bagian F).

---

## Bagian F — Khusus lingkungan live

Ulangi Bagian A–E dengan akun & project **baru**, lalu:

- [ ] Project Supabase **baru dan terpisah** dari lingkungan pribadi; Database password & key berbeda. `supabase link` ke ref yang baru.
- [ ] Domain Resend milik pihak live **terverifikasi** di akun Resend live; `EMAIL_FROM` dan sender SMTP memakai alamat di domain itu (bukan domain staging).
- [ ] `SITE_URL`, Site URL Supabase, dan Redirect URLs memakai domain live; **hapus** `http://localhost:3000/**`.
- [ ] Akun staf asli dibuat lewat A9 dengan password kuat (ganti semua password uji); tidak ada akun `*.test`.
- [ ] **Isi daftar nomor anggota lama yang sebenarnya** lewat menu *Nomor Anggota Lama › Tambah Nomor* (tempel banyak sekaligus,
      satu nomor per baris, maks. 5.000 per kali). Ini wajib sebelum anggota lama bisa registrasi ulang.
- [ ] Bersihkan data uji: nomor `TEST-…` dan anggota/registrasi uji (SQL Editor, hati-hati).
- [ ] Rate limit email (Authentication › Rate Limits) sesuai perkiraan jumlah pendaftar.
- [ ] Pertimbangkan **CAPTCHA (Cloudflare Turnstile)** pada form publik — pengecekan nomor anggota lama bisa dipanggil publik, jadi
      nomor secara teori bisa ditebak satu per satu. Supabase: Authentication › Attack Protection.
- [ ] Pertimbangkan **Supabase Pro** (backup harian, tanpa auto-pause) dan aktifkan *Point-in-time recovery* bila perlu.
- [ ] Jangan jalankan `db:seed` atau `db:reset` terhadap live (seed menolak host non-lokal).
- [ ] Simpan di password manager: Database password, API key Resend, akun Supabase/Vercel/GitHub/Resend, siapa pemiliknya.

---

## Pemecahan masalah

| Gejala | Penyebab & solusi |
|---|---|
| “Backend belum dikonfigurasi…” | Env var Vercel belum diisi / salah nama. Perbaiki lalu **Redeploy** (tanpa cache). |
| `Invalid API key` | Key salah salin (spasi/terpotong) atau memakai key milik project lain (lingkungan tertukar). |
| Login: “Email logins are disabled” | Providers › Email belum **Enabled** (A4). |
| Daftar akun: “Database error saving new user” / “tidak bisa dipakai membuat akun” | Email belum jadi anggota *approved*, atau sudah punya akun, atau staf belum didaftarkan di `account_provisioning` — perilaku yang benar. |
| Setelah daftar akun, email konfirmasi tidak datang | SMTP belum dipasang (A6) / domain Resend belum *Verified* / sender bukan di domain terverifikasi / cek folder spam / kena rate limit. |
| Login: “Email belum dikonfirmasi” | Klik tautan di email konfirmasi, atau pakai tombol *Kirim ulang email konfirmasi* di halaman login. |
| Tautan konfirmasi/reset membawa ke `localhost` atau ditolak | **Site URL / Redirect URLs** (Bagian D) belum benar. |
| Approve berhasil tapi “email ke pendaftar gagal dikirim” | Fungsi belum di-deploy, secrets belum diisi (A8), atau Resend menolak (domain belum *Verified* — error 403 hanya boleh ke email pemilik akun; atau `EMAIL_FROM` bukan di domain terverifikasi). Lihat Dashboard → Edge Functions → **Logs**. Setelah diperbaiki, pakai tombol *Kirim ulang email*. |
| Link di email membawa ke URL salah | `SITE_URL` di secrets Edge Function salah (A8) → `secrets set` ulang. |
| Tombol Approve/Reject tidak muncul | Akun login berperan `admin`. Hanya `admin_finance` / `superadmin`. Ubah role lewat detail anggota (superadmin › *Ubah Role Akun*). |
| Form registrasi ulang: “Nomor anggota lama tidak ditemukan” | Nomor belum ada di daftar (menu *Nomor Anggota Lama*), atau salah ketik. |
| Password ditolak padahal 8 karakter | Wajib ada huruf besar, kecil, **dan** angka. |
| Unggah bukti gagal | Bukan JPG/PNG atau > 5 MB; atau migrasi (bucket) belum diterapkan (A3). |
| `ERR_TOO_MANY_REDIRECTS` / halaman berputar | `vercel.json` memakai `cleanUrls: true` sementara `next.config.mjs` memakai `trailingSlash: true`. Hapus baris `"cleanUrls": true` dari `vercel.json` lalu push. (Belum diuji di Vercel untuk proyek ini.) |
| 404 pada halaman detail | Halaman detail memakai query (`/admin/members/detail/?id=…`); jangan dibuka tanpa `?id=`. |
| Setelah ubah env, tampilan masih lama | `NEXT_PUBLIC_*` ditanam saat build → **Redeploy**. |
| `db push` gagal koneksi | Pakai Session pooler (A3). |
| `db push` / `functions deploy` menyasar project salah | Cek `npx supabase projects list` dan `supabase/.temp/project-ref`; `supabase link` ulang ke ref yang benar; gunakan `--project-ref` eksplisit. |

## Update rutin

- **Kode**: `git push` → Vercel deploy otomatis (per lingkungan/repo).
- **Skema DB**: tambahkan file baru di `supabase/migrations/`, uji lokal (`npm run db:reset && npm run db:test`), lalu
  `npx supabase db push` **ke pribadi dulu**, uji, baru ke live. **Jangan mengedit migrasi yang sudah di-push**; buat migrasi baru.
- **Edge Function**: setelah mengubah `supabase/functions/send-status-email/`, jalankan `npx supabase functions deploy send-status-email --project-ref <ref>`
  untuk tiap lingkungan.
- **Reset data pribadi**: SQL Editor / Table Editor (hati-hati; tidak ada undo), atau buat project baru. **Jangan** pada live.
