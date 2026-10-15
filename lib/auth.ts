"use client";

/**
 * Auth berbasis Supabase Auth (email + password) untuk SEMUA peran.
 *
 *   • Peran & tautan ke anggota dibaca dari tabel `profiles` (RLS: hanya baris sendiri).
 *   • Sign-up dijaga trigger database `handle_new_auth_user`: hanya email anggota
 *     aktif yang belum punya akun yang bisa mendaftar, dan profile-nya dibuat
 *     otomatis. Akun staf dibuat lewat `account_provisioning` (lihat README).
 *   • UI hanya memakai `Session` untuk menampilkan menu/redirect; penegakan akses
 *     sebenarnya ada di RLS + RPC.
 */
import { useEffect, useState } from "react";

import { DataError } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase/client";
import type { MemberStatus, Role, Session } from "@/lib/types";

export function isAdminRole(role: Role | undefined) {
  return role === "admin" || role === "admin_finance" || role === "superadmin";
}

/**
 * Hanya admin_finance dan superadmin yang boleh approve/reject pembayaran uang kas dan registrasi ulang.
 * Ini hanya untuk menyembunyikan tombol; penegakan sebenarnya ada di RPC database.
 */
export function canReviewFinance(role: Role | undefined) {
  return role === "admin_finance" || role === "superadmin";
}

export const FINANCE_ONLY_NOTICE =
  "Approve dan Reject hanya dapat dilakukan oleh Admin Finance atau Superadmin. Kamu bisa melihat data ini, tetapi tidak bisa mengubahnya.";

/** Login ditolak karena email belum dikonfirmasi (UI menawarkan kirim ulang). */
export class EmailNotConfirmedError extends DataError {}

/* ------------------------------------------------------------------ */
/* Sesi                                                                 */
/* ------------------------------------------------------------------ */

interface ProfileRow {
  role: Role;
  display_name: string;
  active: boolean;
  member_id: string | null;
  member: { status: MemberStatus } | null;
}

/**
 * Bangun `Session` dari profile. `null` = akun tidak boleh masuk
 * (tanpa profile, dinonaktifkan, atau keanggotaannya tidak aktif).
 */
async function loadSession(userId: string, email: string): Promise<Session | null> {
  const { data, error } = await getSupabase()
    .from("profiles")
    .select("role, display_name, active, member_id, member:members(status)")
    .eq("id", userId)
    .maybeSingle<ProfileRow>();
  if (error || !data || !data.active) return null;
  if (data.role === "member" && data.member?.status !== "active") return null;
  return {
    id: userId,
    email,
    role: data.role,
    memberId: data.member_id,
    displayName: data.display_name || email,
    active: true,
  };
}

let cache: Session | null = null;

async function resolveSession(force: boolean): Promise<Session | null> {
  const sb = getSupabase();
  const { data } = await sb.auth.getSession();
  const user = data.session?.user;
  if (!user) {
    cache = null;
    return null;
  }
  if (!force && cache?.id === user.id) return cache;
  cache = await loadSession(user.id, user.email ?? "");
  return cache;
}

let signingOut = false;

/** Dicek AuthGuard supaya logout tidak dianggap "sesi hilang" (→ /login). */
export function isSigningOut() {
  return signingOut;
}

/* ------------------------------------------------------------------ */
/* Aksi                                                                 */
/* ------------------------------------------------------------------ */

function redirectUrl() {
  return `${window.location.origin}/login/`;
}

export async function login(email: string, password: string): Promise<Session> {
  const sb = getSupabase();
  const normalized = email.trim().toLowerCase();
  const { data, error } = await sb.auth.signInWithPassword({ email: normalized, password });

  if (error) {
    if (error.code === "email_not_confirmed") {
      throw new EmailNotConfirmedError(
        "Email belum dikonfirmasi. Klik tautan di email konfirmasi, atau kirim ulang di bawah.",
      );
    }
    if (error.code === "invalid_credentials") {
      throw new DataError("Email atau password salah.");
    }
    if (error.status === undefined || error.status >= 500) {
      throw new DataError("Tidak dapat terhubung ke server. Coba lagi beberapa saat.");
    }
    throw new DataError("Gagal masuk. Coba lagi.");
  }

  const session = await loadSession(data.user.id, data.user.email ?? normalized);
  if (!session) {
    await sb.auth.signOut();
    throw new DataError("Akun ini tidak aktif atau belum tertaut ke anggota. Hubungi admin.");
  }
  cache = session;
  signingOut = false;
  return session;
}

export function logout() {
  signingOut = true;
  cache = null;
  void getSupabase().auth.signOut();
}

export interface RegisterResult {
  /** true = email konfirmasi terkirim; akun baru aktif setelah tautan diklik. */
  needsConfirmation: boolean;
}

/**
 * Buat akun anggota. Server menolak (lewat trigger) bila email bukan anggota
 * aktif atau sudah punya akun — keduanya sengaja diberi pesan yang sama supaya
 * form ini tidak bisa dipakai menebak siapa saja yang menjadi anggota.
 */
export async function registerAccount(email: string, password: string): Promise<RegisterResult> {
  const { data, error } = await getSupabase().auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: { emailRedirectTo: redirectUrl() },
  });

  if (error) {
    if (error.code === "weak_password") {
      throw new DataError(
        "Password belum memenuhi syarat: minimal 8 karakter dengan huruf besar, huruf kecil, dan angka.",
      );
    }
    if (error.code === "over_email_send_rate_limit" || error.status === 429) {
      throw new DataError("Terlalu banyak percobaan. Tunggu beberapa saat lalu coba lagi.");
    }
    // Trigger handle_new_auth_user menolak: GoTrue meneruskan pesan exception-nya
    // (MEMBER_*); versi lama membungkusnya jadi "Database error saving new user".
    if (/MEMBER_NOT_ELIGIBLE|MEMBER_ALREADY_HAS_ACCOUNT|saving new user/i.test(error.message)) {
      throw new DataError(
        "Email ini tidak bisa dipakai membuat akun. Pastikan registrasimu sudah disetujui admin dan kamu belum punya akun.",
      );
    }
    if (error.status === undefined || error.status >= 500) {
      throw new DataError("Tidak dapat terhubung ke server. Coba lagi beberapa saat.");
    }
    throw new DataError("Gagal membuat akun. Coba lagi.");
  }
  return { needsConfirmation: !data.session };
}

export async function resendConfirmation(email: string) {
  const { error } = await getSupabase().auth.resend({
    type: "signup",
    email: email.trim().toLowerCase(),
    options: { emailRedirectTo: redirectUrl() },
  });
  if (error) {
    throw new DataError(
      error.code === "over_email_send_rate_limit" || error.status === 429
        ? "Terlalu banyak percobaan. Tunggu beberapa saat lalu coba lagi."
        : "Gagal mengirim ulang email konfirmasi. Coba lagi.",
    );
  }
}

const RATE_LIMIT_TEXT = "Terlalu banyak percobaan. Tunggu beberapa saat lalu coba lagi.";

/**
 * Kirim email reset password. Respons sengaja netral (Supabase juga tidak
 * membedakan email terdaftar atau tidak) supaya tidak bisa dipakai menebak akun.
 */
export async function requestPasswordReset(email: string) {
  const { error } = await getSupabase().auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: `${window.location.origin}/reset-password/`,
  });
  if (error) {
    throw new DataError(
      error.code === "over_email_send_rate_limit" || error.status === 429
        ? RATE_LIMIT_TEXT
        : "Gagal mengirim email reset password. Coba lagi.",
    );
  }
}

/** Dipanggil di halaman reset-password, saat sesi recovery dari tautan email aktif. */
export async function setNewPassword(password: string) {
  const { error } = await getSupabase().auth.updateUser({ password });
  if (error) {
    if (error.code === "weak_password") {
      throw new DataError(
        "Password belum memenuhi syarat: minimal 8 karakter dengan huruf besar, huruf kecil, dan angka.",
      );
    }
    if (error.code === "same_password") {
      throw new DataError("Password baru tidak boleh sama dengan password lama.");
    }
    throw new DataError("Gagal mengubah password. Tautan mungkin sudah kedaluwarsa — minta tautan baru.");
  }
}

/**
 * `undefined` = belum dibaca (render pertama / SSR),
 * `null` = tidak login.
 */
export function useSession(): Session | null | undefined {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;

    const sync = async (force = false) => {
      let next: Session | null = null;
      try {
        next = await resolveSession(force);
      } catch {
        // backend tak terjangkau / belum dikonfigurasi: anggap belum login
      }
      if (alive) setSession(next);
    };

    void sync();

    // Jangan memanggil API Supabase langsung di dalam callback ini (deadlock
    // lock internal supabase-js) — tunda dengan setTimeout.
    let unsubscribe = () => {};
    try {
      const { data } = getSupabase().auth.onAuthStateChange(() => {
        setTimeout(() => void sync(true), 0);
      });
      unsubscribe = () => data.subscription.unsubscribe();
    } catch {
      // belum dikonfigurasi
    }

    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  return session;
}
