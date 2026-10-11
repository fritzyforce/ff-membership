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
  /** Nomor anggota, mis. FF-2026-0417 */
  memberNumber: string;
  source: MemberSource;
  applicantId: string | null;
  fullName: string;
  birthPlace: string;
  birthDate: string;
  address: string;
  socialX: string;
  socialInstagram: string;
  socialTiktok: string;
  email: string;
  phone: string;
  lineId: string;
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
  email: string;
  lineId: string;
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

export type DuesStatus = "processing" | "paid" | "rejected";

/** Pembayaran uang kas (data nyata dari Supabase). */
export interface DuesPayment {
  id: string;
  memberId: string;
  /** Rentang bulan yang ditutup pembayaran ini (YYYY-MM, urut; bisa berselang bila ada bulan yang dibuka lagi) */
  periodFrom: string;
  periodTo: string;
  /** Jumlah bulan = amount / iuran bulanan */
  months: number;
  /** Rupiah */
  amount: number;
  status: DuesStatus;
  /** Path bukti di bucket privat payment-proofs */
  proofPath: string;
  /** Terisi saat rejected */
  reviewNote: string;
  reviewedAt: string | null;
  /** Tanggal verifikasi (WIB), terisi saat paid */
  paidAt: string | null;
  createdAt: string;
  /** Hanya ada pada query admin yang meng-embed anggota */
  member: { memberNumber: string; fullName: string; email: string } | null;
}

/** Ringkasan iuran per anggota (dihitung server). */
export interface DuesSummary {
  /** Bulan pertama yang ditagih (bulan registrasi / registrasi ulang) */
  startPeriod: string;
  /** Bulan yang akan ditutup pembayaran berikutnya (bulan belum tertutup paling awal) */
  nextPeriod: string | null;
  /** Bulan terjauh yang sudah tertutup (termasuk yang masih diverifikasi) */
  coveredThrough: string | null;
  /** Jumlah bulan ≤ bulan berjalan yang belum tertutup */
  arrearsCount: number;
  monthlyAmount: number;
}

export type Role = "member" | "admin" | "superadmin";

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
