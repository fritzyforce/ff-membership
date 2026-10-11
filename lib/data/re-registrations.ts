/**
 * Repository registrasi ulang — terhubung ke Supabase (bukan dummy).
 *
 * Semua tulis lewat RPC `security definer` (lihat
 * supabase/migrations/20261011000000_re_registrations.sql). Pesan error dari
 * RPC berupa kode (mis. ALREADY_SUBMITTED) yang dipetakan ke teks Indonesia.
 */
import { DataError } from "@/lib/errors";
import { getProofUrl, uploadProof } from "@/lib/data/proofs";
import { getSupabase } from "@/lib/supabase/client";
import type {
  ReRegistration,
  ReRegistrationPublicStatus,
  ReRegistrationStatus,
} from "@/lib/types";

const ERROR_TEXT: Record<string, string> = {
  INVALID_NAME: "Nama lengkap tidak valid (maksimal 120 karakter).",
  INVALID_EMAIL: "Format email tidak valid.",
  INVALID_LINE_ID: "ID Line tidak valid (maksimal 60 karakter).",
  INVALID_PROOF: "Bukti pembayaran tidak valid. Unggah ulang file JPG/PNG.",
  PROOF_NOT_FOUND: "Bukti pembayaran belum terunggah. Coba kirim ulang.",
  EMAIL_ALREADY_MEMBER: "Email ini sudah terdaftar sebagai anggota. Silakan registrasi akun atau login.",
  ALREADY_SUBMITTED:
    "Email ini sudah punya registrasi ulang yang menunggu review atau sudah disetujui. Cek statusnya dengan kode registrasi.",
  FORBIDDEN: "Kamu tidak punya akses untuk aksi ini. Silakan login ulang sebagai admin.",
  NOT_FOUND: "Data registrasi ulang tidak ditemukan.",
  ALREADY_REVIEWED: "Registrasi ulang ini sudah direview oleh admin lain.",
  MEMBER_NUMBER_EXHAUSTED: "Kuota nomor anggota (FF-001 s/d FF-999) sudah habis. Hubungi pengembang.",
};

const GENERIC_ERROR = "Terjadi kesalahan pada server. Coba lagi beberapa saat.";

function toDataError(error: { message?: string } | null): DataError {
  const code = (error?.message ?? "").trim();
  return new DataError(ERROR_TEXT[code] ?? GENERIC_ERROR);
}

/* ------------------------------------------------------------------ */
/* Mapping baris DB -> tipe aplikasi                                    */
/* ------------------------------------------------------------------ */

interface Row {
  id: string;
  code: string;
  full_name: string;
  email: string;
  line_id: string;
  proof_path: string;
  status: ReRegistrationStatus;
  review_note: string;
  reviewed_at: string | null;
  created_at: string;
  member: { member_number: string } | null;
}

const SELECT = "*, member:members(member_number)";

function fromRow(r: Row): ReRegistration {
  return {
    id: r.id,
    code: r.code,
    fullName: r.full_name,
    email: r.email,
    lineId: r.line_id,
    proofPath: r.proof_path,
    status: r.status,
    reviewNote: r.review_note,
    reviewedAt: r.reviewed_at,
    memberNumber: r.member?.member_number ?? null,
    createdAt: r.created_at,
  };
}

/* ------------------------------------------------------------------ */
/* Publik                                                               */
/* ------------------------------------------------------------------ */

export interface ReRegistrationInput {
  fullName: string;
  email: string;
  lineId: string;
}

/**
 * 1) unggah bukti ke storage (path acak), 2) panggil RPC. Mengembalikan kode.
 * Bila RPC gagal, file yang sudah terunggah menjadi yatim (publik memang tidak
 * boleh menghapus); dibersihkan oleh job pembersihan berkala di fase berikutnya.
 */
export async function submitReRegistration(input: ReRegistrationInput, proof: File) {
  const path = await uploadProof("re-registrations", proof);
  const { data, error } = await getSupabase().rpc("submit_re_registration", {
    p_full_name: input.fullName,
    p_email: input.email,
    p_line_id: input.lineId,
    p_proof_path: path,
  });
  if (error) throw toDataError(error);
  return data as string;
}

interface StatusRow {
  code: string;
  first_name: string;
  status: ReRegistrationStatus;
  member_number: string | null;
  email: string | null;
  created_at: string;
}

export async function getReRegistrationStatus(
  code: string,
): Promise<ReRegistrationPublicStatus | null> {
  const { data, error } = await getSupabase().rpc("get_re_registration_status", { p_code: code });
  if (error) throw toDataError(error);
  const row = (data as StatusRow[] | null)?.[0];
  if (!row) return null;
  return {
    code: row.code,
    firstName: row.first_name,
    status: row.status,
    memberNumber: row.member_number,
    email: row.email,
    createdAt: row.created_at,
  };
}

/* ------------------------------------------------------------------ */
/* Admin                                                                */
/* ------------------------------------------------------------------ */

export interface ListParams {
  page: number;
  pageSize: number;
  status: ReRegistrationStatus | "all";
  query: string;
}

export async function listReRegistrations({ page, pageSize, status, query }: ListParams) {
  const from = (page - 1) * pageSize;
  let q = getSupabase()
    .from("re_registrations")
    .select(SELECT, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);

  if (status !== "all") q = q.eq("status", status);

  // buang karakter yang punya arti khusus di sintaks filter PostgREST / LIKE
  const term = query.replace(/[%_\\",()*]/g, " ").trim();
  if (term) {
    q = q.or(`full_name.ilike."%${term}%",email.ilike."%${term}%",code.ilike."%${term}%"`);
  }

  const { data, error, count } = await q;
  if (error) throw toDataError(error);
  return { rows: (data as Row[]).map(fromRow), total: count ?? 0 };
}

export async function getReRegistration(id: string): Promise<ReRegistration | null> {
  const { data, error } = await getSupabase()
    .from("re_registrations")
    .select(SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) throw toDataError(error);
  return data ? fromRow(data as Row) : null;
}

export { getProofUrl };

/** Mengembalikan nomor anggota yang baru dibuat. */
export async function approveReRegistration(id: string) {
  const { data, error } = await getSupabase().rpc("approve_re_registration", { p_id: id });
  if (error) throw toDataError(error);
  return data as string;
}

/** Catatan opsional; hanya dilihat admin (tidak ditampilkan ke pendaftar). */
export async function rejectReRegistration(id: string, note = "") {
  const { error } = await getSupabase().rpc("reject_re_registration", {
    p_id: id,
    p_note: note,
  });
  if (error) throw toDataError(error);
}
