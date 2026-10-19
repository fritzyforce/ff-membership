/**
 * Edge Function: superadmin membuat akun staf (admin / admin_finance).
 *
 * Alur: validasi -> pastikan pemanggil superadmin -> daftarkan email di account_provisioning (sekali pakai)
 * -> buat user Auth (email langsung terkonfirmasi, password acak yang tidak diketahui siapa pun)
 * -> kirim email "atur password" (recovery) supaya staf membuat passwordnya sendiri.
 * Trigger database `handle_new_auth_user` membuat baris `profiles` ber-role itu.
 *
 * Keamanan:
 *   - Pemanggil HARUS superadmin: dicek lewat RPC is_superadmin() dengan JWT pemanggil (bukan dari isi request).
 *   - Hanya role admin / admin_finance yang bisa dibuat (superadmin tidak bisa dibuat lewat jalur ini).
 *   - Service role key hanya ada di sini (disuntik platform), tidak pernah di browser.
 *   - Email yang sudah punya akun atau sudah terdaftar sebagai anggota ditolak.
 *
 * Secrets (opsional): SITE_URL (untuk tautan di email). SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
 * disuntik otomatis oleh platform.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

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

const ROLES = ["admin", "admin_finance"];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Password acak kuat (memenuhi aturan huruf besar+kecil+angka); tidak pernah dikirim ke siapa pun. */
function randomPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "x") + "aA1";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const authorization = req.headers.get("Authorization");
  if (!authorization) return json({ error: "UNAUTHORIZED" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return json({ error: "NOT_CONFIGURED" }, 500);

  let payload: { email?: string; displayName?: string; role?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "BAD_REQUEST" }, 400);
  }
  const email = String(payload.email ?? "").trim().toLowerCase();
  const displayName = String(payload.displayName ?? "").trim();
  const role = String(payload.role ?? "");
  if (!EMAIL_RE.test(email) || email.length > 254) return json({ error: "INVALID_EMAIL" }, 400);
  if (displayName.length < 1 || displayName.length > 120) return json({ error: "INVALID_NAME" }, 400);
  if (!ROLES.includes(role)) return json({ error: "INVALID_ROLE" }, 400);

  // 1) pemanggil harus superadmin (dicek dengan JWT pemanggil, bukan data dari request)
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: isSuper, error: roleErr } = await caller.rpc("is_superadmin");
  if (roleErr || isSuper !== true) return json({ error: "FORBIDDEN" }, 403);
  const { data: who } = await caller.auth.getUser();
  const callerId = who?.user?.id ?? null;

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // 2) email anggota: jangan dibuat sebagai staf terpisah (ubah role lewat detail anggota setelah ia mendaftar akun)
  const escaped = email.replace(/[\\%_]/g, "\\$&");
  const { data: member, error: memberErr } = await admin
    .from("members").select("id").ilike("email", escaped).limit(1).maybeSingle();
  if (memberErr) return json({ error: "LOOKUP_FAILED" }, 500);
  if (member) return json({ error: "EMAIL_IS_MEMBER" }, 409);

  // 3) daftarkan (sekali pakai) lalu buat user; trigger membuat profil ber-role
  const { error: provErr } = await admin
    .from("account_provisioning")
    .upsert({ email, role, display_name: displayName }, { onConflict: "email" });
  if (provErr) return json({ error: "PROVISION_FAILED" }, 500);

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: randomPassword(),
    email_confirm: true,
  });
  if (createErr || !created?.user) {
    await admin.from("account_provisioning").delete().eq("email", email); // bersihkan, jangan menggantung
    const code = (createErr as { code?: string } | null)?.code;
    if (code === "email_exists" || /already.*registered|already been registered/i.test(createErr?.message ?? "")) {
      return json({ error: "EMAIL_EXISTS" }, 409);
    }
    console.error("createUser failed", createErr?.message);
    return json({ error: "CREATE_FAILED" }, 500);
  }

  // 4) email "atur password" (memakai template recovery). Gagal kirim tidak membatalkan pembuatan akun.
  const siteUrl = (Deno.env.get("SITE_URL") ?? req.headers.get("Origin") ?? "").replace(/\/+$/, "");
  let emailSent = false;
  if (siteUrl) {
    const anon = createClient(url, anonKey, { auth: { persistSession: false } });
    const { error: mailErr } = await anon.auth.resetPasswordForEmail(email, { redirectTo: `${siteUrl}/reset-password/` });
    emailSent = !mailErr;
    if (mailErr) console.error("setup email failed", mailErr.message);
  }

  await admin.from("audit_log").insert({
    actor_id: callerId,
    action: "staff.created",
    entity: "account",
    entity_id: created.user.id,
    details: { email, role, email_sent: emailSent },
  });

  return json({ ok: true, emailSent });
});
