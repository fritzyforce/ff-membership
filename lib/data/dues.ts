/**
 * Repository uang kas (Supabase). Anggota: lihat & ajukan pembayaran sendiri.
 * Admin: daftar semua, cek bukti, approve / reject. Semua tulis lewat RPC.
 */
import { getProofUrl, uploadProof } from "@/lib/data/proofs";
import { DataError } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase/client";
import type { DuesPayment, DuesStatus, DuesSummary } from "@/lib/types";

const ERROR_TEXT: Record<string, string> = {
  INVALID_AMOUNT: "Nominal harus kelipatan iuran bulanan (minimal 1 bulan).",
  TOO_FAR_AHEAD: "Pembayaran di muka maksimal 12 bulan dari bulan berjalan.",
  INVALID_PROOF: "Bukti pembayaran tidak valid. Unggah ulang file JPG/PNG.",
  PROOF_NOT_FOUND: "Bukti pembayaran belum terunggah. Coba kirim ulang.",
  ALREADY_SUBMITTED: "Bukti pembayaran ini sudah pernah dikirim. Pilih file bukti yang berbeda.",
  FORBIDDEN: "Keanggotaanmu tidak aktif atau kamu perlu login ulang.",
  NOT_FOUND: "Data pembayaran tidak ditemukan.",
  ALREADY_REVIEWED: "Pembayaran ini sudah direview oleh admin lain.",
  NOTE_REQUIRED: "Catatan wajib diisi saat menolak pembayaran.",
};
const GENERIC_ERROR = "Terjadi kesalahan pada server. Coba lagi beberapa saat.";

function toDataError(error: { message?: string } | null): DataError {
  return new DataError(ERROR_TEXT[(error?.message ?? "").trim()] ?? GENERIC_ERROR);
}

interface Row {
  id: string;
  member_id: string;
  period_from: string;
  period_to: string;
  months: number;
  amount: number;
  status: DuesStatus;
  proof_path: string;
  review_note: string;
  reviewed_at: string | null;
  paid_at: string | null;
  created_at: string;
  member?: { member_number: string; full_name: string; email: string } | null;
}

function fromRow(r: Row): DuesPayment {
  return {
    id: r.id,
    memberId: r.member_id,
    periodFrom: r.period_from,
    periodTo: r.period_to,
    months: r.months,
    amount: r.amount,
    status: r.status,
    proofPath: r.proof_path,
    reviewNote: r.review_note,
    reviewedAt: r.reviewed_at,
    paidAt: r.paid_at,
    createdAt: r.created_at,
    member: r.member
      ? { memberNumber: r.member.member_number, fullName: r.member.full_name, email: r.member.email }
      : null,
  };
}

/* ------------------------------------------------------------------ */
/* Anggota                                                              */
/* ------------------------------------------------------------------ */

/** Riwayat uang kas milik anggota yang login (RLS membatasi ke barisnya sendiri). */
export async function listMyDues(): Promise<DuesPayment[]> {
  const { data, error } = await getSupabase()
    .from("dues_payments")
    .select("*")
    .order("period_from", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new DataError("Gagal memuat riwayat uang kas. Coba lagi beberapa saat.");
  return (data as Row[]).map(fromRow);
}

/** Iuran per bulan (app_settings) — sumber kebenaran ada di database. */
export async function getMonthlyAmount(): Promise<number> {
  const { data, error } = await getSupabase()
    .from("app_settings")
    .select("value")
    .eq("key", "dues_monthly_amount")
    .maybeSingle<{ value: number }>();
  if (error || !data) throw new DataError("Gagal memuat nominal iuran. Coba lagi beberapa saat.");
  return Number(data.value);
}

interface SummaryRow {
  start_period: string;
  next_period: string | null;
  covered_through: string | null;
  arrears_count: number;
  monthly_amount: number;
}

/** Ringkasan iuran. Tanpa memberId = anggota yang login; dengan memberId = admin. */
export async function getDuesSummary(memberId?: string): Promise<DuesSummary> {
  const { data, error } = await getSupabase().rpc("get_dues_summary", { p_member_id: memberId ?? null });
  if (error) throw toDataError(error);
  const r = (data as SummaryRow[])[0];
  if (!r) throw new DataError("Data iuran tidak ditemukan.");
  return {
    startPeriod: r.start_period,
    nextPeriod: r.next_period,
    coveredThrough: r.covered_through,
    arrearsCount: r.arrears_count,
    monthlyAmount: r.monthly_amount,
  };
}

/** Bulan-bulan yang akan tertutup oleh nominal ini (dihitung server, urut dari tunggakan paling awal). */
export async function previewDues(amount: number): Promise<string[]> {
  const { data, error } = await getSupabase().rpc("preview_dues_payment", { p_amount: amount });
  if (error) throw toDataError(error);
  return data as string[];
}

/** 1) unggah bukti ke folder anggota, 2) RPC submit_dues_payment (server memilih bulannya). */
export async function submitDues(memberId: string, amount: number, proof: File) {
  const path = await uploadProof(`dues/${memberId}`, proof);
  const { error } = await getSupabase().rpc("submit_dues_payment", { p_amount: amount, p_proof_path: path });
  if (error) throw toDataError(error);
}

/* ------------------------------------------------------------------ */
/* Admin                                                                */
/* ------------------------------------------------------------------ */

const SELECT_WITH_MEMBER = "*, member:members!inner(member_number, full_name, email)";

export interface DuesListParams {
  page: number;
  pageSize: number;
  status: DuesStatus | "all";
  query: string;
}

export async function listDues({ page, pageSize, status, query }: DuesListParams) {
  const from = (page - 1) * pageSize;
  let q = getSupabase()
    .from("dues_payments")
    .select(SELECT_WITH_MEMBER, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);
  if (status !== "all") q = q.eq("status", status);

  // buang karakter yang punya arti khusus di sintaks filter PostgREST / LIKE
  const term = query.replace(/[%_\\",()*]/g, " ").trim();
  if (term) {
    q = q.or(`full_name.ilike."%${term}%",member_number.ilike."%${term}%",email.ilike."%${term}%"`, {
      referencedTable: "member",
    });
  }
  const { data, error, count } = await q;
  if (error) throw new DataError("Gagal memuat daftar pembayaran. Coba lagi beberapa saat.");
  return { rows: (data as unknown as Row[]).map(fromRow), total: count ?? 0 };
}

export async function getDues(id: string): Promise<DuesPayment | null> {
  const { data, error } = await getSupabase()
    .from("dues_payments")
    .select(SELECT_WITH_MEMBER)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new DataError("Gagal memuat data pembayaran.");
  return data ? fromRow(data as unknown as Row) : null;
}

/** Riwayat uang kas satu anggota (untuk halaman detail anggota di admin). */
export async function listDuesByMember(memberId: string): Promise<DuesPayment[]> {
  const { data, error } = await getSupabase()
    .from("dues_payments")
    .select("*")
    .eq("member_id", memberId)
    .order("period_from", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new DataError("Gagal memuat riwayat uang kas.");
  return (data as Row[]).map(fromRow);
}

export async function approveDues(id: string) {
  const { error } = await getSupabase().rpc("approve_dues_payment", { p_id: id });
  if (error) throw toDataError(error);
}

export async function rejectDues(id: string, note: string) {
  const { error } = await getSupabase().rpc("reject_dues_payment", { p_id: id, p_note: note });
  if (error) throw toDataError(error);
}

export { getProofUrl };
