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
  id: string;
  old_member_number: string | null;
  member_name: string;
  note: string;
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
    id: r.id,
    oldMemberNumber: r.old_member_number,
    memberName: r.member_name,
    note: r.note,
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
    // dua relasi ke members (member_id dan old_member_number) -> sebut FK-nya supaya tidak ambigu
    .select("*, member:members!legacy_members_member_id_fkey(member_number, full_name)", { count: "exact" })
    .order("line_display_name", { ascending: true })
    .range(from, from + pageSize - 1);
  if (filter !== "all") q = q.eq("is_registered", filter === "registered");

  // buang karakter yang punya arti khusus di sintaks filter PostgREST / LIKE
  const term = query.replace(/[%_\\",()*]/g, " ").trim();
  if (term) {
    q = q.or(
      `line_display_name.ilike."%${term}%",member_name.ilike."%${term}%",old_member_number.ilike."%${term}%",note.ilike."%${term}%"`,
    );
  }

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
    let q = sb.from("legacy_members").select("id", { count: "exact", head: true });
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
  /** Nama anggota / admin (opsional) */
  name?: string;
  /** Display name Line (WAJIB; kunci baris) */
  line_name: string;
  /** Nomor anggota lama (opsional; kosong untuk anggota reset / ex admin) */
  number?: string;
  /** Lebih bayar (bulan). Dikosongkan = tidak diubah (baris baru: 0). */
  prepaid?: string;
  /** Catatan, mis. "reset" / "ex admin" */
  note?: string;
}

/**
 * Teks tempelan dari Excel / Sheets, satu baris per anggota, kolom dipisah TAB (atau titik koma):
 *   Nama Anggota | Display Line | Nomor Anggota Lama | Lebih Bayar [| Catatan]
 * - Display Line wajib. Baris judul kolom boleh ikut ditempel (dilewati).
 * - Kolom nomor yang berisi teks tanpa angka (mis. "reset", "ex admin") dianggap CATATAN dan nomornya dikosongkan.
 * - Lebih Bayar boleh "2 bulan" atau "2".
 */
export function parseLegacyRows(text: string): LegacyInputRow[] {
  const rows: LegacyInputRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const cols = (raw.includes("\t") ? raw.split("\t") : raw.split(";")).map((s) => s.trim());
    const [name = "", lineName = "", numberCell = "", prepaidCell = "", noteCell = ""] = cols;
    if (/^display\s*line$/i.test(lineName)) continue; // baris judul
    const row: LegacyInputRow = { line_name: lineName };
    if (name) row.name = name;
    let note = noteCell;
    if (numberCell) {
      if (/\d/.test(numberCell)) row.number = numberCell;
      else if (!note) note = numberCell; // "reset" / "ex admin"
    }
    const months = prepaidCell.match(/^(\d+)\s*(bulan)?$/i);
    if (months) row.prepaid = months[1];
    else if (prepaidCell) row.prepaid = prepaidCell; // tidak valid -> server menghitungnya invalid
    if (note) row.note = note;
    rows.push(row);
  }
  return rows;
}

export async function addLegacyMembers(rows: LegacyInputRow[]): Promise<AddLegacyResult> {
  const { data, error } = await getSupabase().rpc("admin_add_legacy_members", { p_rows: rows });
  if (error) throw toDataError(error, "Gagal menambahkan nomor anggota lama.");
  return data as AddLegacyResult;
}
