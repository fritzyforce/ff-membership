import type {
  Applicant,
  ApplicantStatus,
  DuesSource,
  DuesStatus,
  ReRegistrationStatus,
} from "@/lib/types";

const MONTHS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];
const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
  "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
];

export function formatRupiah(n: number) {
  return `Rp ${n.toLocaleString("id-ID")}`;
}

/** "2026-08" -> "Agustus 2026" */
export function formatPeriod(period: string) {
  const [y, m] = period.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/**
 * Rentang bulan: "Oktober 2026" | "Oktober – Desember 2026" | "November 2026 – Januari 2027".
 * Dipakai untuk pembayaran yang mencakup beberapa bulan.
 */
export function formatPeriodRange(from: string, to: string) {
  if (from === to) return formatPeriod(from);
  const [fy, fm] = from.split("-").map(Number);
  const [ty] = to.split("-").map(Number);
  return fy === ty
    ? `${MONTHS[fm - 1]} – ${formatPeriod(to)}`
    : `${formatPeriod(from)} – ${formatPeriod(to)}`;
}

/** "2026-08-03" -> "03 Agu 2026" */
export function formatDateShort(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

/** "2001-05-14" -> "14 Mei 2001" */
export function formatDateLong(iso: string) {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function birthLine(p: { birthPlace?: string; birthDate: string }) {
  const parts = [p.birthPlace, p.birthDate ? formatDateLong(p.birthDate) : ""].filter(Boolean);
  return parts.length ? parts.join(", ") : "—";
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

type Socials = Pick<Applicant, "socialX" | "socialInstagram" | "socialTiktok">;

/** Daftar sosmed yang terisi: [{label, value}] */
export function socialsOf(p: Socials) {
  return [
    { label: "X", long: "X (Twitter)", value: p.socialX },
    { label: "IG", long: "Instagram", value: p.socialInstagram },
    { label: "TikTok", long: "TikTok", value: p.socialTiktok },
  ].filter((s) => s.value);
}

export const APPLICANT_STATUS: Record<
  ApplicantStatus,
  { label: string; badge: "approved" | "pending" | "reject" }
> = {
  pending: { label: "Menunggu Review", badge: "pending" },
  pre_approved: { label: "Pre-approved", badge: "pending" },
  payment_submitted: { label: "Verifikasi Bayar", badge: "pending" },
  approved: { label: "Approved", badge: "approved" },
  rejected: { label: "Rejected", badge: "reject" },
};

export const RE_REGISTRATION_STATUS: Record<
  ReRegistrationStatus,
  { label: string; badge: "approved" | "pending" | "reject" }
> = {
  pending: { label: "Menunggu Review", badge: "pending" },
  approved: { label: "Approved", badge: "approved" },
  rejected: { label: "Rejected", badge: "reject" },
};

export const DUES_SOURCE: Record<DuesSource, string> = {
  member: "Pembayaran anggota",
  re_registration: "Pembayaran registrasi ulang",
  legacy_credit: "Kelebihan bayar kas lama",
};

/** "2026-10-11T07:03:00Z" -> "11 Okt 2026, 14.03" (jam lokal peramban) */
export function formatDateTimeShort(iso: string | null) {
  if (!iso) return "—";
  const time = new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  return `${formatDateShort(iso)}, ${time}`;
}

export const DUES_STATUS: Record<
  DuesStatus,
  { label: string; badge: "approved" | "pending" | "reject" }
> = {
  paid: { label: "Lunas", badge: "approved" },
  processing: { label: "Diproses", badge: "pending" },
  rejected: { label: "Ditolak", badge: "reject" },
};
