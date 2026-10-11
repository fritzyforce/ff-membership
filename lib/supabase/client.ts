import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { DataError } from "@/lib/errors";

/**
 * Client Supabase untuk browser (static export: tidak ada server runtime).
 * Hanya memakai anon key — keamanan data dijaga RLS + RPC di database,
 * bukan oleh kerahasiaan key ini.
 *
 * `process.env.NEXT_PUBLIC_*` harus ditulis literal supaya di-inline Next.
 */
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let client: SupabaseClient | null = null;

export function isSupabaseConfigured() {
  return Boolean(URL && ANON_KEY);
}

export function getSupabase(): SupabaseClient {
  if (!URL || !ANON_KEY) {
    throw new DataError(
      "Backend belum dikonfigurasi. Isi NEXT_PUBLIC_SUPABASE_URL dan NEXT_PUBLIC_SUPABASE_ANON_KEY di .env.local.",
    );
  }
  client ??= createClient(URL, ANON_KEY);
  return client;
}

export const PAYMENT_PROOFS_BUCKET = "payment-proofs";
