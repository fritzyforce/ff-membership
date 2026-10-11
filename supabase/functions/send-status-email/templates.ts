/**
 * Template email status registrasi ulang (HTML + teks polos), Bahasa Indonesia.
 * Catatan review admin SENGAJA tidak disertakan: catatan hanya untuk admin.
 */

export interface EmailMessage {
  subject: string;
  html: string;
  text: string;
}

export interface ReRegistrationEmailData {
  status: "approved" | "rejected";
  fullName: string;
  code: string;
  /** Hanya untuk approved */
  memberNumber?: string | null;
  /** URL situs tanpa garis miring di akhir, mis. https://ff-membership.vercel.app */
  siteUrl: string;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function layout(title: string, bodyHtml: string, cta?: { href: string; label: string }) {
  return `<!doctype html>
<html lang="id">
  <body style="margin:0;padding:0;background:#100615;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#100615;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#1b0d22;border:1px solid #3a2142;border-radius:20px;padding:32px;">
          <tr><td style="color:#d6b35d;font-size:13px;letter-spacing:.08em;text-transform:uppercase;">Fritzy Force</td></tr>
          <tr><td style="color:#f9e58e;font-size:22px;font-weight:700;padding:8px 0 16px;">${esc(title)}</td></tr>
          <tr><td style="color:#e4c66f;font-size:15px;line-height:24px;">${bodyHtml}</td></tr>
          ${
            cta
              ? `<tr><td style="padding-top:24px;"><a href="${esc(cta.href)}" style="display:inline-block;background:#f9e58e;color:#100615;font-weight:700;text-decoration:none;padding:14px 24px;border-radius:14px;">${esc(cta.label)}</a></td></tr>`
              : ""
          }
          <tr><td style="color:#d6b35d;font-size:12px;line-height:18px;padding-top:28px;">Email otomatis, jangan dibalas.</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export function reRegistrationEmail(d: ReRegistrationEmailData): EmailMessage {
  const name = esc(d.fullName);
  if (d.status === "approved") {
    const link = `${d.siteUrl}/register/`;
    const number = d.memberNumber ? `<strong style="color:#f9e58e;">${esc(d.memberNumber)}</strong>` : "";
    return {
      subject: "Registrasi ulang disetujui — Fritzy Force",
      html: layout(
        "Registrasi ulang disetujui",
        `<p style="margin:0 0 12px;">Halo ${name},</p>
         <p style="margin:0 0 12px;">Registrasi ulangmu (kode ${esc(d.code)}) sudah disetujui. Kamu kembali resmi menjadi anggota Fritzy Force.</p>
         ${number ? `<p style="margin:0 0 12px;">Nomor anggota: ${number}</p>` : ""}
         <p style="margin:0;">Buat akun dengan email ini untuk mengakses profil dan riwayat uang kas.</p>`,
        { href: link, label: "Buat Akun" },
      ),
      text: [
        `Halo ${d.fullName},`,
        "",
        `Registrasi ulangmu (kode ${d.code}) sudah disetujui. Kamu kembali resmi menjadi anggota Fritzy Force.`,
        d.memberNumber ? `Nomor anggota: ${d.memberNumber}` : "",
        "",
        `Buat akun dengan email ini: ${link}`,
      ]
        .filter((l, i, a) => l !== "" || a[i - 1] !== "")
        .join("\n"),
    };
  }

  const link = `${d.siteUrl}/registrasi-ulang/`;
  return {
    subject: "Registrasi ulang belum dapat disetujui — Fritzy Force",
    html: layout(
      "Registrasi ulang belum dapat disetujui",
      `<p style="margin:0 0 12px;">Halo ${name},</p>
       <p style="margin:0 0 12px;">Mohon maaf, registrasi ulangmu (kode ${esc(d.code)}) belum dapat kami setujui.</p>
       <p style="margin:0;">Kamu bisa mengajukan kembali dengan data yang sesuai.</p>`,
      { href: link, label: "Ajukan Ulang" },
    ),
    text: [
      `Halo ${d.fullName},`,
      "",
      `Mohon maaf, registrasi ulangmu (kode ${d.code}) belum dapat kami setujui.`,
      `Kamu bisa mengajukan kembali: ${link}`,
    ].join("\n"),
  };
}
