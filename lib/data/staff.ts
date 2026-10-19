/**
 * Akun staf (admin / admin_finance / superadmin) — hanya untuk superadmin.
 *
 * Daftar dibaca lewat RPC `superadmin_list_staff`. Pembuatan akun dilakukan Edge Function
 * `create-staff-account` (butuh service role, yang tidak boleh ada di browser); fungsi itu sendiri
 * memastikan pemanggilnya superadmin.
 */
import { DataError } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase/client";
import type { Role } from "@/lib/types";

export interface StaffAccount {
  profileId: string;
  displayName: string;
  email: string;
  role: Role;
  active: boolean;
  emailConfirmed: boolean;
  lastSignInAt: string | null;
  createdAt: string;
}

interface Row {
  profile_id: string;
  display_name: string;
  email: string;
  role: Role;
  active: boolean;
  email_confirmed: boolean;
  last_sign_in_at: string | null;
  created_at: string;
}

export async function listStaff(): Promise<StaffAccount[]> {
  const { data, error } = await getSupabase().rpc("superadmin_list_staff");
  if (error) throw new DataError("Gagal memuat daftar akun staf.");
  return (data as Row[]).map((r) => ({
    profileId: r.profile_id,
    displayName: r.display_name,
    email: r.email,
    role: r.role,
    active: r.active,
    emailConfirmed: r.email_confirmed,
    lastSignInAt: r.last_sign_in_at,
    createdAt: r.created_at,
  }));
}

export type StaffRole = "admin" | "admin_finance";

export interface CreateStaffInput {
  email: string;
  displayName: string;
  role: StaffRole;
}

const ERROR_TEXT: Record<string, string> = {
  INVALID_EMAIL: "Format email tidak valid.",
  INVALID_NAME: "Nama wajib diisi (maksimal 120 karakter).",
  INVALID_ROLE: "Role harus Admin atau Admin Finance.",
  FORBIDDEN: "Hanya superadmin yang bisa membuat akun staf. Silakan login ulang.",
  UNAUTHORIZED: "Sesi habis. Silakan login ulang.",
  EMAIL_EXISTS: "Email ini sudah punya akun. Bila ia anggota, ubah role-nya lewat detail anggota.",
  EMAIL_IS_MEMBER:
    "Email ini terdaftar sebagai anggota. Minta ia membuat akun di halaman Registrasi, lalu ubah role-nya lewat detail anggota (Ubah Role Akun).",
  NOT_CONFIGURED: "Fungsi pembuat akun belum dikonfigurasi di server. Hubungi pengembang.",
};

export interface CreateStaffResult {
  /** false = akun terbuat tetapi email atur password gagal terkirim (kirim ulang dari daftar) */
  emailSent: boolean;
}

export async function createStaff(input: CreateStaffInput): Promise<CreateStaffResult> {
  const { data, error } = await getSupabase().functions.invoke("create-staff-account", { body: input });
  if (error) {
    let code = "";
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx) code = ((await ctx.json()) as { error?: string }).error ?? "";
    } catch {
      /* respons bukan JSON */
    }
    const known = ERROR_TEXT[code];
    if (known) throw new DataError(known);
    // fungsi belum di-deploy / tidak terjangkau
    throw new DataError(
      "Gagal membuat akun staf. Pastikan Edge Function create-staff-account sudah di-deploy, lalu coba lagi.",
    );
  }
  return { emailSent: Boolean((data as { emailSent?: boolean } | null)?.emailSent) };
}
