# Panduan deploy preview: Vercel + Supabase (cloud)

Target: aplikasi tampil di URL `https://….vercel.app` dengan database Supabase **cloud** (bukan Docker lokal), untuk
review/uji bersama. Semua langkah memakai paket **gratis**. Estimasi: 30–45 menit.

Gambaran: aplikasi ini **static export** (tanpa server). Browser bicara langsung ke Supabase memakai *anon/publishable key*;
keamanan dijaga RLS + RPC di database (lihat README). Vercel hanya menyajikan file statis.

```
Browser ──> Vercel (file statis)
   └──────> Supabase cloud (Auth + Postgres + Storage)
```

## Yang perlu disiapkan
- Akun **GitHub** (disarankan), **Vercel** (login pakai GitHub), dan **Supabase**.
- Node 20+ dan folder proyek ini. CLI Supabase sudah ada di `devDependencies` → pakai `npx supabase …`.
- Proyek ini **belum menjadi repo git**; langkah 1 menyiapkannya.

---

## Bagian A — Supabase cloud

### A1. Buat project
1. https://supabase.com/dashboard → **New project**.
2. Name `ff-membership-preview`, **Region: Southeast Asia (Singapore)**, buat **Database password** yang kuat
   dan simpan di password manager (dipakai di A3).
3. Tunggu status *Healthy* (±2 menit).
4. Catat **Project ref** (potongan acak di URL dashboard: `…/project/<ref>`).

> Paket gratis: project yang tidak aktif ±1 minggu akan **di-pause** (tinggal di-*Restore* dari dashboard). Wajar untuk preview.

### A2. Ambil URL & key
Dashboard → **Project Settings › API Keys** (atau tombol *Connect*):
- **Project URL**: `https://<ref>.supabase.co`
- **Publishable key** (`sb_publishable_…`) — atau *anon key* lama (`eyJ…`); keduanya bisa dipakai oleh aplikasi ini.

⚠️ **Jangan** pakai/menyalin `service_role` / *secret key* ke Vercel atau kode. Hanya URL + publishable/anon key.

### A3. Terapkan migrasi database
Dari folder proyek:
```bash
npx supabase login                         # buka browser, izinkan
npx supabase link --project-ref <ref>      # minta Database password dari A1
npx supabase db push                       # terapkan semua file di supabase/migrations/
```
`db push` menampilkan daftar migrasi (`20261011…` s/d `20261016…`) — jawab **Y**. Ini sekaligus membuat tabel, RLS, fungsi RPC,
trigger akun, dan bucket privat `payment-proofs`.

Cek: Dashboard → **Table Editor** harus berisi `members`, `re_registrations`, `dues_payments`, `profiles`, dst.;
**Storage** berisi bucket `payment-proofs` (Private).

Jika `db push` gagal terhubung (error IPv6/“network unreachable”): Dashboard → *Connect* → **Session pooler** → salin connection
string, lalu `npx supabase db push --db-url "<string pooler>"`.

> **Jangan** menjalankan `npm run db:seed` ke cloud — script memang menolak host non-lokal. Data uji dibuat lewat aplikasi (A6).

### A4. Pengaturan Auth (wajib — tidak ikut terbawa dari `config.toml`)
Dashboard → **Authentication**:

| Menu | Setel |
|---|---|
| **Sign In / Providers › Email** | Enabled; **Confirm email = OFF** (sesuai keputusan saat ini) |
| **Sign In / Providers › Allow new users to sign up** | **ON** (pendaftaran akun anggota memakainya; trigger database yang membatasi) |
| **Policies / Password** | Minimum length **8**; Password requirements: **huruf kecil + besar + angka** (*Lowercase, uppercase letters and digits*) |
| **URL Configuration** | diisi di **C2** setelah URL Vercel diketahui |

Jangan `supabase config push`: akan menimpa Site URL cloud dengan `http://localhost:3000` dari `config.toml`.

### A5. Template email (opsional untuk preview)
Karena *Confirm email* OFF, yang terpakai hanya **Reset password**. Salin isi `supabase/templates/recovery.html` ke
**Authentication › Emails › Templates › Reset Password** (subjek bebas, mis. “Reset password Fritzy Force”).

⚠️ SMTP bawaan Supabase hanya mengirim ke **anggota tim organisasi Supabase** (±2 email/jam). Untuk preview itu cukup: *lupa
password* hanya berfungsi untuk email Anda sendiri. Pemakai lain butuh SMTP sendiri → [email-setup.md](email-setup.md).

### A6. Buat akun admin pertama
Sign-up publik tidak bisa membuat admin; email staf harus didaftarkan dulu (sekali pakai).
1. Dashboard → **SQL Editor** → jalankan (ganti email/nama):
   ```sql
   insert into public.account_provisioning (email, role, display_name)
   values ('emailanda@domain.com', 'superadmin', 'Nama Anda');   -- role: 'admin' | 'superadmin'
   ```
2. Dashboard → **Authentication › Users › Add user › Create new user**: email yang sama, password kuat
   (huruf besar+kecil+angka, ≥ 8), centang **Auto Confirm User**.
3. Cek: tabel `profiles` kini punya baris dengan role tersebut, dan `account_provisioning` kosong lagi (sekali pakai).

---

## Bagian B — Kode ke GitHub

```bash
cd /Users/brian/projects/ff-membership
git init -b main
git add .
git status          # PASTIKAN tidak ada .env.local / .env yang ikut (harus tidak ada)
git commit -m "Initial commit"
```
Buat repo **kosong & private** di GitHub (mis. `ff-membership`), lalu:
```bash
git remote add origin git@github.com:<username>/ff-membership.git
git push -u origin main
```
`.gitignore` sudah mengecualikan `.env*` (kecuali `.env.example`), `node_modules`, `out`, `.next`.

---

## Bagian C — Vercel

### C1. Import project
1. https://vercel.com/new → **Import** repo `ff-membership` (izinkan akses GitHub bila diminta).
2. **Framework Preset**: *Next.js* (terdeteksi otomatis; `vercel.json` sudah ada). **Jangan** ubah Build/Output command —
   Vercel otomatis menyajikan hasil `output: "export"`.
3. **Environment Variables** — tambahkan (centang **Production, Preview, dan Development**):

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL dari A2 |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Publishable (atau anon) key dari A2 |

   Hanya dua ini. Variabel `NEXT_PUBLIC_*` **ditanam saat build** — kalau diubah kemudian, harus **Redeploy**.
4. Klik **Deploy**. Selesai → catat URL, mis. `https://ff-membership.vercel.app` (**URL produksi stabil**).

Setelah itu: setiap `git push` ke `main` = deploy produksi; push ke branch/PR lain = **preview deployment** dengan URL sendiri.

*Alternatif tanpa GitHub:* `npx vercel` (login, jawab prompt, isi env di Project Settings), lalu `npx vercel --prod`.

### C2. Daftarkan URL ke Supabase (wajib, kalau tidak: tautan reset password gagal)
Supabase → **Authentication › URL Configuration**:
- **Site URL**: `https://ff-membership.vercel.app` (URL produksi dari C1).
- **Redirect URLs** (tambahkan):
  - `https://ff-membership.vercel.app/**`
  - `https://ff-membership-*-<scope-slug>.vercel.app/**` — untuk preview deployment
    (`<scope-slug>` = nama akun/tim Vercel Anda; lihat pola URL preview di dashboard Vercel).
  - `http://localhost:3000/**` (opsional, untuk dev lokal).

### C3. Akses preview untuk orang lain
Vercel menyalakan **Deployment Protection** (login Vercel) pada preview. Agar reviewer bisa membuka:
Project → **Settings › Deployment Protection** → matikan *Vercel Authentication* untuk Preview, **atau** buat
*Shareable Link* per deployment. Pilih sesuai kebutuhan privasi.

---

## Bagian D — Uji asap (smoke test)

Buka URL Vercel, lalu:
1. Homepage tampil; tombol **Registrasi Ulang** aktif, **Join Us Now!** nonaktif.
2. `/login/` dengan akun admin dari A6 → masuk ke `/admin/members/`.
3. Logout. Buka `/registrasi-ulang/` → isi form + unggah bukti (JPG/PNG ≤ 5MB) → dapat kode `RU-XXXX-XXXX`.
4. Login admin → **Registrasi Ulang** → buka detail → bukti tampil → **Approve** → muncul nomor `FF-001`.
5. `/cek-status/` pakai kode tadi → *Approved* → **Registrasi Akun** (email terisi otomatis) → buat password → masuk `/akun/`.
6. `/akun/bayar/` → pilih jumlah bulan, unggah bukti → admin **Uang Kas** → Approve.
7. Mode gelap/terang mengikuti perangkat.

## Pemecahan masalah

| Gejala | Penyebab & solusi |
|---|---|
| “Backend belum dikonfigurasi…” | Env var Vercel belum diisi / salah nama. Perbaiki lalu **Redeploy** (tanpa cache). |
| `Invalid API key` | Key salah salin (spasi/terpotong) atau memakai key milik project lain. |
| Login: “Email logins are disabled” | Providers › Email belum **Enabled** (A4). |
| Daftar akun: “Database error saving new user” / email tidak memenuhi syarat | Email belum jadi anggota *approved* (atau staf belum didaftarkan di `account_provisioning`) — perilaku yang benar. |
| Password ditolak padahal 8 karakter | Wajib ada huruf besar, kecil, **dan** angka. |
| Tautan reset password membawa ke `localhost` / ditolak | **Site URL / Redirect URLs** (C2) belum benar. |
| Email reset tidak datang | SMTP bawaan hanya untuk anggota tim Supabase → [email-setup.md](email-setup.md). |
| Unggah bukti gagal | Bukan JPG/PNG atau > 5 MB; atau migrasi (bucket) belum diterapkan (A3). |
| `ERR_TOO_MANY_REDIRECTS` / halaman berputar | `vercel.json` memakai `cleanUrls: true` sementara `next.config.mjs` memakai `trailingSlash: true`. Hapus baris `"cleanUrls": true` dari `vercel.json` lalu push. (Konfigurasi ini sama dengan proyek `fritzyforce-nextjs`; belum diuji di Vercel untuk proyek ini.) |
| 404 pada halaman detail | Halaman detail memakai query (`/admin/members/detail/?id=…`); jangan dibuka tanpa `?id=`. |
| Setelah ubah env, tampilan masih lama | `NEXT_PUBLIC_*` ditanam saat build → **Redeploy**. |
| `db push` gagal koneksi | Pakai Session pooler (A3). |

## Update rutin
- **Kode**: `git push` → Vercel deploy otomatis.
- **Skema DB**: tambahkan file baru di `supabase/migrations/`, uji lokal (`npm run db:reset && npm run db:test`), lalu
  `npx supabase db push`. **Jangan mengedit migrasi yang sudah di-push**; buat migrasi baru.
- **Reset data preview**: Dashboard → Table Editor / SQL Editor (hati-hati; tidak ada undo). Untuk mulai bersih total, buat project baru.

## Saat naik ke produksi sungguhan
Pakai project Supabase **terpisah** dari preview, pasang SMTP + domain (`docs/email-setup.md`), pertimbangkan Supabase Pro
(backup, tanpa auto-pause), dan aktifkan CAPTCHA (Turnstile) pada form publik. Checklist lengkap ada di README.
