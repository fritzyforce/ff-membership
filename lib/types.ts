/**
 * Tipe data utama. Bentuknya sengaja dibuat sama dengan tabel di
 * `supabase/schema.sql` supaya migrasi dari data dummy ke Supabase mulus.
 */

/**
 * Pendaftaran anggota baru (Join Us), data nyata dari Supabase.
 * pending -> pre_approved (admin; email pemberitahuan) -> payment_submitted (pendaftar bayar & unggah bukti)
 * -> approved (anggota dibuat; pembayaran = uang kas pertama) | rejected.
 */
export type RecruitmentStatus = "pending" | "pre_approved" | "payment_submitted" | "approved" | "rejected";

export interface Recruitment {
  id: string;
  /** Kode acak, mis. REG-7K3F-9Q2M */
  code: string;
  /** Opsional; "" bila kosong */
  fullName: string;
  nickname: string;
  email: string;
  lineId: string;
  domicile: string;
  socialX: string;
  socialInstagram: string;
  socialTiktok: string;
  /** Alasan bergabung dengan Fritzy Force */
  reason: string;
  status: RecruitmentStatus;
  /** Catatan admin (tidak tampil ke pendaftar) */
  reviewNote: string;
  /** Alasan bukti bayar ditolak (tampil ke pendaftar) */
  paymentNote: string;
  /** Path bukti bayar di bucket privat payment-proofs; null sebelum membayar */
  proofPath: string | null;
  preApprovedAt: string | null;
  paymentSubmittedAt: string | null;
  reviewedAt: string | null;
  /** Diisi saat approved */
  memberNumber: string | null;
  createdAt: string;
}

/** Hasil cek status publik (data minimal). */
export interface RecruitmentPublicStatus {
  code: string;
  firstName: string;
  status: RecruitmentStatus;
  memberNumber: string | null;
  /** Hanya terisi bila approved: untuk mengisi otomatis halaman Registrasi Akun */
  email: string | null;
  /** Alasan bukti bayar sebelumnya ditolak */
  paymentNote: string;
  /** Iuran 1 bulan (rupiah), dari database */
  amount: number;
  createdAt: string;
}

export type MemberStatus = "active" | "revoked" | "inactive";

/** Asal keanggotaan: rekrutmen baru atau registrasi ulang anggota lama. */
export type MemberSource = "recruitment" | "re_registration";

export interface Member {
  id: string;
  /** Nomor anggota, mis. FRC-017 */
  memberNumber: string;
  source: MemberSource;
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
export type OldMemberNumberStatus = "ok" | "not_found" | "ambiguous" | "registered" | "in_use";

/** Baris daftar nomor anggota lama (admin). */
export interface LegacyMember {
  id: string;
  /** Nomor anggota lama; null untuk anggota "reset" / "ex admin" */
  oldMemberNumber: string | null;
  /** Nama anggota / admin (opsional) */
  memberName: string;
  /** Catatan status, mis. "reset" atau "ex admin" */
  note: string;
  /** Kelebihan bayar kas dari data lama, dalam bulan (0–12) */
  prepaidMonths: number;
  /** Display name Line (bukan ID Line); dipakai mencari nomor lewat form registrasi ulang */
  lineDisplayName: string;
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
 *  - recruitment: pembayaran pendaftaran anggota baru (uang kas pertama)
 */
export type DuesSource = "member" | "re_registration" | "legacy_credit" | "recruitment";

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
