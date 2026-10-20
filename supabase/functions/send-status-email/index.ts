/**
 * Edge Function: kirim email hasil review registrasi ulang ke pendaftar (via Resend).
 *
 * Keamanan:
 *   - Pemanggil harus admin: query dijalankan dengan JWT pemanggil sehingga RLS
 *     `re_registrations` (hanya admin) yang menentukan boleh/tidaknya.
 *   - Penerima & isi email SELALU diambil dari database berdasarkan `id`; klien
 *     tidak bisa menyuruh fungsi ini mengirim ke alamat atau teks sembarang.
 *   - Hanya status approved/rejected yang dikirim (pending ditolak).
 *
 * Secrets (supabase secrets set ...): RESEND_API_KEY, EMAIL_FROM, SITE_URL.
 * SUPABASE_URL & SUPABASE_ANON_KEY disuntik otomatis oleh platform.
 * Panduan: docs/email-setup.md → "Email notifikasi status".
 */
import { createClient } from "npm:@supabase/supabase-js@2";

import { reRegistrationEmail } from "./templates.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const authorization = req.headers.get("Authorization");
  if (!authorization) return json({ error: "UNAUTHORIZED" }, 401);

  const resendKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("EMAIL_FROM"); // mis. "Fritzy Force <noreply@domainmu.com>"
  const siteUrl = (Deno.env.get("SITE_URL") ?? "").replace(/\/+$/, "");
  if (!resendKey || !from || !siteUrl) return json({ error: "EMAIL_NOT_CONFIGURED" }, 500);

  let payload: { kind?: string; id?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "BAD_REQUEST" }, 400);
  }
  if (payload.kind !== "re_registration" || !payload.id || !UUID.test(payload.id)) {
    return json({ error: "BAD_REQUEST" }, 400);
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });

  // RLS: non-admin tidak melihat baris apa pun -> NOT_FOUND
  const { data: row, error } = await supabase
    .from("re_registrations")
    .select("code, full_name, nickname, email, status, members(member_number)")
    .eq("id", payload.id)
    .maybeSingle();
  if (error) return json({ error: "LOOKUP_FAILED" }, 500);
  if (!row) return json({ error: "NOT_FOUND" }, 404);
  if (row.status !== "approved" && row.status !== "rejected") {
    return json({ error: "NOT_REVIEWED_YET" }, 409);
  }

  const member = Array.isArray(row.members) ? row.members[0] : row.members;
  const message = reRegistrationEmail({
    status: row.status,
    // nama lengkap opsional: pakai nickname bila kosong
    fullName: row.full_name || row.nickname,
    code: row.code,
    memberNumber: member?.member_number ?? null,
    siteUrl,
  });

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [row.email], subject: message.subject, html: message.html, text: message.text }),
  });
  if (!res.ok) {
    console.error("resend failed", res.status, await res.text());
    return json({ error: "SEND_FAILED" }, 502);
  }
  return json({ ok: true });
});
