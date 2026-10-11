/**
 * Email pendaftaran yang dibawa dari halaman Cek Status ke halaman Registrasi Akun.
 * Disimpan di sessionStorage (bukan query string) supaya email tidak tercatat di
 * URL/riwayat peramban; hilang saat tab ditutup.
 */
const KEY = "ff-register-email";

export function rememberRegisterEmail(email: string | null | undefined) {
  if (!email) return;
  try {
    sessionStorage.setItem(KEY, email);
  } catch {
    /* penyimpanan diblokir: pengguna cukup mengetik email sendiri */
  }
}

export function readRegisterEmail(): string {
  try {
    return sessionStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function clearRegisterEmail() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* abaikan */
  }
}
