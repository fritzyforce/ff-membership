# Panduan deploy: Supabase + Cloudflare (dua lingkungan)

Panduan ini dipakai **dua kali** dengan langkah yang sama, hanya nilainya berbeda:

| | **1. Pribadi (uji coba)** | **2. Live (produksi)** |
|---|---|---|
| Akun Cloudflare / Supabase | akun pribadi | akun **lain** (milik organisasi/klien) |
| Project Supabase | `ff-membership-staging` | `ff-membership-prod` (**terpisah**, jangan dipakai bareng) |
| Domain | `*.workers.dev` | domain sendiri (disarankan) |
| Email (Resend) | **domain terverifikasi** (boleh subdomain, mis. `mail-staging.domainmu.com`) → bisa kirim ke semua email | **domain terverifikasi** milik pihak live → bisa kirim ke semua email |
| Data | data uji, boleh dihapus | data nyata; backup & hati-hati |

Semua memakai paket gratis. Estimasi: 45–60 menit untuk lingkungan pertama, ±30 menit untuk yang kedua (karena sudah hafal).

Gambaran: aplikasi ini **static export** (tanpa server). Browser bicara langsung ke Supabase memakai *anon/publishable key*;
keamanan dijaga RLS + RPC di database (lihat README). Cloudflare hanya menyajikan file statis. Email approve registrasi ulang dikirim
oleh **Supabase Edge Function** (kunci Resend tidak boleh ada di browser).

```
Browser ──> Cloudflare (file statis)
   ├──────> Supabase (Auth + Postgres + Storage)
   └──────> Supabase Edge Function send-status-email ──> Resend ──> email pendaftar
Supabase Auth ──(SMTP)──> email konfirmasi akun & reset password
```

## Isi
- [Persiapan](#persiapan)
- [Nilai untuk lingkungan staging](#nilai-untuk-lingkungan-staging-sudah-ada)
- [Bagian A — Supabase](#bagian-a--supabase)
- [Bagian B — Kode di GitHub](#bagian-b--kode-di-github)
- [Bagian C — Cloudflare](#bagian-c--cloudflare)
- [Bagian D — Hubungkan URL ke Supabase](#bagian-d--hubungkan-url-ke-supabase)
- [Bagian E — Uji asap](#bagian-e--uji-asap-smoke-test)
- [Bagian F — Khusus lingkungan live](#bagian-f--khusus-lingkungan-live)
- [Pemecahan masalah](#pemecahan-masalah) · [Update rutin](#update-rutin)

---

## Persiapan

- Akun **GitHub**, **Cloudflare**, **Supabase**, dan **Resend** — untuk lingkungan live semuanya milik pihak live.
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
  **Jangan pernah** commit ke git atau menaruh `service_role` / *secret key* di Cloudflare atau kode.

---

## Nilai untuk lingkungan staging (sudah ada)

Situs staging sudah ter-deploy di Cloudflare: **https://ff-membership.fritzyforce-ofc.workers.dev** (Worker `ff-membership`).
Dari bundle situs itu terlihat project Supabase yang ditanam: `https://ayprjzduqshmwdujwzwb.supabase.co`
(project ref `ayprjzduqshmwdujwzwb` — **pastikan ini project staging yang Anda maksud**, bukan project lain).

Nilai yang dipakai di langkah-langkah di bawah untuk staging:

| Yang dibutuhkan | Nilai staging |
|---|---|
| Project ref | `ayprjzduqshmwdujwzwb` |
| Supabase **Site URL** (A4/D) | `https://ff-membership.fritzyforce-ofc.workers.dev` |
| Supabase **Redirect URLs** (D) | `https://ff-membership.fritzyforce-ofc.workers.dev/**` (+ `http://localhost:3000/**` untuk dev) |
| Secret Edge Function `SITE_URL` (A8) | `https://ff-membership.fritzyforce-ofc.workers.dev` |
| Secret `EMAIL_FROM` (A8) / sender SMTP (A6) | `Fritzy Force <noreply@<domain-staging-terverifikasi>>` — domain Resend belum ditentukan |
| Build variables Cloudflare (C1) | `NEXT_PUBLIC_SUPABASE_URL=https://ayprjzduqshmwdujwzwb.supabase.co`, `NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable key>` |

**Urutan kerja untuk staging** (langkah rinci ada di Bagian A–E; centang yang sudah Anda lakukan):

```bash
cd /Users/brian/projects/ff-membership
npx supabase login                                   # akun Supabase STAGING
npx supabase link --project-ref ayprjzduqshmwdujwzwb
npx supabase db push                                 # A3: semua migrasi

npx supabase secrets set --project-ref ayprjzduqshmwdujwzwb \
  RESEND_API_KEY=re_xxxxxxxx \
  EMAIL_FROM="Fritzy Force <noreply@<domain-staging-terverifikasi>>" \
  SITE_URL=https://ff-membership.fritzyforce-ofc.workers.dev
npx supabase functions deploy send-status-email --project-ref ayprjzduqshmwdujwzwb   # A8
```

- [ ] A3 migrasi diterapkan (Table Editor berisi `members`, `re_registrations`, `legacy_members`, dst.)
- [ ] A4 Auth: Confirm email **ON**, sign-up ON, password policy
- [ ] A5–A7 Resend: domain **Verified**, SMTP Auth, template email
- [ ] A8 secrets + deploy `send-status-email`
- [ ] A9 akun staf (`superadmin`, `admin_finance`, `admin`)
- [ ] D Site URL & Redirect URLs (tanpa ini tautan konfirmasi/reset gagal)
- [ ] E uji asap di URL staging

Bila build Cloudflare sebelumnya dibuat **sebelum** build variables diisi benar, jalankan *Retry build* agar `NEXT_PUBLIC_*` ikut tertanam.

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

⚠️ Hanya URL + publishable/anon key yang boleh dipakai di Cloudflare. **Jangan** pakai `service_role` / *secret key*.

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
| **URL Configuration** | diisi di [Bagian D](#bagian-d--hubungkan-url-ke-supabase) setelah URL Cloudflare diketahui |

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
# secrets disimpan di Supabase (bukan di git / Cloudflare)
npx supabase secrets set --project-ref <ref> \
  RESEND_API_KEY=re_xxxxxxxx \
  EMAIL_FROM="Fritzy Force <noreply@mail-staging.domainmu.com>" \
  SITE_URL=https://<url-situs-ini>

npx supabase functions deploy send-status-email --project-ref <ref>
```
- `EMAIL_FROM`: `Fritzy Force <noreply@<domain-terverifikasi>>` — staging dan live (alamat di domain yang *Verified* di Resend).
- `SITE_URL`: URL produksi lingkungan ini **tanpa** garis miring akhir (mis. `https://ff-membership.fritzyforce-ofc.workers.dev` atau
  `https://anggota.domainmu.com`). Dipakai untuk membuat link di email. Bila URL belum diketahui (belum deploy Cloudflare), jalankan
  `secrets set` lagi setelah [Bagian C](#bagian-c--cloudflare); fungsi tidak perlu di-deploy ulang untuk mengubah secrets.
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
git branch -M main  # branch utama bernama main (Cloudflare production mengikuti branch ini)
```
Buat repo **kosong & private** di GitHub, lalu:
```bash
git remote add origin git@github.com:<username>/ff-membership.git
git push -u origin main
```
`.gitignore` sudah mengecualikan `.env*`, `node_modules`, `out`, `.next`.

**Akses GitHub dari Cloudflare:** repo ada di organisasi GitHub (`fritzyforce`). Saat menghubungkan repo, Cloudflare memasang aplikasi
GitHub **Cloudflare Workers and Pages**; pada organisasi, aplikasi ini harus disetujui **owner** organisasi (member biasa hanya
bisa *request*). Pastikan juga akun Cloudflare terhubung ke akun GitHub yang punya akses ke repo. Untuk lingkungan live di akun
Cloudflare berbeda, repo harus bisa diakses akun GitHub yang dipakai di sana (transfer repo, repo kedua, atau collaborator).
Bila integrasi GitHub bermasalah, pakai **deploy lewat CLI** (C4) — tidak butuh GitHub sama sekali.

---

## Bagian C — Cloudflare

Aplikasi ini static export (`output: "export"` → folder `out/`). Konfigurasi Cloudflare sudah ada di [`wrangler.toml`](../wrangler.toml)
(Workers + Static Assets, `html_handling = "auto-trailing-slash"`, halaman 404). Header cache ada di `public/_headers`.

> Cloudflare cukup sering mengubah tampilan dashboard; nama menu di bawah bisa sedikit berbeda. Intinya sama: hubungkan repo,
> build command `npm run build`, deploy command `npx wrangler deploy`, dan isi **build variables**.

### C1. Hubungkan repo (otomatis tiap `git push`)
1. https://dash.cloudflare.com → **Workers & Pages** → **Create** → **Import a repository** (Git).
2. Pilih **GitHub**, izinkan aplikasi Cloudflare, pilih repo `fritzyforce/ff-membership` (butuh persetujuan owner organisasi bila diminta).
3. Isi pengaturan build:

   | Field | Nilai |
   |---|---|
   | Project / Worker name | `ff-membership` (**harus sama** dengan `name` di `wrangler.toml`) |
   | Production branch | `main` (atau `master` bila belum diganti) |
   | Build command | `npm run build` |
   | Deploy command | `npx wrangler deploy` |
   | Root directory | kosongkan (`/`) |

4. **Build variables** (Settings › Build › *Variables and secrets*; di formulir awal ada bagian *Advanced / Variables*):

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL dari A2 (**project lingkungan ini**) |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Publishable (atau anon) key dari A2 |
   | `NODE_VERSION` | `20` |

   ⚠️ Ini harus **build variables** (dipakai saat `npm run build`), **bukan** runtime variables Worker. Variabel `NEXT_PUBLIC_*`
   ditanam ke file statis saat build — kalau diubah, jalankan build ulang (*Retry build* / push commit baru).
5. **Save and Deploy**. Selesai → catat URL, mis. `https://ff-membership.fritzyforce-ofc.workers.dev`.

Setelah itu setiap `git push` ke production branch = deploy produksi; branch lain mendapat *preview build* (bila diaktifkan di Settings › Build).

### C2. Domain sendiri (live)
Worker → **Settings › Domains & Routes › Add › Custom domain** → `anggota.domainmu.com`. Bila DNS domain ada di Cloudflare, record dibuat
otomatis; bila di penyedia lain, ikuti instruksi CNAME. Setelah *Active*, URL produksi = domain itu; pakai di Bagian D dan `SITE_URL` (A8).

### C3. Matikan URL `workers.dev` (opsional, live)
Bila sudah memakai domain sendiri: Worker → **Settings › Domains & Routes** → nonaktifkan `workers.dev` agar situs hanya lewat domain resmi.
Hapus juga URL itu dari Redirect URLs Supabase (Bagian D).

### C4. Alternatif: deploy lewat CLI (tanpa integrasi GitHub)
Cocok bila akses GitHub organisasi belum beres, atau untuk deploy manual. Dari folder proyek:
```bash
npx wrangler login        # login ke akun Cloudflare lingkungan ini (browser)
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co \
NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable-key> \
npm run deploy:workers    # = npm run build && wrangler deploy
```
Variabel dikirim inline supaya tidak tercampur antara staging dan live (jangan simpan di file yang ikut git). Deploy ulang setiap ada
perubahan kode. Satu komputer, dua akun Cloudflare: `npx wrangler logout` lalu `login` lagi sebelum mengerjakan lingkungan lain, dan cek
`npx wrangler whoami`.

> Platform lain yang juga bisa menyajikan folder `out/`: **Cloudflare Pages** (`npm run deploy:pages`) dan **Netlify**
> (`netlify.toml` sudah ada). Pengaturan env var-nya sama.

---

## Bagian D — Hubungkan URL ke Supabase

Wajib, kalau tidak: tautan konfirmasi email & reset password gagal.

1. Supabase → **Authentication › URL Configuration**:
   - **Site URL**: URL produksi (domain sendiri bila ada, kalau tidak `https://ff-membership.fritzyforce-ofc.workers.dev`).
   - **Redirect URLs** (tambahkan):
     - `https://<url-produksi>/**`
     - URL preview build Cloudflare bila dipakai (mis. `https://*-ff-membership.fritzyforce-ofc.workers.dev/**`). Opsional.
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
- [ ] Simpan di password manager: Database password, API key Resend, akun Supabase/Cloudflare/GitHub/Resend, siapa pemiliknya.

---

## Pemecahan masalah

| Gejala | Penyebab & solusi |
|---|---|
| “Backend belum dikonfigurasi…” | Build variables Cloudflare belum diisi / salah nama / diisi sebagai runtime variable. Perbaiki lalu build ulang. |
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
| Halaman 404 di `/login` atau `/admin/…` | Build gagal / `out/` kosong. Lihat log build di Cloudflare; pastikan Build command `npm run build` dan `wrangler.toml` ada di root. Aplikasi memakai `trailingSlash: true` (URL berakhiran `/`). |
| Build gagal / nama Worker beda | Nama Worker di dashboard harus sama dengan `name` di `wrangler.toml` (`ff-membership`). |
| Deploy CLI memakai akun salah | `npx wrangler whoami`; `npx wrangler logout` lalu `login` ke akun yang benar. |
| 404 pada halaman detail | Halaman detail memakai query (`/admin/members/detail/?id=…`); jangan dibuka tanpa `?id=`. |
| Setelah ubah env, tampilan masih lama | `NEXT_PUBLIC_*` ditanam saat build → **build ulang** (Retry build / push commit baru). |
| `db push` gagal koneksi | Pakai Session pooler (A3). |
| `db push` / `functions deploy` menyasar project salah | Cek `npx supabase projects list` dan `supabase/.temp/project-ref`; `supabase link` ulang ke ref yang benar; gunakan `--project-ref` eksplisit. |

## Update rutin

- **Kode**: `git push` → Cloudflare build & deploy otomatis (per lingkungan/repo); atau `npm run deploy:workers` (C4).
- **Skema DB**: tambahkan file baru di `supabase/migrations/`, uji lokal (`npm run db:reset && npm run db:test`), lalu
  `npx supabase db push` **ke pribadi dulu**, uji, baru ke live. **Jangan mengedit migrasi yang sudah di-push**; buat migrasi baru.
- **Edge Function**: setelah mengubah `supabase/functions/send-status-email/`, jalankan `npx supabase functions deploy send-status-email --project-ref <ref>`
  untuk tiap lingkungan.
- **Reset data pribadi**: SQL Editor / Table Editor (hati-hati; tidak ada undo), atau buat project baru. **Jangan** pada live.
