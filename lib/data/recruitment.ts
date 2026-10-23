/**
 * Repository rekrutmen anggota baru (Join Us) — Supabase.
 *
 * Alur: pendaftar mengirim form (submit_recruitment) -> admin finance pre-approve (+ email) ->
 * pendaftar membayar & mengunggah bukti lewat halaman cek status (submit_recruitment_payment) ->
 * admin finance approve (anggota dibuat; pembayaran = uang kas pertama).
 * Semua tulis lewat RPC security definer (supabase/migrations/20261026000000_recruitment.sql).
 */
import { getProofUrl, uploadProof } from "@/lib/data/proofs";
import { DataError } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase/client";
import type { Recruitment, RecruitmentPublicStatus, RecruitmentStatus } from "@/lib/types";

const ERROR_TEXT: Record<string, string> = {
  INVALID_NAME: "Nama lengkap maksimal 120 karakter.",
  INVALID_NICKNAME: "Nickname tidak valid (maksimal 60 karakter).",
  INVALID_EMAIL: "Format email tidak valid.",
  INVALID_LINE_ID: "ID Line tidak valid (maksimal 60 karakter).",
  INVALID_DOMICILE: "Domisili tidak valid (maksimal 100 karakter).",
  INVALID_REASON: "Alasan bergabung wajib diisi (maksimal 1000 karakter).",
  INVALID_SOCIAL: "Username sosial media maksimal 60 karakter.",
  SOCIAL_REQUIRED: "Isi minimal salah satu akun sosial media (X, Instagram, atau TikTok).",
  EMAIL_ALREADY_MEMBER: "Email ini sudah terdaftar sebagai anggota. Silakan registrasi akun atau login.",
  EMAIL_IN_RE_REGISTRATION: "Email ini sedang dipakai pada registrasi ulang anggota lama. Cek statusnya dengan kode registrasi ulang.",
  ALREADY_SUBMITTED: "Email ini sudah punya pendaftaran yang sedang diproses atau sudah disetujui. Cek statusnya dengan kode pendaftaran.",
  INVALID_PROOF: "Bukti pembayaran tidak valid. Unggah ulang file JPG/PNG.",
  PROOF_NOT_FOUND: "Bukti pembayaran belum terunggah. Coba kirim ulang.",
  NOT_FOUND: "Data pendaftaran tidak ditemukan.",
  NOT_PAYABLE: "Pembayaran belum bisa dikirim: pendaftaranmu belum diterima, atau bukti sudah terkirim.",
  FORBIDDEN: "Hanya Admin Finance atau Superadmin yang bisa melakukan aksi ini. Silakan login ulang.",
  ALREADY_REVIEWED: "Pendaftaran ini sudah diproses oleh admin lain atau statusnya sudah berubah.",
  NOT_PAID: "Pendaftar belum mengirim bukti pembayaran.",
  NOTE_REQUIRED: "Catatan wajib diisi saat menolak bukti pembayaran.",
  MEMBER_NUMBER_EXHAUSTED: "Kuota nomor anggota (FRC-001 s/d FRC-999) sudah habis. Hubungi pengembang.",
};
const GENERIC_ERROR = "Terjadi kesalahan pada server. Coba lagi beberapa saat.";

function toDataError(error: { message?: string } | null): DataError {
  return new DataError(ERROR_TEXT[(error?.message ?? "").trim()] ?? GENERIC_ERROR);
}

/* ------------------------------------------------------------------ */
/* Publik                                                               */
/* ------------------------------------------------------------------ */

export interface RecruitmentInput {
  email: string;
  /** Opsional */
  fullName: string;
  nickname: string;
  lineId: string;
  domicile: string;
  /** Opsional satu per satu, tetapi minimal salah satu wajib diisi */
  socialX: string;
  socialInstagram: string;
  socialTiktok: string;
  reason: string;
}

/** Kirim pendaftaran; mengembalikan kode pendaftaran (REG-XXXX-XXXX). */
export async function submitRecruitment(input: RecruitmentInput): Promise<string> {
  const { data, error } = await getSupabase().rpc("submit_recruitment", {
    p_full_name: input.fullName,
    p_nickname: input.nickname,
    p_email: input.email,
    p_line_id: input.lineId,
    p_domicile: input.domicile,
    p_reason: input.reason,
    p_social_x: input.socialX,
    p_social_instagram: input.socialInstagram,
    p_social_tiktok: input.socialTiktok,
  });
  if (error) throw toDataError(error);
  return data as string;
}

interface StatusRow {
  code: string;
  first_name: string;
  status: RecruitmentStatus;
  member_number: string | null;
  email: string | null;
  payment_note: string;
  amount: number;
  created_at: string;
}

export async function getRecruitmentStatus(code: string): Promise<RecruitmentPublicStatus | null> {
  const { data, error } = await getSupabase().rpc("get_recruitment_status", { p_code: code });
  if (error) throw toDataError(error);
  const row = (data as StatusRow[] | null)?.[0];
  if (!row) return null;
  return {
    code: row.code,
    firstName: row.first_name,
    status: row.status,
    memberNumber: row.member_number,
    email: row.email,
    paymentNote: row.payment_note,
    amount: row.amount,
    createdAt: row.created_at,
  };
}

/** Setelah pre-approved: unggah bukti ke storage (path acak), lalu RPC mengaitkannya ke pendaftaran. */
export async function submitRecruitmentPayment(code: string, proof: File) {
  const path = await uploadProof("recruitment", proof);
  const { error } = await getSupabase().rpc("submit_recruitment_payment", { p_code: code, p_proof_path: path });
  if (error) throw toDataError(error);
}

/* ------------------------------------------------------------------ */
/* Admin                                                                */
/* ------------------------------------------------------------------ */

interface Row {
  id: string;
  code: string;
  full_name: string;
  nickname: string;
  email: string;
  line_id: string;
  domicile: string;
  social_x: string;
  social_instagram: string;
  social_tiktok: string;
  reason: string;
  status: RecruitmentStatus;
  review_note: string;
  payment_note: string;
  proof_path: string | null;
  pre_approved_at: string | null;
  payment_submitted_at: string | null;
  reviewed_at: string | null;
  created_at: string;
  member: { member_number: string } | { member_number: string }[] | null;
}

const SELECT = "*, member:members(member_number)";

function fromRow(r: Row): Recruitment {
  const member = Array.isArray(r.member) ? (r.member[0] ?? null) : r.member;
  return {
    id: r.id,
    code: r.code,
    fullName: r.full_name,
    nickname: r.nickname,
    email: r.email,
    lineId: r.line_id,
    domicile: r.domicile,
    socialX: r.social_x,
    socialInstagram: r.social_instagram,
    socialTiktok: r.social_tiktok,
    reason: r.reason,
    status: r.status,
    reviewNote: r.review_note,
    paymentNote: r.payment_note,
    proofPath: r.proof_path,
    preApprovedAt: r.pre_approved_at,
    paymentSubmittedAt: r.payment_submitted_at,
    reviewedAt: r.reviewed_at,
    memberNumber: member?.member_number ?? null,
    createdAt: r.created_at,
  };
}

export interface RecruitmentListParams {
  page: number;
  pageSize: number;
  status: RecruitmentStatus | "all";
  query: string;
}

export async function listRecruitments({ page, pageSize, status, query }: RecruitmentListParams) {
  const from = (page - 1) * pageSize;
  let q = getSupabase()
    .from("recruitments")
    .select(SELECT, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);
  if (status !== "all") q = q.eq("status", status);

  // buang karakter yang punya arti khusus di sintaks filter PostgREST / LIKE
  const term = query.replace(/[%_\\",()*]/g, " ").trim();
  if (term) {
    q = q.or(`full_name.ilike."%${term}%",nickname.ilike."%${term}%",email.ilike."%${term}%",code.ilike."%${term}%"`);
  }
  const { data, error, count } = await q;
  if (error) throw new DataError("Gagal memuat daftar pendaftar. Coba lagi beberapa saat.");
  return { rows: (data as unknown as Row[]).map(fromRow), total: count ?? 0 };
}

export async function getRecruitment(id: string): Promise<Recruitment | null> {
  const { data, error } = await getSupabase().from("recruitments").select(SELECT).eq("id", id).maybeSingle();
  if (error) throw new DataError("Gagal memuat data pendaftar.");
  return data ? fromRow(data as unknown as Row) : null;
}

export { getProofUrl };

export async function preApproveRecruitment(id: string) {
  const { error } = await getSupabase().rpc("pre_approve_recruitment", { p_id: id });
  if (error) throw toDataError(error);
}

export async function rejectRecruitment(id: string, note = "") {
  const { error } = await getSupabase().rpc("reject_recruitment", { p_id: id, p_note: note });
  if (error) throw toDataError(error);
}

/** Bukti bayar tidak sesuai: pendaftar kembali ke pre-approved dan bisa mengunggah ulang. Catatan tampil ke pendaftar. */
export async function rejectRecruitmentPayment(id: string, note: string) {
  const { error } = await getSupabase().rpc("reject_recruitment_payment", { p_id: id, p_note: note });
  if (error) throw toDataError(error);
}

/** Mengembalikan nomor anggota yang baru dibuat. */
export async function approveRecruitment(id: string) {
  const { data, error } = await getSupabase().rpc("approve_recruitment", { p_id: id });
  if (error) throw toDataError(error);
  return data as string;
}
