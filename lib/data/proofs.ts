/**
 * Bukti pembayaran (bucket privat `payment-proofs`): validasi file, unggah, dan
 * URL sementara untuk admin. Dipakai registrasi ulang dan uang kas.
 */
import { DataError } from "@/lib/errors";
import { PAYMENT_PROOFS_BUCKET, getSupabase } from "@/lib/supabase/client";

export const PROOF_MAX_BYTES = 5 * 1024 * 1024;
export const PROOF_MIME_TYPES = ["image/jpeg", "image/png"];

export function validateProofFile(file: File) {
  if (!PROOF_MIME_TYPES.includes(file.type)) {
    throw new DataError("Format bukti pembayaran harus JPG atau PNG.");
  }
  if (file.size > PROOF_MAX_BYTES) {
    throw new DataError("Ukuran bukti pembayaran maksimal 5MB.");
  }
}

/**
 * Unggah ke `<folder>/<uuid>.jpg|png` dan kembalikan path-nya. Pembatasan siapa boleh
 * menulis ke folder mana dijaga policy storage di database, bukan di sini.
 */
export async function uploadProof(folder: string, file: File): Promise<string> {
  validateProofFile(file);
  const ext = file.type === "image/png" ? "png" : "jpg";
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await getSupabase()
    .storage.from(PAYMENT_PROOFS_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) {
    throw new DataError("Gagal mengunggah bukti pembayaran. Periksa koneksi lalu coba lagi.");
  }
  return path;
}

/** URL bukti sementara (5 menit) untuk ditampilkan — bucket privat. */
export async function getProofUrl(path: string) {
  const { data, error } = await getSupabase()
    .storage.from(PAYMENT_PROOFS_BUCKET)
    .createSignedUrl(path, 300);
  if (error) throw new DataError("Gagal memuat bukti pembayaran.");
  return data.signedUrl;
}
