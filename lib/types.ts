/**
 * Tipe data utama. Bentuknya sengaja dibuat sama dengan tabel di
 * `supabase/schema.sql` supaya migrasi dari data dummy ke Supabase mulus.
 */

export type ApplicantStatus =
  | "pending" // menunggu review admin
  | "pre_approved" // lolos review, menunggu pembayaran uang kas
  | "payment_submitted" // bukti bayar sudah dikirim, menunggu verifikasi
  | "approved" // resmi jadi anggota
  | "rejected";

export interface Applicant {
  id: string;
  /** Kode pendaftaran, mis. REG-2026-0417 */
  code: string;
  fullName: string;
  birthPlace: string;
  /** ISO date (YYYY-MM-DD) */
  birthDate: string;
  address: string;
  socialX: string;
  socialInstagram: string;
  socialTiktok: string;
  email: string;
  phone: string;
  lineId: string;
  status: ApplicantStatus;
  reviewNote: string;
  /** Nama file bukti bayar uang kas pendaftaran */
  paymentProof: string | null;
  /** Diisi saat status approved */
  memberNumber: string | null;
  createdAt: string;
}

export type MemberStatus = "active" | "revoked" | "inactive";

/** Asal keanggotaan: rekrutmen baru atau registrasi ulang anggota lama. */
export type MemberSource = "recruitment" | "re_registration";

export interface Member {
  id: string;
  /** Nomor anggota, mis. FF-017 */
  memberNumber: string;
  source: MemberSource;
  applicantId: string | null;
  fullName: string;
  nickname: string;
  domicile: string;
  /** Opsional; "" bila kosong */
  birthDate: string;
  address: string;
  socialX: string;
  socialInstagram: string;
  socialTiktok: string;
  email: string;
  lineId: string;
  /** Nomor anggota lama (hanya anggota hasil registrasi ulang) */
  oldMemberNumber: string | null;
  status: MemberStatus;
  joinedAt: string;
  /** Bulan pertama yang ditagih uang kas (YYYY-MM) */
  duesStartPeriod: string;
}

/**
 * Registrasi ulang anggota lama (data nyata dari Supabase).
 * pending -> admin review -> approved (anggota dibuat) | rejected (wajib catatan).
 */
export type ReRegistrationStatus = "pending" | "approved" | "rejected";

export interface ReRegistration {
  id: string;
  /** Kode acak, mis. RU-7K3F-9Q2M */
  code: string;
  fullName: string;
  nickname: string;
  email: string;
  lineId: string;
  domicile: string;
  /** Opsional; "" bila kosong */
  socialX: string;
  socialInstagram: string;
  socialTiktok: string;
  address: string;
  /** ISO date (YYYY-MM-DD) atau "" */
  birthDate: string;
  /** Nomor anggota lama yang diklaim pendaftar (null pada baris sebelum field ini ada) */
  oldMemberNumber: string | null;
  /** Path bukti bayar di bucket privat payment-proofs */
  proofPath: string;
  status: ReRegistrationStatus;
  reviewNote: string;
  reviewedAt: string | null;
  /** Diisi saat approved */
  memberNumber: string | null;
  createdAt: string;
}

/** Hasil cek status publik (data minimal). */
export interface ReRegistrationPublicStatus {
  code: string;
  firstName: string;
  status: ReRegistrationStatus;
  memberNumber: string | null;
  /** Hanya terisi bila approved: dipakai mengisi otomatis halaman Registrasi Akun */
  email: string | null;
  createdAt: string;
}

/** Hasil pengecekan nomor anggota lama: ok = ada & belum registrasi ulang. */
export type OldMemberNumberStatus = "ok" | "not_found" | "registered" | "in_use";

/** Baris daftar nomor anggota lama (admin). */
export interface LegacyMember {
  oldMemberNumber: string;
  /** Kelebihan bayar kas dari data lama, dalam bulan (0–12) */
  prepaidMonths: number;
  isRegistered: boolean;
  registeredAt: string | null;
  /** Anggota hasil registrasi ulang yang memakai nomor ini */
  member: { memberNumber: string; fullName: string } | null;
  createdAt: string;
}

export type DuesStatus = "processing" | "paid" | "rejected";

/**
 * Asal pembayaran uang kas:
 *  - member: anggota mengajukan lewat /akun/bayar
 *  - re_registration: pembayaran registrasi ulang, dihitung sebagai kas bulan registrasi
 *  - legacy_credit: kelebihan bayar kas dari data lama (tanpa bukti)
 */
export type DuesSource = "member" | "re_registration" | "legacy_credit";

/** Pembayaran uang kas (data nyata dari Supabase). */
export interface DuesPayment {
  id: string;
  memberId: string;
  /** Rentang bulan yang dibayar pembayaran ini (YYYY-MM, urut; bisa berselang bila ada bulan yang dibuka lagi) */
  periodFrom: string;
  periodTo: string;
  /** Jumlah bulan = amount / iuran bulanan */
  months: number;
  /** Rupiah */
  amount: number;
  status: DuesStatus;
  source: DuesSource;
  /** Bulan-bulan (YYYY-MM, urut) yang dibayar pembayaran ini; kosong bila tidak dimuat */
  periods: string[];
  /** Path bukti di bucket privat payment-proofs; null untuk kelebihan bayar data lama */
  proofPath: string | null;
  /** Terisi saat rejected */
  reviewNote: string;
  /** Waktu approve / reject */
  reviewedAt: string | null;
  /** TANGGAL BAYAR (WIB): kapan pembayaran dilakukan/diajukan */
  paidOn: string;
  /** TANGGAL APPROVE (WIB), terisi saat paid */
  paidAt: string | null;
  createdAt: string;
  /** Hanya ada pada query admin yang meng-embed anggota */
  member: { memberNumber: string; fullName: string; email: string } | null;
}

/** Ringkasan iuran per anggota (dihitung server). */
export interface DuesSummary {
  /** Bulan pertama yang ditagih (bulan registrasi / registrasi ulang) */
  startPeriod: string;
  /** Bulan yang akan dibayar pembayaran berikutnya (bulan belum dibayar paling awal) */
  nextPeriod: string | null;
  /** Bulan terjauh yang sudah dibayar (termasuk yang masih diverifikasi) */
  coveredThrough: string | null;
  /** Jumlah bulan ≤ bulan berjalan yang belum dibayar */
  arrearsCount: number;
  monthlyAmount: number;
}

export type Role = "member" | "admin" | "admin_finance" | "superadmin";

export interface Account {
  id: string;
  email: string;
  /** Hanya untuk data dummy — Supabase Auth yang menyimpan password nanti. */
  password: string;
  role: Role;
  memberId: string | null;
  displayName: string;
  active: boolean;
}

export type Session = Omit<Account, "password">;
