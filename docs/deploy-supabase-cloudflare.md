# Panduan deploy dari nol: Supabase + Resend + domain cPanel

Panduan ini **berdiri sendiri** dan ditulis untuk kondisi: **akun Supabase dan Resend baru**, domain di **cPanel** (`membership.fritzyforce.my.id`), dan situs di **Cloudflare atau cPanel** (pilih di Langkah 9).
Lokasi file ini di repo: `docs/deploy-supabase-cloudflare.md`.

> Dashboard Supabase/Resend/Cloudflare/cPanel sering berganti tampilan. Bila nama menu sedikit berbeda, cari menu yang fungsinya sama.

## Gambaran

```
Browser ──> hosting statis (Cloudflare Workers ATAU cPanel) di https://membership.fritzyforce.my.id
   ├──────> Supabase (Auth + Postgres + Storage)
   └──────> Supabase Edge Function "send-status-email" ──> Resend ──> email "registrasi ulang disetujui"
Supabase Auth ──(SMTP Resend)──> email reset password & atur password staf
```

Aplikasi ini **static export** (tanpa server). Browser bicara langsung ke Supabase dengan *publishable/anon key*; keamanan dijaga
RLS + RPC di database. Kunci Resend hanya ada di server (secrets Edge Function), **tidak pernah** di browser/Cloudflare.

## Yang harus disiapkan dulu

| Kebutuhan | Catatan |
|---|---|
| Akun **Supabase** baru | https://supabase.com (login GitHub/email) |
| Akun **Resend** baru | https://resend.com |
| **Domain** `membership.fritzyforce.my.id` | Sudah ditambahkan di cPanel. Dipakai untuk **situs** dan **pengirim email Resend**. Pengelola DNS-nya = cPanel (Zone Editor), kecuali Anda memindahkan nameserver ke Cloudflare. |
| Akun **Cloudflare** + repo GitHub terhubung | Hanya bila situs dihosting di Cloudflare (Langkah 9, opsi A). Situs staging sementara: `https://ff-membership.fritzyforce-ofc.workers.dev` |
| Komputer dengan **Node 20+** dan folder proyek | CLI Supabase sudah ada di proyek → pakai `npx supabase …` |

Catat di password manager (jangan di git/chat): **Database password**, **Project ref**, **Resend API key**.

URL situs yang dipakai di seluruh panduan (ganti bila memakai domain sendiri):

```
SITE_URL = https://membership.fritzyforce.my.id
```

(Selama domain belum aktif, `https://ff-membership.fritzyforce-ofc.workers.dev` masih bisa dipakai sementara; ganti ke domain utama setelah Langkah 9.)

---

## Langkah 1 — Buat project Supabase

1. https://supabase.com/dashboard → **New project**.
2. Name `ff-membership`, **Region: Southeast Asia (Singapore)**, buat **Database password** yang kuat (simpan!).
3. Tunggu status *Healthy* (±2 menit).
4. Catat **Project ref**: potongan acak di URL dashboard `…/project/<ref>`.

> Paket gratis: project tidak aktif ±1 minggu di-*pause* (tinggal *Restore*). Untuk produksi sungguhan pertimbangkan Pro.

## Langkah 2 — Ambil URL dan key

Dashboard → **Project Settings › API Keys** (atau tombol *Connect*):

- **Project URL**: `https://<ref>.supabase.co`
- **Publishable key** (`sb_publishable_…`) **atau** *anon key* lama (`eyJ…`) — salah satu, salin lewat tombol *copy*.

⚠️ Jangan pernah memakai `service_role` / *secret key* di Cloudflare atau kode. Hanya URL + publishable/anon key.

## Langkah 3 — Pasang database (migrasi)

Dari folder proyek, di terminal:

```bash
cd /Users/brian/projects/ff-membership
npx supabase login                                   # login ke akun Supabase BARU (browser)
npx supabase link --project-ref <ref>                # minta Database password dari Langkah 1
npx supabase db push                                 # terapkan SEMUA file di supabase/migrations/
```

`db push` menampilkan daftar migrasi (`20261011…` s/d `20261022…`, bertambah bila ada migrasi baru) → jawab **Y**.
Ini membuat tabel, RLS, fungsi RPC, trigger akun, role (`admin`, `admin_finance`, `superadmin`), tabel nomor anggota lama,
pencatatan uang kas, dan bucket privat `payment-proofs`.

Cek: Dashboard → **Table Editor** berisi `members`, `re_registrations`, `legacy_members`, `dues_payments`, `profiles`, dst.;
**Storage** berisi bucket `payment-proofs` (Private).

Bila gagal terhubung (IPv6 / "network unreachable"): Dashboard → *Connect* → **Session pooler** → salin connection string →
`npx supabase db push --db-url "<string pooler>"`.

> **Jangan** menjalankan `npm run db:seed` atau `db:reset` ke cloud (seed menolak host non-lokal). Itu hanya untuk Docker lokal.

## Langkah 4 — Pengaturan Auth Supabase

Dashboard → **Authentication** (pengaturan ini **tidak** ikut terbawa dari `config.toml`):

| Menu | Setel |
|---|---|
| **Sign In / Providers › Email** | Enabled; **Confirm email = OFF** (akun langsung aktif setelah daftar; tanpa email konfirmasi) |
| **Allow new users to sign up** | **ON** (trigger database yang membatasi siapa boleh mendaftar) |
| **Password** | Minimum length **8**; wajib **huruf kecil + besar + angka** |
| **URL Configuration › Site URL** | `https://membership.fritzyforce.my.id` |
| **URL Configuration › Redirect URLs** | tambah `https://membership.fritzyforce.my.id/**`; selama masa peralihan juga `https://ff-membership.fritzyforce-ofc.workers.dev/**`; `http://localhost:3000/**` bila perlu dev lokal |

Tanpa Site URL/Redirect URLs yang benar, tautan reset password dan atur password staf **gagal**.
Jangan jalankan `supabase config push` (akan menimpa Site URL dengan `http://localhost:3000`).

## Langkah 5 — Resend: domain dan API key

1. Daftar di https://resend.com.
2. **Domains → Add Domain** → isi **`membership.fritzyforce.my.id`**. Resend menampilkan daftar record DNS (biasanya DKIM `TXT` di
   `resend._domainkey`, serta `MX` dan `TXT` (SPF) di subdomain `send`).
3. **Pasang record itu di cPanel** (rincian di bawah), lalu klik **Verify** di Resend. Tunggu status **Verified** (menit–jam).
4. **API Keys → Create API Key** (akses *Sending access*). Salin key `re_…` **sekarang** (hanya tampil sekali). Simpan di password manager.
5. Alamat pengirim: **`noreply@membership.fritzyforce.my.id`**.

### Memasang record DNS Resend di cPanel (Zone Editor)

cPanel → **Domains › Zone Editor** → pada baris `membership.fritzyforce.my.id` klik **Manage** → **Add Record**. Untuk tiap record dari Resend:

| Kolom cPanel | Isi |
|---|---|
| **Name** | nama dari Resend. cPanel biasanya menambahkan nama domain otomatis; bila Resend menampilkan `resend._domainkey.membership`, isi persis itu, **bukan** versi lengkap yang berujung `fritzyforce.my.id` (supaya tidak dobel). Bila ragu, tulis nama lengkap diakhiri titik: `resend._domainkey.membership.fritzyforce.my.id.` |
| **Type** | sesuai Resend (`TXT` atau `MX`) |
| **Record / Value** | salin persis dari Resend (nilai DKIM panjang: salin utuh, tanpa spasi atau baris baru tambahan) |
| **Priority** (khusus MX) | sesuai Resend (biasanya 10) |
| **TTL** | biarkan default |

Catatan:
- Record Resend berada di nama `resend._domainkey.membership` dan `send.membership`, jadi **tidak bentrok** dengan record yang dibuat cPanel untuk `membership` (A, MX lokal, dst.). Jangan hapus record bawaan cPanel.
- Bila cPanel/hosting sudah punya `TXT` SPF di `membership.fritzyforce.my.id`, jangan diubah; SPF Resend ada di `send.membership`.
- Perubahan DNS bisa butuh waktu merambat. Kalau **Verify** gagal, tunggu beberapa menit lalu coba lagi; cek ejaan nama record.
- Nameserver domain harus yang dipakai cPanel (milik penyedia hosting). Kalau Zone Editor tidak ada atau record tidak berpengaruh, berarti DNS dikelola di tempat lain (mis. Cloudflare) — pasang record di sana.

> Jangan lanjut ke uji email sebelum domain berstatus **Verified**; kalau belum, kiriman ke selain email pemilik akun ditolak (403).
> Paket gratis membatasi jumlah domain per akun dan jumlah email (cek https://resend.com/pricing).
> Bila Resend menolak karena domain "recently claimed", tunggu atau hubungi support Resend; ini jeda dari sisi Resend, bukan kesalahan konfigurasi.

## Langkah 6 — SMTP Supabase untuk email reset password dan atur password staf

SMTP bawaan Supabase hanya mengirim ke anggota tim Supabase (±2 email/jam), **tidak cukup** untuk reset password dan atur password staf. Dashboard Supabase →
**Authentication › Emails › SMTP Settings** → aktifkan **Custom SMTP**:

| Field | Nilai |
|---|---|
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | API key Resend (`re_…`) |
| Sender email | `noreply@membership.fritzyforce.my.id` |
| Sender name | `Fritzy Force` |

Lalu **Authentication › Rate Limits** → atur batas email per jam sesuai kebutuhan (default 30/jam setelah SMTP sendiri dipasang).

## Langkah 7 — Template email Auth

Dashboard → **Authentication › Emails › Templates**:

| Template | Isi (salin dari repo) | Subjek |
|---|---|---|
| ~~Confirm signup~~ | tidak dipakai (konfirmasi email dimatikan); boleh dilewati | – |
| **Reset Password** | `supabase/templates/recovery.html` | `Atur password akun Fritzy Force` (dipakai juga untuk email "atur password" staf baru) |

## Langkah 8 — Edge Function: email "registrasi ulang disetujui" dan pembuatan akun staf

Dijalankan di **terminal komputer Anda**, folder proyek (bukan di dashboard). Pastikan CLI login ke akun Supabase yang benar.

```bash
cd /Users/brian/projects/ff-membership

# secrets disimpan di Supabase (bukan di git / Cloudflare)
npx supabase secrets set --project-ref <ref> \
  RESEND_API_KEY=re_xxxxxxxx \
  EMAIL_FROM="Fritzy Force <noreply@membership.fritzyforce.my.id>" \
  SITE_URL=https://membership.fritzyforce.my.id

npx supabase functions deploy send-status-email --project-ref <ref>
npx supabase functions deploy create-staff-account --project-ref <ref>   # superadmin membuat akun staf dari menu "Akun Staf"
```
`create-staff-account` memakai `SUPABASE_SERVICE_ROLE_KEY` yang **disuntik otomatis** oleh Supabase (tidak perlu di-set manual) dan `SITE_URL` untuk
tautan di email atur password. Fungsi ini hanya mau melayani **superadmin** (dicek di dalam fungsi), jadi aman walau dipanggil dari browser.

- `EMAIL_FROM` harus alamat di domain yang **Verified** di Resend.
- `SITE_URL` tanpa garis miring di akhir; dipakai untuk link di email (tombol **Cek Status Registrasi** → `SITE_URL/cek-status/?kode=…`).
- Ubah secrets kapan saja dengan `secrets set` lagi (tidak perlu deploy ulang fungsi).
- Cek: Dashboard → **Edge Functions** → `send-status-email` berstatus Active. Log ada di tab **Logs** fungsi itu.
- Bila `deploy` mengeluh soal Docker, tambahkan `--use-api` di akhir perintah.

Sebelum fungsi ini siap, tombol Approve tetap berhasil; admin hanya melihat peringatan "email gagal dikirim" dan bisa memakai
**Kirim ulang email** di detail registrasi.

## Langkah 9 — Hosting situs di `membership.fritzyforce.my.id`

> **Kondisi Anda (DNS di Cloudflare akun pengurus lama, deploy di akun fritzyforce):** ikuti panduan khusus
> [deploy-cloudflare-pages-domain.md](deploy-cloudflare-pages-domain.md) — itu menggantikan Langkah 9 di bawah, termasuk cara memasang record Resend
> di Cloudflare (bukan di Zone Editor cPanel).

Domain dikelola di **cPanel**, sedangkan situs ini adalah file statis (folder `out/` hasil `npm run build`). Pilih **satu** opsi:

| Opsi | Cocok bila | Kekurangan |
|---|---|---|
| **A. Cloudflare Workers** (otomatis deploy dari GitHub) | ingin deploy otomatis tiap `git push` | Custom domain di Cloudflare mengharuskan DNS domain berada di Cloudflare (pindah nameserver) — lihat A |
| **B. Hosting cPanel** (upload manual file statis) | domain dan hosting sudah di cPanel dan tidak ingin memindah DNS | Build dan upload manual tiap perubahan |
| **C. Tetap `workers.dev`** untuk situs, domain hanya untuk email | ingin cepat | Situs tidak memakai domain sendiri |

Untuk **semua opsi**, isi dua nilai build yang sama (project Supabase **baru**):
`NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co` (tanpa `/` di akhir) dan `NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable/anon key>` (tanpa spasi).
Nilai ini **ditanam saat build** — kalau diubah, build ulang.

### Opsi A — Cloudflare Workers + domain sendiri

1. Variabel build: Cloudflare → **Workers & Pages** → Worker `ff-membership` → **Settings › Build › Variables and secrets**.
   Isi **build variables** (bukan runtime): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NODE_VERSION=20`.
   Build command `npm run build`, Deploy command `npx wrangler deploy`, nama Worker `ff-membership` (sama dengan `wrangler.toml`).
   Lalu **Retry build**.
2. Pasang domain: Worker → **Settings › Domains & Routes › Add › Custom domain** → `membership.fritzyforce.my.id`.
   Cloudflare **mengharuskan zona DNS domain berada di akun Cloudflare** untuk custom domain Worker. Artinya:
   - Tambahkan `fritzyforce.my.id` ke Cloudflare (*Add a domain*), lalu **ganti nameserver** di registrar/cPanel penyedia ke nameserver Cloudflare.
   - ⚠️ **Sebelum** memindah nameserver, salin semua record DNS yang ada di cPanel (A, MX, TXT, dll.) ke Cloudflare, termasuk **record Resend** dari Langkah 5.
     Record yang tidak ikut dipindah akan mati (situs, email hosting, dll.).
   - Setelah pindah, record DNS dikelola di Cloudflare, bukan lagi Zone Editor cPanel.
3. Cek `https://membership.fritzyforce.my.id` terbuka.

Cadangan tanpa GitHub (dari komputer): `npx wrangler login`, lalu
`NEXT_PUBLIC_SUPABASE_URL=… NEXT_PUBLIC_SUPABASE_ANON_KEY=… npm run deploy:workers`.

### Opsi B — Hosting di cPanel (tanpa pindah DNS)

Tidak butuh Cloudflare sama sekali. Dari komputer Anda:

```bash
cd /Users/brian/projects/ff-membership
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co \
NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable-key> \
npm run build            # hasil di folder out/
cd out && zip -r ../site.zip . && cd ..
```

Di cPanel:
1. **Domains** → pastikan `membership.fritzyforce.my.id` punya *Document Root* sendiri (mis. `public_html/membership`).
2. **File Manager** → buka Document Root itu → **Upload** `site.zip` → **Extract** → hapus zip. File seperti `index.html`, `login/index.html`, `_next/…`
   harus berada **langsung** di Document Root (bukan di dalam folder `out`).
3. Aktifkan **SSL** untuk domain: cPanel → **SSL/TLS Status** → *Run AutoSSL* (Let's Encrypt/cPanel). Situs harus `https`.
4. Buka `https://membership.fritzyforce.my.id/login/`. Halaman berakhiran `/` (konfigurasi `trailingSlash`); URL tanpa `/` akan dialihkan Apache.
5. Untuk memperbarui: build ulang → upload ulang `site.zip` → extract menimpa file lama (bersihkan folder `_next` lama bila perlu).

> Folder `public/_headers` hanya berlaku di Cloudflare/Netlify; di cPanel diabaikan (tidak masalah). Opsional: tambahkan `.htaccess` untuk cache.

### Opsi C — Tetap workers.dev

Pakai langkah Opsi A bagian 1 saja (tanpa custom domain). Situs: `https://ff-membership.fritzyforce-ofc.workers.dev`.
Dalam kasus ini, `SITE_URL`, Site URL Supabase, dan Redirect URLs memakai URL `workers.dev`; domain `membership.fritzyforce.my.id` hanya dipakai untuk email.

### Setelah situs aktif di domain utama

Pastikan konsisten di tiga tempat: Site URL & Redirect URLs Supabase (Langkah 4), secret `SITE_URL` Edge Function (Langkah 8), dan URL yang dibuka pengguna.
Kalau berubah, perbarui: `npx supabase secrets set --project-ref <ref> SITE_URL=https://membership.fritzyforce.my.id`.

## Langkah 10 — Buat akun staf pertama

Sign-up publik tidak bisa membuat staf; email staf didaftarkan dulu (sekali pakai). Role:

| Role | Hak |
|---|---|
| `superadmin` | semuanya (termasuk approve/reject, ubah role, nonaktifkan akun) |
| `admin_finance` | lihat semua + kelola anggota + **approve/reject uang kas & registrasi ulang** |
| `admin` | lihat semua + kelola anggota; **tidak** bisa approve/reject |

1. Dashboard Supabase → **SQL Editor** → jalankan (ganti email & nama; salah satu role saja sudah cukup untuk mulai):
   ```sql
   insert into public.account_provisioning (email, role, display_name) values
     ('superadmin@domainanda.com', 'superadmin',    'Nama Superadmin'),
     ('finance@domainanda.com',    'admin_finance', 'Nama Finance');
   ```
2. **Authentication › Users › Add user › Create new user** untuk **tiap** email di atas: password kuat
   (huruf besar+kecil+angka, minimal 8) dan centang **Auto Confirm User**.
3. Cek tabel `profiles`: ada baris dengan role tersebut; `account_provisioning` kosong lagi.

**Staf berikutnya** tidak perlu SQL lagi: login sebagai superadmin → menu **Akun Staf** → isi email, nama, role (**Admin** atau **Admin Finance**) → **Buat Akun**.
Staf menerima email untuk mengatur passwordnya sendiri (tombol *Kirim ulang email* tersedia selama ia belum pernah login). Syaratnya: Edge Function
`create-staff-account` sudah di-deploy (Langkah 8) dan SMTP Resend aktif (Langkah 6). Email yang sudah jadi anggota ditolak: minta ia membuat akun anggota lalu ubah
role-nya lewat detail anggota.

## Langkah 11 — Isi daftar anggota lama

Login sebagai staf → menu **Anggota Lama** → **Tambah Data**. **Tempel langsung dari Excel / Google Sheets**: satu baris per anggota, kolom dipisah tab, urutan:

```
Nama Anggota | Display Line | Nomor Anggota Lama | Lebih Bayar | (Catatan, opsional)
```

- **Display Line wajib** (display name Line, bukan ID Line; unik). Kolom lain opsional.
- **Nomor** boleh kosong (anggota "reset" / "ex admin"). Tulisan tanpa angka di kolom nomor (mis. `reset`, `ex admin`) otomatis dijadikan catatan dan nomornya dikosongkan.
- **Lebih Bayar**: `2 bulan` atau `2` (0–12). Baris judul kolom boleh ikut ditempel.
- File siap tempel dari spreadsheet yang sudah dikonversi: `anggota-lama-import.tsv` (tidak disimpan di repo karena berisi data pribadi). Salin **seluruh isi** file → tempel ke kotak → **Simpan Data**. Hasil yang diharapkan: `137 baris ditambahkan … 0 tidak valid`.
- Mengimpor ulang aman: baris yang display name-nya sudah ada hanya diperbarui pada kolom yang terisi, selama belum registrasi ulang.
- Display name dipakai anggota untuk mencari datanya di form registrasi ulang bila nomor tidak ditemukan.
- Aturan uang kas: pembayaran registrasi ulang dihitung kas **bulan registrasi**; lebih bayar 1 bulan melunasi bulan berikutnya, 2 bulan = dua bulan berikutnya, dst.
- Data yang sudah registrasi ulang tidak bisa diubah. Tanpa daftar ini, tidak ada yang bisa registrasi ulang.

## Langkah 12 — Uji asap (smoke test)

1. Buka situs → halaman utama tampil; **Registrasi Ulang** aktif, **Join Us Now!** nonaktif.
2. `/login/` dengan akun staf → masuk ke `/admin/members/`.
3. **Anggota Lama** → **Tambah Data** → tempel dua baris uji, mis. `Tes Satu\tTes Satu\tTEST-001\t1` dan `Tes Dua\tTes Dua\t\t`.
4. Logout → `/registrasi-ulang/` → isi form (nomor lama `TEST-001` atau display name `Tes Satu`, **minimal satu sosmed**, email Anda sendiri) + unggah bukti JPG/PNG ≤ 5 MB → dapat kode `RU-XXXX-XXXX`.
5. Login sebagai `admin_finance`/`superadmin` → **Registrasi Ulang** → buka detail → **Approve** → muncul nomor `FRC-001` dan pesan email terkirim.
   Cek inbox: ada tombol **Cek Status Registrasi**.
6. Di detail anggota → **Riwayat Uang Kas**: pembayaran registrasi (bulan ini) + kelebihan bayar (bulan berikutnya), tanpa tunggakan; tombol **Rincian** menampilkan tanggal bayar dan tanggal approve.
7. Login sebagai `admin` biasa → detail registrasi pending **tanpa** tombol Approve/Reject.
8. Klik tombol di email → **Registrasi Akun** → isi password + konfirmasi password → langsung diarahkan ke halaman login dengan pesan "Registrasi akun berhasil" → login dengan email dan password tadi → masuk `/akun/`.
9. `/akun/bayar/` → ajukan pembayaran → staf finance Approve di **Uang Kas**.

Hapus data uji (nomor `TEST-…`, anggota/registrasi uji) lewat SQL Editor sebelum dipakai nyata.

---

## Pemecahan masalah

| Gejala | Penyebab dan solusi |
|---|---|
| Login: **`Invalid API key`** (Network → `token?grant_type=password` → "Invalid API key") | `NEXT_PUBLIC_SUPABASE_ANON_KEY` di build salah: terpotong, ada spasi, key project lain, atau secret key. Isi ulang di **build variables**, lalu **Retry build**. |
| Login: "Email belum dikonfirmasi" | *Confirm email* di Supabase masih ON (matikan di Authentication › Providers › Email), atau user dibuat tanpa *Auto Confirm*. Jalankan: `update auth.users set email_confirmed_at = now() where email = 'emailanda@…';` |
| Login: "Email atau password salah" | Password salah atau tidak memenuhi aturan. Ubah di Authentication › Users. |
| Login: "Akun ini tidak aktif atau belum tertaut…" | Profil tidak terbaca: cek migrasi lengkap terpasang dan baris `profiles` ada, `active = true`. |
| "Backend belum dikonfigurasi…" | Variabel build kosong/salah nama (Cloudflare: harus *build* variables, bukan runtime; cPanel: belum diisi saat `npm run build`). Perbaiki lalu build ulang. |
| Tautan konfirmasi/reset ke `localhost` atau ditolak | Site URL / Redirect URLs belum benar (Langkah 4). |
| Email konfirmasi tidak datang | SMTP belum dipasang (Langkah 6), domain Resend belum *Verified*, sender bukan di domain terverifikasi, atau cek spam / rate limit. |
| Approve berhasil tapi "email ke pendaftar gagal dikirim" | Fungsi belum di-deploy/secrets belum diisi (Langkah 8), atau Resend menolak (domain belum Verified → 403; `EMAIL_FROM` bukan di domain terverifikasi). Lihat Edge Functions → Logs, lalu pakai **Kirim ulang email**. |
| Link di email membawa ke URL salah | `SITE_URL` secret salah → `secrets set` ulang. |
| Tombol Approve/Reject tidak muncul | Akun berperan `admin`. Hanya `admin_finance`/`superadmin`. |
| "Nomor anggota lama tidak ditemukan" | Nomor belum ada di daftar (Langkah 11) atau salah ketik. |
| Form registrasi: "Isi minimal salah satu akun sosial media" | Isi salah satu dari X / Instagram / TikTok. |
| Password ditolak padahal 8 karakter | Wajib ada huruf besar, kecil, **dan** angka. |
| Unggah bukti gagal | Bukan JPG/PNG, > 5 MB, atau migrasi/bucket belum terpasang. |
| Halaman 404 di `/login` atau `/admin/…` | Build gagal / `out/` kosong (Cloudflare: cek log build). cPanel: isi `out/` harus langsung di Document Root, bukan di dalam folder `out`. URL berakhiran `/`. |
| Verify Resend gagal | Nama record di cPanel dobel/salah ejaan, atau belum merambat. Cek di Zone Editor; coba lagi beberapa menit kemudian. |
| `https://membership…` "not secure" / tidak terbuka | cPanel: SSL belum aktif (SSL/TLS Status → Run AutoSSL). Cloudflare: custom domain belum *Active*. |
| `db push` / `functions deploy` menyasar project salah | `npx supabase projects list`, `supabase link` ulang ke ref yang benar, atau pakai `--project-ref` eksplisit. |
| Satu komputer, dua akun Supabase/Cloudflare | `npx supabase logout` lalu `login`; `npx wrangler logout` lalu `login`; cek `npx wrangler whoami`. |

## Rilis terbaru: apa yang harus dijalankan (urut)

Untuk lingkungan yang **sudah** ter-deploy (staging, lalu live). Kerjakan **staging dulu**, uji, baru live. Ganti `<ref>` dengan project ref lingkungan itu.

**Isi rilis:** QRIS baru · nama lengkap registrasi ulang opsional · tanggal lahir & alamat dihapus dari form · struktur daftar anggota lama baru (display name wajib & unik,
nomor opsional, nama, catatan, lebih bayar) + impor dari Excel · nomor anggota baru berformat **FRC-NNN** · pencarian lewat display name Line · pembuatan akun staf oleh superadmin · hapus lorem ipsum.

1. **Cek akses ke project yang benar**
   ```bash
   cd /Users/brian/projects/ff-membership
   npx supabase login
   npx supabase link --project-ref <ref>
   npx supabase migration list          # lihat migrasi mana yang belum ada di kolom Remote
   ```
2. **(Hanya bila ada data uji di daftar anggota lama)** bersihkan dulu lewat SQL Editor, supaya tidak bercampur dengan data asli. Migrasi struktur baru
   memberi baris lama display name sementara = nomornya; baris uji sebaiknya dihapus. Contoh (periksa dulu isinya dengan `select`):
   ```sql
   select * from public.legacy_members where not is_registered;          -- lihat dulu
   delete from public.legacy_members where not is_registered and old_member_number like 'TEST-%';
   ```
   Jangan menghapus baris yang sudah `is_registered = true`.
3. **Database (migrasi)**
   ```bash
   npx supabase db push
   ```
   Menerapkan migrasi baru (di antaranya `20261023…legacy_line_name_staff`, `20261024…legacy_members_restructure`, dan `20261025…member_number_frc`). Jawab **Y**. Nomor anggota yang sudah terbit (`FF-NNN`) **tidak berubah** dan tetap valid; hanya approve berikutnya yang bernomor `FRC-NNN`, melanjutkan urutan counter yang sudah ada
   (live yang masih kosong mulai dari `FRC-001`). Catatan: kolom
   `birth_date` dan `address` pada tabel `re_registrations` (pengajuan registrasi ulang) ikut dihapus, jadi datanya hilang; data di tabel `members` tidak berubah.
4. **Edge Functions** (keduanya; `send-status-email` berubah sedikit, `create-staff-account` baru)
   ```bash
   npx supabase functions deploy send-status-email --project-ref <ref>
   npx supabase functions deploy create-staff-account --project-ref <ref>
   ```
   Secrets tidak berubah (`SITE_URL`, `EMAIL_FROM`, `RESEND_API_KEY` sudah ada). `create-staff-account` memakai service role yang disuntik otomatis.
5. **Template email Auth** (Dashboard Supabase → Authentication › Emails › Templates → **Reset Password**): tempel ulang isi `supabase/templates/recovery.html`
   dan ubah subjek menjadi `Atur password akun Fritzy Force`. (Dipakai juga untuk email "atur password" staf baru.)
6. **Kode situs**: commit dan push, lalu tunggu build Cloudflare selesai (QRIS baru ikut terbawa: `public/qris.jpg`).
   ```bash
   git add -A
   git status            # pastikan tidak ada .env / supabase/functions/.env / file import yang ikut
   git commit -m "Daftar anggota lama baru, QRIS baru, registrasi ulang disederhanakan"
   git push
   ```
   Variabel build Cloudflare **tidak berubah**. Bila situs tidak di-deploy otomatis, jalankan *Retry deployment*.
7. **Impor data anggota lama**: login sebagai staf → **Anggota Lama** → **Tambah Data** → tempel isi `anggota-lama-import.tsv` → **Simpan Data**
   (hasil: 137 baris ditambahkan, 0 tidak valid).
8. **Uji cepat**
   - `/registrasi-ulang/`: nama lengkap bertanda opsional, tidak ada tanggal lahir/alamat, QRIS baru tampil; isi display name Line (mis. milik satu anggota) → muncul "Ditemukan…"; isi nama ngawur → pesan "hubungi admin".
   - Login superadmin → menu **Akun Staf** → buat satu akun Admin uji → email "Atur password" masuk; hapus akunnya di Dashboard bila hanya uji.
   - Approve satu registrasi uji → anggota terbentuk (nama dari daftar lama bila nama lengkap dikosongkan), email "disetujui" terkirim.
9. **Live**: ulangi langkah 1–8 dengan project ref, akun Supabase/Cloudflare, dan API key **live**. Jangan mengimpor data uji ke live.

## Reset data keanggotaan (nomor anggota kembali ke FRC-001)

Berguna setelah masa uji, **sebelum** dipakai anggota sungguhan. **Destruktif dan tidak bisa dibatalkan setelah COMMIT.** Skrip: [`supabase/scripts/reset-membership.sql`](../supabase/scripts/reset-membership.sql).

1. Dashboard Supabase → **SQL Editor** → tempel seluruh isi skrip → **Run**. Skrip membuka transaksi (`begin`) dan menampilkan satu baris hasil pengecekan
   (jumlah anggota, registrasi ulang, pembayaran, counter, daftar anggota lama, akun staf tersisa). Harapan: `members = 0`, `re_registrations = 0`, `dues_payments = 0`,
   `counter = 0`, `legacy_registered = 0`, `legacy_total` = jumlah anggota lama Anda, `profil_tersisa_staf` = jumlah staf.
2. Bila angkanya benar, jalankan `commit;` di editor yang sama. Bila ragu, `rollback;`.
3. Kosongkan file bukti di **Storage › payment-proofs** (hapus folder `re-registrations/` dan `dues/`) — file tidak ikut terhapus oleh SQL.
4. Verifikasi: registrasi ulang berikutnya yang di-Approve bernomor **FRC-001**.

Yang **dihapus**: anggota, akun login anggota, registrasi ulang, pembayaran uang kas, audit log. Yang **tetap**: akun staf, daftar anggota lama (nama, display name, nomor, lebih bayar — hanya status
"sudah registrasi ulang" dikembalikan ke belum), pengaturan iuran.

## Update rutin

- **Kode**: Cloudflare (opsi A): `git push` → build dan deploy otomatis. cPanel (opsi B): build ulang lalu upload ulang `site.zip`.
- **Skema DB**: tambah file baru di `supabase/migrations/` → uji lokal (`npm run db:reset && npm run db:test`) → `npx supabase db push`.
  Jangan mengedit migrasi yang sudah di-push; buat migrasi baru.
- **Edge Function**: setelah mengubah `supabase/functions/<nama>/`, jalankan ulang
  `npx supabase functions deploy <nama> --project-ref <ref>` (fungsi: `send-status-email`, `create-staff-account`).

## Checklist ringkas

- [ ] Project Supabase dibuat, ref + Database password dicatat
- [ ] `npx supabase link` + `db push` sukses
- [ ] Auth: Confirm email **OFF**, sign-up ON, password policy, Site URL, Redirect URLs
- [ ] Resend: domain **Verified**, API key dibuat
- [ ] SMTP Custom di Supabase + rate limit + 2 template email
- [ ] `secrets set` (RESEND_API_KEY, EMAIL_FROM, SITE_URL) + `functions deploy send-status-email`
- [ ] Situs dihosting (opsi A/B/C) dengan variabel Supabase project baru, domain `membership.fritzyforce.my.id` aktif dengan HTTPS
- [ ] Akun staf dibuat (provisioning + Auto Confirm)
- [ ] Nomor anggota lama diisi (+ kelebihan bayar)
- [ ] Uji asap lulus, data uji dihapus
