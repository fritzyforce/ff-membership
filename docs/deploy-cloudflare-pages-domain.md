# Panduan khusus: Cloudflare Pages (akun fritzyforce) + domain `membership.fritzyforce.my.id`

Panduan ini untuk **kondisi spesifik** berikut. Baca bagian "Kondisi dan keputusan" dulu, lalu ikuti urutannya.

| Fakta | Dampak |
|---|---|
| Domain `fritzyforce.my.id` dibeli lewat **IDwebhost** (registrar + cPanel). | Perubahan **nameserver** dilakukan di panel IDwebhost, bukan di Cloudflare. |
| Nameserver domain sudah mengarah ke **Cloudflare**, di **akun pribadi pengurus lama**. Isinya banyak CNAME dan konfigurasi lain. | **DNS yang berlaku adalah yang ada di Cloudflare akun lama.** **Zone Editor di cPanel tidak berpengaruh** (cPanel bukan pengelola DNS-nya). |
| Situs akan di-deploy di **Cloudflare Pages**, di akun **fritzyforce** (akun Cloudflare yang berbeda dari akun pemegang DNS). | Dua akun Cloudflare terlibat. Pages butuh **satu CNAME** di zona DNS yang ada di akun lama. |
| Domain yang diinginkan: `membership.fritzyforce.my.id`. | Berupa **subdomain**, jadi tidak wajib memindah zona (lihat di bawah). |

Panduan umum (Supabase, Resend, akun staf, dst.) ada di [deploy-supabase-cloudflare.md](deploy-supabase-cloudflare.md).
Dokumen ini fokus pada **hosting Pages + DNS + domain**, dan mengganti Langkah 9 di panduan umum.

> Dashboard Cloudflare, Resend, dan IDwebhost sering berubah. Bila nama menu sedikit berbeda, cari menu yang fungsinya sama.
> Bagian yang **belum saya pastikan** saya beri tanda ⚠️.

---

## Kondisi dan keputusan

Dari dokumentasi Cloudflare ([custom domains Pages](https://developers.cloudflare.com/pages/configuration/custom-domains/)):

- Untuk **subdomain**, zona DNS-nya **tidak harus** ada di akun Cloudflare yang sama dengan project Pages. Cukup tambahkan **CNAME**
  `membership` → `<nama-project>.pages.dev` di tempat DNS-nya dikelola.
- Untuk domain **apex** (`fritzyforce.my.id` tanpa subdomain), zona **wajib** ada di akun yang sama dengan project Pages.
- **Urutan penting:** tambahkan domain di dashboard Pages **dulu**, baru buat CNAME-nya. Kalau CNAME dibuat lebih dulu, domain gagal
  resolve dan menampilkan **error 522**.

Artinya ada dua jalur:

| | **Jalur 1 (disarankan sekarang): tanpa memindah zona** | **Jalur 2 (disarankan jangka panjang): pindahkan zona ke akun fritzyforce** |
|---|---|---|
| Apa yang diubah | Hanya menambah beberapa record di zona akun lama (1 CNAME + record Resend) | Seluruh zona DNS dipindah ke akun fritzyforce; nameserver di IDwebhost diganti |
| Butuh dari pengurus lama | Mau menambah record, atau memberi Anda akses ke zona itu | Mau mengekspor zona dan melepas domain |
| Risiko | Rendah (hanya tambah record) | Sedang: salah salin record = situs/email lama mati |
| Masalah yang tersisa | DNS organisasi masih bergantung pada akun pribadi orang lain | Tuntas |

**Rekomendasi:** kerjakan **Jalur 1** sekarang supaya aplikasi bisa jalan, lalu rencanakan **Jalur 2** (Bagian D) saat tenang.
Ketergantungan pada akun pribadi pengurus lama adalah risiko jangka panjang: kalau akunnya hilang atau ditutup, DNS seluruh domain ikut tidak terkendali.

---

## Bagian 0 — Siapkan akses dan data

### 0.1 Daftar akses yang dibutuhkan

| Akses | Untuk apa | Cara memastikan |
|---|---|---|
| Login **Cloudflare akun fritzyforce** | Membuat project Pages dan custom domain | Bisa buka https://dash.cloudflare.com dan melihat Workers & Pages |
| **Owner organisasi GitHub `fritzyforce`** (atau GitHub Apps Manager) | Memasang aplikasi Cloudflare di repo organisasi | Cek GitHub › organisasi › People |
| Akses **zona DNS `fritzyforce.my.id` di Cloudflare akun lama** (atau orang yang bisa menambah record atas permintaan Anda) | Menambah CNAME `membership` + record Resend | Lihat Bagian 0.2 |
| Login **IDwebhost** (akun pemilik domain) | Hanya untuk **Jalur 2** (mengganti nameserver) dan memastikan siapa pemilik domain | Login ke client area IDwebhost → Domains |
| Akun **Supabase** dan **Resend** (baru, sudah dibuat) | Backend dan email | Lihat panduan umum |

### 0.2 Cari tahu siapa yang memegang zona DNS

1. Lihat nameserver yang dipakai domain:
   ```bash
   dig +short NS fritzyforce.my.id
   ```
   Hasilnya dua nama berakhiran `.ns.cloudflare.com` (mis. `anna.ns.cloudflare.com`). Itu menandakan DNS dikelola di Cloudflare.
2. Anda **tidak bisa** melihat akun Cloudflare mana pemiliknya dari luar. Tanyakan langsung ke pengurus lama, atau cek apakah Anda sudah
   diundang sebagai member di zona itu (login Cloudflare → pilih akun → lihat daftar domain).
3. Tentukan salah satu:
   - **a. Anda diberi akses member ke zona itu** (terbaik untuk Jalur 1: Anda sendiri yang menambah record). Mintalah peran
     yang cukup untuk **DNS** (mis. *DNS* atau *Administrator*) lewat Cloudflare → akun lama → **Manage Account › Members** → *Invite*.
   - **b. Pengurus lama yang menambah record** atas permintaan Anda. Pakai template pesan di Bagian F.
4. Tidak ada keduanya (pengurus tidak bisa dihubungi)? Pegang dulu satu hal yang sudah pasti milik Anda: **akun IDwebhost sebagai pemilik domain**.
   Dengan itu Anda bisa mengganti nameserver ke Cloudflare akun fritzyforce atau kembali ke nameserver IDwebhost — **tetapi** Anda harus
   menyusun ulang semua record DNS dari nol, dan Anda tidak bisa membaca daftar record lama tanpa akses zona. Hindari jalur ini kecuali terpaksa.

### 0.3 Catat nilai penting di password manager

- Project ref Supabase, Database password, API key Resend (`re_…`).
- Nama project Pages yang akan dibuat (di bawah: `ff-membership` → `ff-membership.pages.dev`).

---

## Bagian A — Inventaris DNS (lakukan SEBELUM menyentuh apa pun)

Tujuannya: tahu isi zona sekarang, supaya tidak ada yang rusak.

### A1. Ekspor zona (cadangan)
Di Cloudflare **akun lama** → pilih `fritzyforce.my.id` → **DNS › Records** → **Export** (file BIND). Simpan file `.txt` itu di tempat aman.
(Kalau pengurus lama yang memegang akun, minta file ini darinya; Anda perlu itu juga untuk Jalur 2.)

### A2. Periksa record yang bisa bentrok dengan `membership`

Di daftar record, cari:
| Cari | Kenapa penting |
|---|---|
| Record dengan name **`membership`** (jenis A, AAAA, CNAME, MX, TXT apa pun) | **CNAME tidak boleh berdampingan dengan record jenis lain di nama yang sama.** Kalau sudah ada, harus diganti/dihapus sebelum membuat CNAME ke Pages. |
| Record **wildcard `*`** (mis. `*.fritzyforce.my.id`) | Wildcard tidak menghalangi record spesifik `membership`, tetapi catat keberadaannya. |
| Record **CAA** | Bila CAA hanya mengizinkan CA tertentu, sertifikat Pages bisa gagal terbit. Dokumentasi Cloudflare menyarankan CAA yang mengizinkan `letsencrypt.org`, `pki.goog; cansignhttpexchanges=yes`, dan `ssl.com`. |
| Pengaturan **DNSSEC** (DNS › Settings) | Hanya relevan untuk Jalur 2 (harus dilepas dulu). |
| Record MX / TXT di `fritzyforce.my.id` | Dipakai email cPanel/IDwebhost; **jangan diubah**. |

### A3. Kalau subdomain `membership` pernah dibuat di cPanel
Subdomain di cPanel hanya membuat folder/vhost di server hosting; karena DNS ada di Cloudflare, **tidak ada efeknya** kecuali di zona Cloudflare
ada record `membership` (A/CNAME) yang mengarah ke IP hosting IDwebhost. Kalau ada, itu record yang harus diganti ke CNAME Pages (Bagian B3).
Anda **tidak perlu** membuat atau memakai subdomain di cPanel untuk aplikasi ini.

---

## Bagian B — Jalur 1: Pages di akun fritzyforce, DNS tetap di akun lama

### B1. Hubungkan GitHub (aplikasi Cloudflare di organisasi)

1. Login Cloudflare **akun fritzyforce** → **Workers & Pages** → **Create application**.
   Cloudflare sekarang mengutamakan Workers; cari tautan/tab **Pages** ("Looking to deploy Pages? Get started") → **Connect to Git**.
2. **+ Add account** → pilih organisasi GitHub **fritzyforce** → **Install & Authorize**.
   - Anda harus **owner organisasi** atau punya peran *GitHub Apps Manager*. Bila tidak, minta owner melakukannya.
   - Di GitHub pilih **Only select repositories** → `ff-membership` (disarankan).
3. ⚠️ Cloudflare menyebut satu akun GitHub sebaiknya terhubung ke **satu** akun Cloudflare. Bila akun GitHub Anda sudah terhubung ke akun
   Cloudflare lain (mis. pribadi), putuskan dulu atau pakai akun GitHub lain yang diberi akses.

### B2. Buat project Pages

| Field | Nilai |
|---|---|
| Repository | `fritzyforce/ff-membership` |
| Project name | `ff-membership` (menentukan URL `ff-membership.pages.dev`; kalau sudah dipakai, pilih nama lain dan sesuaikan CNAME nanti) |
| Production branch | `main` bila sudah diganti; kalau masih `master`, pilih `master` |
| Framework preset | **Next.js (Static HTML Export)** — atau *None* dan isi manual |
| Build command | `npm run build` |
| Build output directory | `out` |
| Root directory | kosongkan |

**Environment variables** (isi untuk **Production** dan **Preview**; ini *build-time*):

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` (project Supabase **baru**, tanpa `/` di akhir) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Publishable/anon key project baru (tanpa spasi) |
| `NODE_VERSION` | `20` (⚠️ dokumentasi build config tidak menjelaskan versi Node default; kalau build gagal karena versi Node, lihat log dan sesuaikan) |

Klik **Save and Deploy**. Build pertama butuh beberapa menit; setelah itu situs tampil di `https://ff-membership.pages.dev`.

> ⚠️ **File `wrangler.toml` di repo** berformat Workers (untuk deploy lama). Dokumentasi Cloudflare menyatakan file wrangler tanpa
> `pages_build_output_dir` **diabaikan untuk deployment Pages** (hanya untuk pengembangan lokal, dengan peringatan). Dokumentasi
> tidak menjelaskan perilakunya untuk build lewat Git. Kalau build gagal gara-gara file itu, lihat Bagian E (fallback upload lewat CLI).

### B3. Tambahkan custom domain di Pages (LANGKAH INI DULU, sebelum CNAME)

1. Buka project Pages `ff-membership` → tab **Custom domains** → **Set up a domain**.
2. Isi `membership.fritzyforce.my.id` → **Continue**.
3. Cloudflare menampilkan instruksi: karena zonanya **tidak ada di akun ini**, Anda harus menambahkan **CNAME** di tempat DNS-nya dikelola.
   Catat nilainya:
   ```
   Type:    CNAME
   Name:    membership
   Target:  ff-membership.pages.dev      (sesuaikan dengan nama project Pages Anda)
   ```
4. Biarkan halaman ini terbuka / status "Verifying" — verifikasi berjalan otomatis setelah CNAME ada.

### B4. Pasang CNAME di zona DNS akun lama

Di Cloudflare **akun lama** → `fritzyforce.my.id` → **DNS › Records** → **Add record** (atau minta pengurus lama):

| Field | Isi |
|---|---|
| Type | `CNAME` |
| Name | `membership` (Cloudflare otomatis melengkapi jadi `membership.fritzyforce.my.id`) |
| Target | `ff-membership.pages.dev` — **harus `*.pages.dev`**, bukan `*.workers.dev` (itu penyebab error 1014) |
| Proxy status | Awalnya biarkan **Proxied** (awan oranye) seperti default. ⚠️ Bila muncul galat terkait CNAME lintas akun (mis. error 1014) atau domain tidak aktif, ubah ke **DNS only** (awan abu-abu) lalu coba lagi. |
| TTL | Auto |

- Kalau sudah ada record lain bernama `membership` (A/AAAA/CNAME lama), **hapus/ganti** dulu (lihat A2). Catat nilai lamanya di cadangan.
- Kembali ke dashboard Pages: status berubah **Verifying → Active** (beberapa menit; bisa lebih lama). SSL terbit otomatis.
- Uji: `https://membership.fritzyforce.my.id` membuka situs. Cek juga `https://membership.fritzyforce.my.id/login/`.

### B5. Record Resend untuk `membership.fritzyforce.my.id`

> Karena DNS ada di Cloudflare akun lama, record Resend **juga dipasang di sana**, bukan di Zone Editor cPanel.

1. Resend → **Domains → Add Domain** → `membership.fritzyforce.my.id` (region dekat pengguna, mis. Singapore bila tersedia).
2. Resend menampilkan daftar record (jumlah, **jenis**, dan nama dapat berbeda; **salin persis dari Resend**). Contoh bentuk yang mungkin muncul
   (Resend kini juga memakai **CNAME** ke `…rmta.net`, selain TXT/MX; untuk CNAME Resend set **DNS only**, awan abu-abu):

   | Jenis | Name (di Cloudflare) | Fungsi |
   |---|---|---|
   | `TXT` atau `CNAME` | `resend._domainkey.membership` / `rsend.membership` | DKIM / konfigurasi kirim |
   | `MX`, `TXT`, atau `CNAME` | `send.membership` | return-path/bounce dan SPF |
   | `TXT` (opsional) | `_dmarc.membership` | kebijakan DMARC |

3. Di Cloudflare akun lama → DNS → Add record untuk tiap baris:
   - **Name:** tulis relatif (mis. `resend._domainkey.membership`); Cloudflare melengkapi domainnya. Jangan menulis nama lengkap dua kali.
   - **Content (TXT):** tempel nilai persis dari Resend (tanpa mengubah/menambah spasi; Cloudflare menangani tanda kutip sendiri).
   - **MX:** isi *Mail server* dan *Priority* persis dari Resend.
   - Record ini bernama `*.membership` / `send.membership`, **bukan** `membership`, jadi **tidak bentrok** dengan CNAME `membership` dari B4.
4. Kembali ke Resend → **Verify DNS Records**. Tunggu **Verified**.
5. Bila Resend menolak dengan pesan "recently claimed", itu jeda dari sisi Resend; tunggu atau hubungi support Resend.
6. Buat **API Key** (Sending access). Alamat pengirim: `noreply@membership.fritzyforce.my.id`.

### B6. Sesuaikan Supabase dan Edge Function dengan domain baru

Ikuti panduan umum Langkah 3 s/d 8, dengan nilai ini:

| Tempat | Nilai |
|---|---|
| Supabase › Authentication › URL Configuration › **Site URL** | `https://membership.fritzyforce.my.id` |
| Supabase › … › **Redirect URLs** | `https://membership.fritzyforce.my.id/**` dan (untuk preview) `https://*.ff-membership.pages.dev/**` ⚠️ pola preview Pages; sesuaikan bila URL preview Anda berbeda |
| Supabase › SMTP (Custom SMTP) | Host `smtp.resend.com`, port `465`, user `resend`, password = API key Resend, sender `noreply@membership.fritzyforce.my.id` |
| Secret Edge Function `SITE_URL` | `https://membership.fritzyforce.my.id` |
| Secret Edge Function `EMAIL_FROM` | `Fritzy Force <noreply@membership.fritzyforce.my.id>` |

```bash
npx supabase secrets set --project-ref <ref> \
  RESEND_API_KEY=re_xxxxxxxx \
  EMAIL_FROM="Fritzy Force <noreply@membership.fritzyforce.my.id>" \
  SITE_URL=https://membership.fritzyforce.my.id
npx supabase functions deploy send-status-email --project-ref <ref>
```

### B7. Rapikan deployment lama (setelah Pages jalan)

- Worker lama `ff-membership` (`*.workers.dev`) di akun fritzyforce tidak diperlukan lagi. Matikan atau hapus agar tidak membingungkan.
  Sebelum menghapus, pastikan tidak ada yang memakainya.
- Hapus `https://ff-membership.fritzyforce-ofc.workers.dev/**` dari Redirect URLs Supabase bila tidak dipakai lagi.

### B8. Uji akhir Jalur 1
Jalankan Langkah 10–12 di panduan umum (akun staf, nomor anggota lama, uji asap) menggunakan `https://membership.fritzyforce.my.id`.
Pastikan email konfirmasi dan email "registrasi ulang disetujui" memuat link berawalan `https://membership.fritzyforce.my.id`.

---

## Bagian C — Perubahan rutin setelah deploy

- **Update kode:** `git push` ke production branch → Pages build ulang otomatis. Branch lain mendapat URL preview.
- **Mengubah variabel Supabase:** ubah di Pages › Settings › Environment variables → **Retry deployment** (variabel `NEXT_PUBLIC_*` ditanam saat build).
- **Migrasi database baru:** `npx supabase db push` (lihat panduan umum). Tidak memengaruhi DNS/hosting.

---

## Bagian D — Jalur 2 (disarankan jangka panjang): pindahkan zona DNS ke akun fritzyforce

Tujuan: DNS `fritzyforce.my.id` dipegang akun organisasi, bukan akun pribadi. Setelah itu custom domain Pages bisa dipasang otomatis di akun yang sama
dan Anda bisa mengelola semua record sendiri. Dasar langkah ini: dokumentasi Cloudflare
[Move a domain between Cloudflare accounts](https://developers.cloudflare.com/fundamentals/manage-domains/move-domain/).

⚠️ **Risiko:** nameserver **berubah**. Salah salin record = situs, email cPanel/IDwebhost, atau layanan lain yang sekarang jalan ikut mati.
Lakukan di jam sepi, jangan terburu-buru, dan siapkan jalan kembali.

### D1. Prasyarat
- Akses ke **IDwebhost** (untuk mengganti nameserver) dan ke **zona lama** (untuk ekspor), atau pengurus lama yang bersedia mengekspor.
- **Lepas DNSSEC** dan batalkan add-on/langganan di zona lama (syarat dari Cloudflare).
- Ekspor zona lama (A1). **Gunakan file ekspor ini saat impor**; tanpa itu Cloudflare mengimpor record proxied apa adanya yang dapat menyebabkan **error 1000**.
- Pastikan siapa yang boleh dihubungi bila ada yang rusak.

### D2. Tambahkan domain ke akun fritzyforce
1. Cloudflare akun fritzyforce → **Add a domain** → `fritzyforce.my.id` (dianggap penambahan pertama di akun ini).
2. Pilih paket (Free cukup). Cloudflare memberi **dua nameserver baru** (berbeda dari yang lama). **Catat keduanya.**
3. **Impor** file ekspor: DNS › Records › **Import**. Periksa hasilnya record demi record.
4. Zona akan berstatus **Pending** sampai nameserver diganti. Selama Pending, zona baru **tidak** melayani lalu lintas; nameserver lama masih berlaku.

### D3. Bandingkan record lama vs baru SEBELUM mengganti nameserver
Anda bisa menanyai nameserver baru langsung, sebelum diaktifkan:

```bash
# isi names.txt dengan semua nama (FQDN) dari file ekspor, satu per baris
# (contoh: fritzyforce.my.id, www.fritzyforce.my.id, mail.fritzyforce.my.id, ...)
NS_OLD=$(dig +short NS fritzyforce.my.id | head -1)    # nameserver lama (Cloudflare akun lama)
NS_NEW=<nameserver-baru-dari-akun-fritzyforce>          # contoh: lola.ns.cloudflare.com

for n in $(cat names.txt); do
  for t in A AAAA CNAME MX TXT; do
    a=$(dig +short $t $n @$NS_OLD | sort)
    b=$(dig +short $t $n @$NS_NEW | sort)
    [ "$a" != "$b" ] && printf 'BEDA %s %s\n  lama: %s\n  baru: %s\n' "$n" "$t" "$a" "$b"
  done
done
```
- Perbedaan pada record **proxied** (awan oranye) wajar: alamat IP Cloudflare yang dikembalikan bisa berbeda. Yang harus **sama** adalah record DNS only (MX, TXT, CNAME ke luar, A non-proxied).
- Pastikan juga ada: record **email** (MX, SPF, DKIM, DMARC), record **verifikasi** (Google, dll.), serta CNAME layanan pihak ketiga.
- Tambahkan sekalian record baru: CNAME `membership` (Pages; sekarang bisa dibuat otomatis lewat custom domain di akun yang sama) dan record Resend (B5).

### D4. Ganti nameserver di IDwebhost
1. Login client area IDwebhost → **Domains** (Domain Saya) → `fritzyforce.my.id` → **Manage / Nameservers** (nama menu dapat berbeda).
2. Pilih nameserver kustom dan isi **dua nameserver baru dari akun fritzyforce** (menggantikan dua yang lama).
3. Simpan. Perubahan nameserver di registry domain `.my.id` bisa butuh waktu (menit–jam; tidak selalu instan).
4. Di Cloudflare akun fritzyforce → zona → **Overview** → **Re-check now**. Status berubah ke **Active**.
5. Zona di akun lama akan berstatus **Moved Away**, lalu **Deleted** setelah 7 hari, dan dihapus permanen 7 hari berikutnya (menurut dokumentasi). Jangan hapus manual sebelum semuanya stabil.
6. Sertifikat SSL **tidak ikut pindah**; Cloudflare menerbitkan ulang (Universal SSL) di akun baru. Tunggu beberapa menit–jam.

### D5. Verifikasi setelah pindah
```bash
dig +short NS fritzyforce.my.id            # harus dua nameserver baru
dig +short CNAME membership.fritzyforce.my.id
dig +short MX fritzyforce.my.id            # sama seperti sebelumnya
curl -I https://membership.fritzyforce.my.id/login/
```
Uji juga: situs utama organisasi, email cPanel (kirim dan terima), dan layanan lain yang bergantung pada DNS itu.

### D6. Jalan kembali (rollback)
Selama zona lama belum **Deleted**: ganti nameserver di IDwebhost kembali ke dua nameserver lama. Karena itu simpan keduanya, dan jangan menghapus zona lama lebih awal.

### D7. Setelah berhasil
- Custom domain Pages bisa dikelola langsung di akun fritzyforce (zona dan project di akun yang sama).
- Pengurus lama tidak perlu lagi dilibatkan untuk perubahan DNS.
- Pastikan **akun fritzyforce** memiliki lebih dari satu admin dan 2FA aktif, supaya tidak jadi satu titik kegagalan lagi.

---

## Bagian E — Cadangan: deploy tanpa integrasi GitHub (CLI)

Dipakai bila akses GitHub organisasi belum beres atau build via Git bermasalah (mis. karena `wrangler.toml`). Dari komputer Anda:

```bash
cd /Users/brian/projects/ff-membership
npx wrangler login                       # login akun fritzyforce; cek: npx wrangler whoami
npx wrangler pages project create ff-membership --production-branch=main    # sekali saja

NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co \
NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable-key> \
npm run deploy:pages                      # = npm run build && wrangler pages deploy out --project-name=ff-membership
```

- Project dengan **Direct Upload** tidak bisa dipindah ke integrasi Git belakangan (⚠️ aturan umum Pages; cek dokumentasi Cloudflare).
  Kalau nanti ingin Git, buat project baru.
- Custom domain tetap lewat Bagian B3–B4.
- Deploy ulang setiap ada perubahan kode.

---

## Bagian F — Template pesan untuk pengurus lama (Jalur 1, opsi b)

Salin, isi nilai dalam `< >`, kirim:

> Halo, aplikasi keanggotaan Fritzy Force akan dipakai di `membership.fritzyforce.my.id`. DNS domain `fritzyforce.my.id` ada di akun Cloudflare Anda.
> Mohon tambahkan record berikut di Cloudflare → `fritzyforce.my.id` → DNS → Records, **tanpa mengubah record lain**:
>
> 1. `CNAME` — Name: `membership` — Target: `ff-membership.pages.dev` — Proxy: Proxied
> 2. `TXT` — Name: `resend._domainkey.membership` — Content: `<nilai dari Resend>`
> 3. `MX` — Name: `send.membership` — Mail server: `<nilai>` — Priority: `<nilai>`
> 4. `TXT` — Name: `send.membership` — Content: `<nilai SPF dari Resend>`
>
> Catatan: record nomor 1 baru boleh dibuat **setelah** saya mengabari bahwa domain sudah ditambahkan di Cloudflare Pages (urutan ini penting). Kalau sudah ada record bernama `membership`, mohon kabari dulu sebelum mengubahnya.
> Selain itu, mohon ekspor zona (DNS → Records → Export) dan kirimkan ke saya sebagai cadangan. Jangka panjang saya ingin DNS dipindah ke akun organisasi; saya akan atur waktunya bersama Anda.

---

## Pemecahan masalah

| Gejala | Penyebab dan solusi |
|---|---|
| **Error 522** di `membership.fritzyforce.my.id` | CNAME dibuat **sebelum** domain ditambahkan di Pages, atau target CNAME salah. Tambahkan domain di Pages (B3), pastikan CNAME menunjuk ke `<project>.pages.dev` yang benar. |
| Status Pages tetap **Verifying/Pending** lama | CNAME belum ada/salah ketik; atau ada record lain di nama `membership` (A/AAAA); atau CAA menghalangi penerbitan sertifikat. Cek `dig CNAME membership.fritzyforce.my.id` dan record CAA (A2). |
| **Error 1014 "CNAME Cross-User Banned"** | CNAME `membership` menunjuk ke hostname milik akun Cloudflare lain, terutama **`*.workers.dev`** (Worker lama). Ganti target ke **`<project>.pages.dev`** (setelah domain ditambahkan di Pages). Bila masih muncul, ubah record ke **DNS only** (awan abu-abu). Kalau tetap gagal, lanjut ke Jalur 2 (pindah zona ke akun fritzyforce). |
| `membership` tidak bisa dibuat karena "record dengan nama itu sudah ada" | Ada record lama di nama `membership` (mis. A ke hosting). Hapus/ganti (catat nilai lama) lalu buat CNAME. |
| Build Pages gagal | Buka log build. Penyebab umum: versi Node (set `NODE_VERSION=20`), variabel build kosong, atau masalah `wrangler.toml` (pakai Bagian E). |
| "Backend belum dikonfigurasi…" / `Invalid API key` | Variabel `NEXT_PUBLIC_*` kosong/salah/tidak ikut build. Perbaiki di Pages › Environment variables lalu **Retry deployment**. |
| Resend **Verify** gagal | Nama record salah/dobel (tulis relatif, mis. `resend._domainkey.membership`), nilai terpotong, atau belum merambat. Pastikan record dipasang di **zona Cloudflare akun lama**, bukan di cPanel. |
| Resend: "recently claimed" | Jeda dari Resend untuk domain yang baru saja di-claim. Tunggu atau hubungi support. |
| Perubahan DNS di cPanel Zone Editor tidak berpengaruh | Benar: nameserver ada di Cloudflare. Ubah DNS di Cloudflare. |
| Setelah pindah nameserver (Jalur 2) situs/email mati | Ada record yang tidak terimpor. Bandingkan dengan D3; bila genting, **rollback** nameserver ke yang lama (D6). |
| Link di email salah domain | `SITE_URL` secret Edge Function belum `https://membership.fritzyforce.my.id` (B6). |
| Tautan konfirmasi/reset ditolak | Site URL / Redirect URLs Supabase belum memuat domain baru (B6). |

## Checklist ringkas (Jalur 1)

- [ ] Akses zona DNS akun lama didapat (atau pengurus lama siap menambah record)
- [ ] Zona diekspor (cadangan) dan record `membership`/CAA diperiksa
- [ ] Aplikasi Cloudflare terpasang di organisasi GitHub `fritzyforce` (owner menyetujui)
- [ ] Project Pages `ff-membership` dibuat dengan build `npm run build` → `out` + env Supabase (project baru) + `NODE_VERSION=20`
- [ ] **Domain ditambahkan di Pages dulu**, baru CNAME `membership` → `ff-membership.pages.dev` dibuat; status **Active**
- [ ] Record Resend dipasang di zona Cloudflare akun lama; domain **Verified**; API key dibuat
- [ ] Supabase: Site URL, Redirect URLs, SMTP, template email; secrets Edge Function + `functions deploy`
- [ ] Akun staf, nomor anggota lama, uji asap lulus
- [ ] Worker lama dimatikan; Redirect URLs lama dibersihkan
- [ ] (Jangka panjang) Zona DNS dipindah ke akun fritzyforce (Jalur 2) dan akun diamankan dengan 2FA + lebih dari satu admin

## Sumber (dokumentasi Cloudflare)

- Custom domains Pages: https://developers.cloudflare.com/pages/configuration/custom-domains/
- GitHub integration Pages: https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/
- Konfigurasi wrangler untuk Pages: https://developers.cloudflare.com/pages/functions/wrangler-configuration/
- Build configuration Pages: https://developers.cloudflare.com/pages/configuration/build-configuration/
- Memindah domain antar akun: https://developers.cloudflare.com/fundamentals/manage-domains/move-domain/
