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

/**
 * Email yang baru dipakai mendaftar akun, dibawa ke halaman Login supaya terisi otomatis (tetap bisa diubah).
 * Juga sessionStorage (bukan query string) agar email tidak tercatat di URL. Dibaca sekali lalu dihapus.
 */
const LOGIN_KEY = "ff-login-email";

export function rememberLoginEmail(email: string) {
  try {
    sessionStorage.setItem(LOGIN_KEY, email);
  } catch {
    /* penyimpanan diblokir: pengguna mengetik email sendiri */
  }
}

export function takeLoginEmail(): string {
  try {
    const v = sessionStorage.getItem(LOGIN_KEY) ?? "";
    sessionStorage.removeItem(LOGIN_KEY);
    return v;
  } catch {
    return "";
  }
}
