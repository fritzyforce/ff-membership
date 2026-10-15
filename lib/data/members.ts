/**
 * Repository anggota (Supabase) — hanya data milik anggota yang sedang login.
 * RLS memastikan select hanya mengembalikan barisnya sendiri; edit lewat RPC
 * `update_my_member_profile` (kolom terbatas, divalidasi di database).
 */
import { DataError } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase/client";
import type { Member, MemberSource, MemberStatus, Role } from "@/lib/types";

interface MemberRow {
  id: string;
  member_number: string;
  source: MemberSource;
  full_name: string;
  nickname: string;
  domicile: string;
  birth_date: string | null;
  address: string;
  social_x: string;
  social_instagram: string;
  social_tiktok: string;
  email: string;
  line_id: string;
  old_member_number: string | null;
  status: MemberStatus;
  joined_at: string;
  dues_start_period: string;
}

function fromRow(r: MemberRow): Member {
  return {
    id: r.id,
    memberNumber: r.member_number,
    source: r.source,
    applicantId: null,
    fullName: r.full_name,
    nickname: r.nickname,
    domicile: r.domicile,
    birthDate: r.birth_date ?? "",
    address: r.address,
    socialX: r.social_x,
    socialInstagram: r.social_instagram,
    socialTiktok: r.social_tiktok,
    email: r.email,
    lineId: r.line_id,
    oldMemberNumber: r.old_member_number,
    status: r.status,
    joinedAt: r.joined_at,
    duesStartPeriod: r.dues_start_period,
  };
}

/** Data anggota milik akun yang sedang login (null bila tidak tertaut). */
export async function getMyMember(): Promise<Member | null> {
  const { data, error } = await getSupabase().from("members").select("*").maybeSingle<MemberRow>();
  if (error) throw new DataError("Gagal memuat data anggota. Coba lagi beberapa saat.");
  return data ? fromRow(data) : null;
}

export type MemberProfileInput = Pick<
  Member,
  | "nickname"
  | "domicile"
  | "birthDate"
  | "address"
  | "lineId"
  | "socialX"
  | "socialInstagram"
  | "socialTiktok"
>;

const ERROR_TEXT: Record<string, string> = {
  INVALID_NAME: "Nama lengkap wajib diisi (maksimal 120 karakter).",
  INVALID_NICKNAME: "Nickname wajib diisi (maksimal 60 karakter).",
  INVALID_DOMICILE: "Domisili wajib diisi (maksimal 100 karakter).",
  INVALID_BIRTH_DATE: "Tanggal lahir tidak valid.",
  INVALID_DUES_START: "Bulan awal iuran tidak valid (antara Januari 2020 dan bulan depan).",
  NOT_FOUND: "Anggota tidak ditemukan.",
  NOTE_REQUIRED: "Alasan wajib diisi untuk mencabut atau menonaktifkan anggota.",
  NO_CHANGE: "Tidak ada perubahan: nilainya sudah sama.",
  CANNOT_MODIFY_SELF: "Kamu tidak bisa mengubah akun atau keanggotaanmu sendiri.",
  NO_ACCOUNT: "Anggota ini belum punya akun.",
  LAST_SUPERADMIN: "Tidak bisa: harus tetap ada minimal satu superadmin aktif.",
  INVALID_ADDRESS: "Alamat maksimal 300 karakter.",
  INVALID_LINE_ID: "ID Line wajib diisi (maksimal 60 karakter).",
  INVALID_SOCIAL: "Username sosial media maksimal 60 karakter.",
  FORBIDDEN: "Keanggotaanmu tidak aktif atau kamu perlu login ulang.",
};

function toDataError(error: { message?: string } | null, fallback = "Terjadi kesalahan pada server. Coba lagi."): DataError {
  return new DataError(ERROR_TEXT[(error?.message ?? "").trim()] ?? fallback);
}

export async function updateMyProfile(input: MemberProfileInput) {
  const { error } = await getSupabase().rpc("update_my_member_profile", {
    p_nickname: input.nickname,
    p_domicile: input.domicile,
    p_birth_date: input.birthDate || null,
    p_address: input.address,
    p_line_id: input.lineId,
    p_social_x: input.socialX,
    p_social_instagram: input.socialInstagram,
    p_social_tiktok: input.socialTiktok,
  });
  if (error) throw toDataError(error, "Gagal menyimpan profil. Coba lagi.");
}

/* ------------------------------------------------------------------ */
/* Admin                                                                */
/* ------------------------------------------------------------------ */

export interface AdminMemberRow extends Member {
  /** null = belum punya akun */
  account: { role: Role; active: boolean } | null;
}

type AdminRow = MemberRow & {
  account: { role: Role; active: boolean } | { role: Role; active: boolean }[] | null;
};

const ADMIN_SELECT = "*, account:profiles(role, active)";

function fromAdminRow(r: AdminRow): AdminMemberRow {
  // relasi one-to-one kadang dikembalikan sebagai array oleh PostgREST
  const account = Array.isArray(r.account) ? (r.account[0] ?? null) : r.account;
  return { ...fromRow(r), account };
}

export interface MemberListParams {
  page: number;
  pageSize: number;
  status: MemberStatus | "all";
  query: string;
}

export async function listMembers({ page, pageSize, status, query }: MemberListParams) {
  const from = (page - 1) * pageSize;
  let q = getSupabase()
    .from("members")
    .select(ADMIN_SELECT, { count: "exact" })
    .order("member_number", { ascending: false })
    .range(from, from + pageSize - 1);
  if (status !== "all") q = q.eq("status", status);

  // buang karakter yang punya arti khusus di sintaks filter PostgREST / LIKE
  const term = query.replace(/[%_\\",()*]/g, " ").trim();
  if (term) {
    q = q.or(
      `full_name.ilike."%${term}%",nickname.ilike."%${term}%",email.ilike."%${term}%",member_number.ilike."%${term}%",old_member_number.ilike."%${term}%"`,
    );
  }
  const { data, error, count } = await q;
  if (error) throw new DataError("Gagal memuat daftar anggota. Coba lagi beberapa saat.");
  return { rows: (data as unknown as AdminRow[]).map(fromAdminRow), total: count ?? 0 };
}

export async function getMemberById(id: string): Promise<AdminMemberRow | null> {
  const { data, error } = await getSupabase().from("members").select(ADMIN_SELECT).eq("id", id).maybeSingle();
  if (error) throw new DataError("Gagal memuat data anggota.");
  return data ? fromAdminRow(data as unknown as AdminRow) : null;
}

export type AdminMemberInput = Pick<
  Member,
  | "fullName"
  | "nickname"
  | "domicile"
  | "birthDate"
  | "address"
  | "lineId"
  | "socialX"
  | "socialInstagram"
  | "socialTiktok"
  | "duesStartPeriod"
>;

export async function adminUpdateMember(id: string, input: AdminMemberInput) {
  const { error } = await getSupabase().rpc("admin_update_member", {
    p_id: id,
    p_full_name: input.fullName,
    p_nickname: input.nickname,
    p_domicile: input.domicile,
    p_birth_date: input.birthDate || null,
    p_address: input.address,
    p_line_id: input.lineId,
    p_social_x: input.socialX,
    p_social_instagram: input.socialInstagram,
    p_social_tiktok: input.socialTiktok,
    p_dues_start_period: input.duesStartPeriod,
  });
  if (error) throw toDataError(error, "Gagal menyimpan data anggota.");
}

export async function adminSetMemberStatus(id: string, status: MemberStatus, note: string) {
  const { error } = await getSupabase().rpc("admin_set_member_status", { p_id: id, p_status: status, p_note: note });
  if (error) throw toDataError(error, "Gagal mengubah status anggota.");
}

export interface MemberAccountInfo {
  hasAccount: boolean;
  role: Role | null;
  active: boolean | null;
  emailConfirmed: boolean | null;
  lastSignInAt: string | null;
  createdAt: string | null;
}

export async function getMemberAccount(memberId: string): Promise<MemberAccountInfo> {
  const { data, error } = await getSupabase().rpc("admin_get_member_account", { p_member_id: memberId });
  if (error) throw toDataError(error, "Gagal memuat info akun.");
  const r = (data as Record<string, unknown>[])[0] ?? {};
  return {
    hasAccount: Boolean(r.has_account),
    role: (r.role as Role | null) ?? null,
    active: (r.active as boolean | null) ?? null,
    emailConfirmed: (r.email_confirmed as boolean | null) ?? null,
    lastSignInAt: (r.last_sign_in_at as string | null) ?? null,
    createdAt: (r.account_created as string | null) ?? null,
  };
}

export async function superadminSetAccountRole(memberId: string, role: Role) {
  const { error } = await getSupabase().rpc("superadmin_set_account_role", { p_member_id: memberId, p_role: role });
  if (error) throw toDataError(error, "Gagal mengubah role.");
}

export async function superadminSetAccountActive(memberId: string, active: boolean) {
  const { error } = await getSupabase().rpc("superadmin_set_account_active", { p_member_id: memberId, p_active: active });
  if (error) throw toDataError(error, "Gagal mengubah status akun.");
}

/** Catat di audit log (emailnya dikirim lewat requestPasswordReset di lib/auth). */
export async function superadminLogPasswordReset(memberId: string) {
  const { error } = await getSupabase().rpc("superadmin_log_password_reset", { p_member_id: memberId });
  if (error) throw toDataError(error);
}

export interface AuditEntry {
  id: string;
  action: string;
  details: Record<string, unknown>;
  createdAt: string;
  actorName: string | null;
}

export async function listMemberAudit(memberId: string, limit = 20): Promise<AuditEntry[]> {
  const { data, error } = await getSupabase()
    .from("audit_log")
    .select("id, action, details, created_at, actor:profiles(display_name)")
    .eq("entity", "member")
    .eq("entity_id", memberId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new DataError("Gagal memuat riwayat aktivitas.");
  return (data as unknown as {
    id: string;
    action: string;
    details: Record<string, unknown>;
    created_at: string;
    actor: { display_name: string } | { display_name: string }[] | null;
  }[]).map((r) => {
    const actor = Array.isArray(r.actor) ? r.actor[0] : r.actor;
    return { id: r.id, action: r.action, details: r.details, createdAt: r.created_at, actorName: actor?.display_name ?? null };
  });
}
