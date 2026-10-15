// Seed data DEV untuk Supabase LOKAL: akun admin, anggota contoh + akun member, registrasi ulang, uang kas.
//
//   npm run db:seed      (membaca .env.local)
//
// Memakai service role key (bypass RLS) — jangan pernah dijalankan ke project
// produksi. Script menolak host selain localhost kecuali ALLOW_REMOTE_SEED=1.
import { deflateSync } from "node:zlib";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY wajib diisi di .env.local");
  process.exit(1);
}
const host = new URL(url).hostname;
if (!["127.0.0.1", "localhost", "[::1]"].includes(host) && process.env.ALLOW_REMOTE_SEED !== "1") {
  console.error(`Menolak seed ke host non-lokal "${host}". Set ALLOW_REMOTE_SEED=1 bila memang disengaja.`);
  process.exit(1);
}

const sb = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

/* ----------------------------------------------------------- admin accounts */

const ADMINS = [
  // Password mengikuti kebijakan server: huruf besar + kecil + angka, min 8.
  { email: "superadmin@fritzyforce.test", password: "Superadmin123", role: "superadmin", name: "Super Admin" },
  { email: "admin@fritzyforce.test", password: "Admin12345", role: "admin", name: "Admin" },
  { email: "finance@fritzyforce.test", password: "Finance12345", role: "admin_finance", name: "Admin Finance" },
];

async function findUserByEmail(email) {
  for (let page = 1; page < 20; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function seedAdmins() {
  for (const a of ADMINS) {
    let user = await findUserByEmail(a.email);
    if (user) {
      const { error } = await sb.auth.admin.updateUserById(user.id, { password: a.password, email_confirm: true });
      if (error) throw error;
    } else {
      // Daftarkan dulu di account_provisioning (sekali pakai); trigger sign-up akan
      // membuat profile ber-role admin & menghapus baris ini saat user dibuat.
      const { error: pErr } = await sb.from("account_provisioning")
        .upsert({ email: a.email, role: a.role, display_name: a.name });
      if (pErr) throw pErr;
      const { data, error } = await sb.auth.admin.createUser({ email: a.email, password: a.password, email_confirm: true });
      if (error) throw error;
      user = data.user;
    }
    // idempotent untuk run ulang / user lama tanpa profile
    const { error } = await sb.from("profiles").upsert({ id: user.id, role: a.role, display_name: a.name, active: true });
    if (error) throw error;
    console.log(`✓ admin  ${a.role.padEnd(10)} ${a.email}`);
  }
  return (await findUserByEmail(ADMINS[0].email)).id;
}

/* ------------------------------------------------------ dummy bukti bayar PNG */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** Gambar "struk" sederhana (header berwarna + baris abu-abu) — hanya untuk dev. */
function fakeReceipt(tint) {
  const w = 360, h = 240, stride = w * 3 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < w; x++) {
      let px = [255, 255, 255];
      if (y < 44) px = tint;
      const line = y >= 76 && y < 190 && (y - 76) % 28 < 8 && x > 24 && x < w - 24 - ((y * 7) % 90);
      if (line) px = [200, 200, 205];
      if (y >= 200 && y < 214 && x > 180 && x < w - 24) px = [60, 60, 70];
      raw.set(px, y * stride + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function uploadProof(tint, folder = "re-registrations") {
  const path = `${folder}/${randomUUID()}.png`;
  const { error } = await sb.storage.from("payment-proofs").upload(path, fakeReceipt(tint), { contentType: "image/png" });
  if (error) throw error;
  return path;
}

/* ------------------------------------------------------------ re-registrations */

/* ---------------------------------------------------- nomor anggota lama */

// Daftar nomor anggota lama (tabel legacy_members). OLD-001..OLD-006 dipakai contoh di bawah;
// sisanya tetap "belum registrasi ulang" sehingga bisa dipakai menguji form /registrasi-ulang/.
const LEGACY_NUMBERS = Array.from({ length: 10 }, (_, i) => `OLD-${String(i + 1).padStart(3, "0")}`);

async function seedLegacyMembers() {
  const { error } = await sb.from("legacy_members")
    .upsert(LEGACY_NUMBERS.map((old_member_number) => ({ old_member_number })), { onConflict: "old_member_number", ignoreDuplicates: true });
  if (error) throw error;
  console.log(`✓ nomor anggota lama  ${LEGACY_NUMBERS[0]} … ${LEGACY_NUMBERS.at(-1)}`);
}

/* ------------------------------------------------------------ re-registrations */

const SAMPLES = [
  { name: "Rizky Aditya", nick: "Rizky", socialInstagram: "@rizky", email: "rizky.aditya@fritzyforce.test", line: "rizky.aditya", domicile: "Jakarta", old: "OLD-001", status: "pending", tint: [138, 76, 252] },
  { name: "Sari Wulandari", nick: "Sari", email: "sari.wulandari@fritzyforce.test", line: "sari.wulandari", domicile: "Bandung", old: "OLD-002", status: "pending", tint: [214, 179, 93],
    socialInstagram: "@sariw", address: "Jl. Merdeka No. 10, Bandung", birthDate: "1998-06-21" },
  // approved + sudah punya akun (login: Member12345)
  { name: "Teguh Prakoso", nick: "Teguh", socialInstagram: "@teguh", email: "teguh.prakoso@fritzyforce.test", line: "teguh.prakoso", domicile: "Surabaya", old: "OLD-003", status: "approved", tint: [74, 21, 75], account: "Member12345" },
  // approved tapi BELUM punya akun -> bisa dipakai menguji halaman Register
  { name: "Wulan Sari", nick: "Wulan", email: "wulan.sari@fritzyforce.test", line: "wulan.sari", domicile: "Depok", old: "OLD-004", status: "approved", tint: [60, 90, 160],
    socialX: "@wulan", socialTiktok: "@wulan.sari" },
  { name: "Dewi Anggraini", nick: "Dewi", socialInstagram: "@dewi", email: "dewi.anggraini@fritzyforce.test", line: "dewi.angg", domicile: "Bekasi", old: "OLD-005", status: "rejected", tint: [157, 24, 76], note: "Bukti pembayaran tidak terbaca, mohon unggah ulang." },
  { name: "Bayu Pratama", nick: "Bayu", socialInstagram: "@bayu", email: "bayu.pratama@fritzyforce.test", line: "bayu.pratama", domicile: "Semarang", old: "OLD-006", status: "pending", tint: [90, 140, 90] },
];

async function seedReRegistrations(reviewerId) {
  for (const s of SAMPLES) {
    const { data: existing } = await sb.from("re_registrations").select("id").eq("email", s.email).maybeSingle();
    if (existing) {
      console.log(`· skip   ${s.email} (sudah ada)`);
      continue;
    }
    const proofPath = await uploadProof(s.tint);
    const { data: code, error } = await sb.rpc("submit_re_registration", {
      p_full_name: s.name, p_nickname: s.nick, p_email: s.email, p_line_id: s.line,
      p_domicile: s.domicile, p_old_member_number: s.old, p_proof_path: proofPath,
      p_social_x: s.socialX ?? "", p_social_instagram: s.socialInstagram ?? "", p_social_tiktok: s.socialTiktok ?? "",
      p_address: s.address ?? "", p_birth_date: s.birthDate ?? null,
    });
    if (error) throw error;

    if (s.status === "approved") {
      const { data: number, error: nErr } = await sb.rpc("next_member_number");
      if (nErr) throw nErr;
      const { data: member, error: mErr } = await sb.from("members")
        .insert({
          member_number: number, source: "re_registration", full_name: s.name, nickname: s.nick, email: s.email,
          line_id: s.line, domicile: s.domicile, old_member_number: s.old,
          social_x: s.socialX ?? "", social_instagram: s.socialInstagram ?? "", social_tiktok: s.socialTiktok ?? "",
          address: s.address ?? "", birth_date: s.birthDate ?? null,
        })
        .select("id").single();
      if (mErr) throw mErr;
      const { error: lErr } = await sb.from("legacy_members")
        .update({ is_registered: true, member_id: member.id, registered_at: new Date().toISOString() })
        .eq("old_member_number", s.old);
      if (lErr) throw lErr;
      const { error: uErr } = await sb.from("re_registrations")
        .update({ status: "approved", member_id: member.id, reviewed_by: reviewerId, reviewed_at: new Date().toISOString() })
        .eq("code", code);
      if (uErr) throw uErr;
      if (s.account) {
        // trigger handle_new_auth_user menautkan profile ke anggota berdasarkan email
        const { error: aErr } = await sb.auth.admin.createUser({ email: s.email, password: s.account, email_confirm: true });
        if (aErr) throw aErr;
      }
    } else if (s.status === "rejected") {
      const { error: uErr } = await sb.from("re_registrations")
        .update({ status: "rejected", review_note: s.note, reviewed_by: reviewerId, reviewed_at: new Date().toISOString() })
        .eq("code", code);
      if (uErr) throw uErr;
    }
    console.log(`✓ re-reg ${s.status.padEnd(9)} ${code}  ${s.email}${s.account ? "  (+akun)" : ""}`);
  }
}

/* ------------------------------------------------------------------ uang kas */

/** Periode "YYYY-MM" (WIB) dengan offset bulan dari sekarang. */
function period(offset) {
  const now = new Date(Date.now() + 7 * 3600 * 1000); // geser ke WIB, baca bagian UTC
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const MONTHLY = 20000;

// Model per-bulan: tiap pembayaran menutup `months` bulan berurutan mulai dari `from` (offset
// dari bulan ini). `startOffset` = bulan pertama yang ditagih untuk anggota tsb.
const DUES_SAMPLES = [
  // Teguh: ditagih sejak 3 bulan lalu, sudah lunas 3 bulan + bulan ini sedang diverifikasi => tanpa tunggakan
  { email: "teguh.prakoso@fritzyforce.test", startOffset: -3, items: [
    { from: -3, months: 3, status: "paid", tint: [74, 21, 75] },
    { from: 0, months: 1, status: "processing", tint: [138, 76, 252] },
  ] },
  // Wulan: ditagih sejak 3 bulan lalu; satu pembayaran ditolak lalu diajukan ulang untuk bulan pertama
  // (diverifikasi) => tunggakan 3 bulan berikutnya, pembayaran selanjutnya akan mulai dari situ
  { email: "wulan.sari@fritzyforce.test", startOffset: -3, items: [
    { from: -3, months: 1, status: "rejected", tint: [157, 24, 76], note: "Bukti buram, mohon unggah ulang dengan foto yang jelas." },
    { from: -3, months: 1, status: "processing", tint: [60, 90, 160] },
  ] },
];

function monthsFrom(offset, count) {
  return Array.from({ length: count }, (_, i) => period(offset + i));
}

async function seedDues(reviewerId) {
  for (const sample of DUES_SAMPLES) {
    const { data: member } = await sb.from("members").select("id").eq("email", sample.email).maybeSingle();
    if (!member) continue;
    const { count } = await sb.from("dues_payments").select("id", { count: "exact", head: true }).eq("member_id", member.id);
    if (count) {
      console.log(`· skip   uang kas ${sample.email} (sudah ada)`);
      continue;
    }
    // bulan awal penagihan (default-nya bulan registrasi = bulan ini)
    const { error: sErr } = await sb.from("members").update({ dues_start_period: period(sample.startOffset) }).eq("id", member.id);
    if (sErr) throw sErr;

    for (const it of sample.items) {
      const periods = monthsFrom(it.from, it.months);
      const proofPath = await uploadProof(it.tint, `dues/${member.id}`);
      const reviewed = it.status !== "processing";
      const { data: pay, error } = await sb.from("dues_payments").insert({
        member_id: member.id, amount: it.months * MONTHLY, status: it.status, proof_path: proofPath,
        period_from: periods[0], period_to: periods[periods.length - 1], months: it.months,
        review_note: it.note ?? "",
        reviewed_by: reviewed ? reviewerId : null,
        reviewed_at: reviewed ? new Date().toISOString() : null,
        paid_at: it.status === "paid" ? new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10) : null,
      }).select("id").single();
      if (error) throw error;
      const { error: mErr } = await sb.from("dues_payment_months").insert(
        periods.map((p) => ({ payment_id: pay.id, member_id: member.id, period: p, active: it.status !== "rejected" })),
      );
      if (mErr) throw mErr;
    }
    console.log(`✓ uang kas ${sample.email}: ${sample.items.map((i) => `${i.months}bln ${i.status}`).join(", ")}`);
  }
}

const reviewerId = await seedAdmins();
await seedLegacyMembers();
await seedReRegistrations(reviewerId);
await seedDues(reviewerId);
console.log("Selesai.");
