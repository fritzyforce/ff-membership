/**
 * Daftar nomor anggota lama (admin) — Supabase.
 *
 * Tabel `legacy_members` berisi nomor anggota lama, kelebihan bayar kas (`prepaid_months`, dalam
 * bulan) dan flag `is_registered` (sudah registrasi ulang atau belum). Flag menjadi true saat admin APPROVE
 * registrasi ulang yang memakai nomor itu. Form registrasi ulang hanya menerima
 * nomor yang ada di daftar ini dan belum registered (dicek ulang di server).
 */
import { DataError } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase/client";
import type { LegacyMember } from "@/lib/types";

const ERROR_TEXT: Record<string, string> = {
  FORBIDDEN: "Kamu tidak punya akses untuk aksi ini. Silakan login ulang sebagai admin.",
  EMPTY_LIST: "Masukkan minimal satu nomor anggota lama.",
  TOO_MANY: "Terlalu banyak nomor sekaligus (maksimal 5.000 per impor).",
};

function toDataError(error: { message?: string } | null, fallback: string): DataError {
  return new DataError(ERROR_TEXT[(error?.message ?? "").trim()] ?? fallback);
}

interface Row {
  old_member_number: string;
  prepaid_months: number;
  line_display_name: string;
  is_registered: boolean;
  registered_at: string | null;
  created_at: string;
  member: { member_number: string; full_name: string } | { member_number: string; full_name: string }[] | null;
}

function fromRow(r: Row): LegacyMember {
  // relasi one-to-one kadang dikembalikan sebagai array oleh PostgREST
  const member = Array.isArray(r.member) ? (r.member[0] ?? null) : r.member;
  return {
    oldMemberNumber: r.old_member_number,
    prepaidMonths: r.prepaid_months,
    lineDisplayName: r.line_display_name,
    isRegistered: r.is_registered,
    registeredAt: r.registered_at,
    createdAt: r.created_at,
    member: member ? { memberNumber: member.member_number, fullName: member.full_name } : null,
  };
}

export type LegacyFilter = "all" | "registered" | "unregistered";

export interface LegacyListParams {
  page: number;
  pageSize: number;
  filter: LegacyFilter;
  query: string;
}

export async function listLegacyMembers({ page, pageSize, filter, query }: LegacyListParams) {
  const from = (page - 1) * pageSize;
  let q = getSupabase()
    .from("legacy_members")
    .select("*, member:members(member_number, full_name)", { count: "exact" })
    .order("old_member_number", { ascending: true })
    .range(from, from + pageSize - 1);
  if (filter !== "all") q = q.eq("is_registered", filter === "registered");

  // buang karakter yang punya arti khusus di sintaks filter PostgREST / LIKE
  const term = query.replace(/[%_\\",()*]/g, " ").trim();
  if (term) q = q.or(`old_member_number.ilike."%${term}%",line_display_name.ilike."%${term}%"`);

  const { data, error, count } = await q;
  if (error) throw new DataError("Gagal memuat daftar nomor anggota lama.");
  return { rows: (data as unknown as Row[]).map(fromRow), total: count ?? 0 };
}

export interface LegacyCounts {
  total: number;
  registered: number;
  unregistered: number;
}

export async function getLegacyCounts(): Promise<LegacyCounts> {
  const sb = getSupabase();
  const count = async (registered?: boolean) => {
    let q = sb.from("legacy_members").select("old_member_number", { count: "exact", head: true });
    if (registered !== undefined) q = q.eq("is_registered", registered);
    const { count: n, error } = await q;
    if (error) throw new DataError("Gagal memuat ringkasan nomor anggota lama.");
    return n ?? 0;
  };
  const [total, registered] = await Promise.all([count(), count(true)]);
  return { total, registered, unregistered: total - registered };
}

export interface AddLegacyResult {
  added: number;
  /** Nomor yang sudah ada & belum registrasi ulang, kelebihan bayarnya diperbarui */
  updated: number;
  duplicate: number;
  invalid: number;
}

export interface LegacyInputRow {
  number: string;
  /** Kelebihan bayar (bulan). Dikosongkan = tidak diubah (nomor baru: 0). */
  prepaid?: string;
  /** Display name Line. Dikosongkan = tidak diubah. */
  line_name?: string;
}

/**
 * Teks tempelan: satu baris per anggota, `NOMOR, kelebihan bayar (bulan), display name Line`, dipisah
 * koma / titik koma / tab (bisa ditempel langsung dari Excel / Sheets). Kolom ke-2 dan ke-3 opsional;
 * kolom ke-3 mengambil sisa baris, jadi display name boleh mengandung koma. Contoh: `OLD-001, 2, Budi Santoso`
 * atau (tanpa kelebihan bayar) `OLD-002, , Siti Aminah`.
 */
export function parseLegacyRows(text: string): LegacyInputRow[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.split(/[,;\t]/).map((s) => s.trim()))
    .filter(([number]) => number)
    .map(([number, prepaid, ...rest]) => {
      const row: LegacyInputRow = { number };
      if (prepaid) row.prepaid = prepaid;
      const lineName = rest.join(", ").trim();
      if (lineName) row.line_name = lineName;
      return row;
    });
}

export async function addLegacyMembers(rows: LegacyInputRow[]): Promise<AddLegacyResult> {
  const { data, error } = await getSupabase().rpc("admin_add_legacy_members", { p_rows: rows });
  if (error) throw toDataError(error, "Gagal menambahkan nomor anggota lama.");
  return data as AddLegacyResult;
}
