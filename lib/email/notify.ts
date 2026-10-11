import { getSupabase } from "@/lib/supabase/client";

/**
 * Email notifikasi ke pendaftar setelah admin memutuskan (approve/reject).
 *
 * Pengiriman terjadi di Supabase Edge Function `send-status-email` (kunci Resend
 * hanya ada di server; aplikasi ini statis dan tidak punya backend sendiri).
 * Fungsi menentukan penerima & isi dari database berdasarkan `id`, dan hanya
 * mau melayani admin — klien tidak mengirim alamat atau teks email.
 *
 * STATUS: library siap, tetapi pemanggilnya masih di-comment
 * (lihat components/views/admin-reregistration-detail-view.tsx).
 * Aktifkan setelah SMTP/Resend siap: docs/email-setup.md → "Email notifikasi status".
 */
export async function notifyReRegistrationReviewed(reRegistrationId: string): Promise<void> {
  const { error } = await getSupabase().functions.invoke("send-status-email", {
    body: { kind: "re_registration", id: reRegistrationId },
  });
  if (error) throw new Error("Keputusan tersimpan, tetapi email ke pendaftar gagal dikirim.");
}
