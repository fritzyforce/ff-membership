/**
 * Syarat password anggota: huruf besar + huruf kecil + angka, minimal 8 karakter.
 * Penegak sebenarnya adalah server (config.toml `password_requirements =
 * "lower_upper_letters_digits"` + `minimum_password_length = 8`); ini hanya untuk
 * umpan balik langsung di form dan harus tetap sejalan dengan config itu.
 */
export interface PasswordRule {
  id: "length" | "lower" | "upper" | "digit";
  label: string;
  /** Kalimat untuk pesan error ("Password belum memenuhi syarat: <hint>"). */
  hint: string;
  test: (password: string) => boolean;
}

export const PASSWORD_MAX_LENGTH = 72; // batas bcrypt di Supabase Auth

export const PASSWORD_RULES: PasswordRule[] = [
  { id: "length", label: "Minimal 8 karakter", hint: "minimal 8 karakter", test: (p) => p.length >= 8 },
  { id: "upper", label: "Ada huruf besar (A–Z)", hint: "harus ada huruf besar (A–Z)", test: (p) => /[A-Z]/.test(p) },
  { id: "lower", label: "Ada huruf kecil (a–z)", hint: "harus ada huruf kecil (a–z)", test: (p) => /[a-z]/.test(p) },
  { id: "digit", label: "Ada angka (0–9)", hint: "harus ada angka (0–9)", test: (p) => /[0-9]/.test(p) },
];

/** Pesan error pertama yang dilanggar, atau null bila password valid. */
export function validatePassword(password: string): string | null {
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password maksimal ${PASSWORD_MAX_LENGTH} karakter.`;
  }
  const failed = PASSWORD_RULES.find((r) => !r.test(password));
  return failed ? `Password belum memenuhi syarat: ${failed.hint}.` : null;
}
