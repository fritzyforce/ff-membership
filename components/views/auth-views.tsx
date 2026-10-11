"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import PageTopbar from "@/components/layout/page-topbar";
import { IconCheck } from "@/components/ui/icons";
import PasswordInput from "@/components/ui/password-input";
import { Field, Logo, Notice } from "@/components/ui/primitives";
import {
  EmailNotConfirmedError,
  isAdminRole,
  login,
  registerAccount,
  requestPasswordReset,
  resendConfirmation,
  setNewPassword,
  useSession,
} from "@/lib/auth";
import { clearRegisterEmail, readRegisterEmail } from "@/lib/register-prefill";
import { getSupabase } from "@/lib/supabase/client";
import type { Session } from "@/lib/types";
import { PASSWORD_MAX_LENGTH, PASSWORD_RULES, validatePassword } from "@/lib/validation/password";

function homeFor(session: Session) {
  return isAdminRole(session.role) ? "/admin/members/" : "/akun/";
}

function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <PageTopbar title="" backHref="/" />
      <main className="mx-auto flex w-full max-w-[440px] flex-col gap-5 px-8 pb-8 pt-2 lg:pt-12">
        <Logo size={64} />
        <div className="stack gap-1">
          <h1 className="text-h1 text-[26px]">{title}</h1>
          <p className="text-body-sm">{subtitle}</p>
        </div>
        {children}
      </main>
    </div>
  );
}

/** Tombol kirim ulang email konfirmasi (dipakai di Login & setelah Register). */
function ResendConfirmation({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  const resend = async () => {
    setState("sending");
    setError(null);
    try {
      await resendConfirmation(email);
      setState("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengirim ulang.");
      setState("idle");
    }
  };

  return (
    <div className="stack gap-2">
      {state === "sent" && <Notice tone="success">Email konfirmasi dikirim ulang ke {email}.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      <button type="button" className="btn btn-secondary btn-block" onClick={resend} disabled={state === "sending"}>
        {state === "sending" ? "Mengirim…" : "Kirim ulang email konfirmasi"}
      </button>
    </div>
  );
}

/** Artboard: Login. */
export function LoginView() {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const session = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [busy, setBusy] = useState(false);

  // Sudah login (atau baru klik tautan konfirmasi email) → langsung ke dashboard
  useEffect(() => {
    if (session && !busy) router.replace(homeFor(session));
  }, [session, busy, router]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setUnconfirmed(false);
    if (!email.trim() || !password) {
      setError("Email dan password wajib diisi.");
      return;
    }
    setBusy(true);
    try {
      const s = await login(email, password);
      const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : null;
      router.replace(safeNext ?? homeFor(s));
    } catch (err) {
      setUnconfirmed(err instanceof EmailNotConfirmedError);
      setError(err instanceof Error ? err.message : "Gagal masuk.");
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Masuk" subtitle="Lorem ipsum dolor sit amet, consectetur adipiscing elit sed do.">
      <form noValidate onSubmit={onSubmit} className="stack gap-4">
        <Field id="l-email" label="Email">
          <input id="l-email" className="input" type="email" placeholder="Email akun kamu" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field id="l-pass" label="Password">
          <PasswordInput id="l-pass" placeholder="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Link href="/lupa-password/" className="text-body-sm self-end underline">
          Lupa password?
        </Link>
        {error && <Notice tone="error">{error}</Notice>}
        <button type="submit" className="btn btn-primary btn-block mt-1" disabled={busy}>
          {busy ? "Memproses…" : "Masuk"}
        </button>
      </form>
      {unconfirmed && <ResendConfirmation email={email} />}
      <p className="text-body-sm text-center">
        Belum punya akun?{" "}
        <Link href="/register/" className="text-gold-100 underline">
          Registrasi
        </Link>
      </p>
    </AuthShell>
  );
}

/** Daftar syarat password dengan centang langsung saat mengetik. */
function PasswordChecklist({ password }: { password: string }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Syarat password">
      {PASSWORD_RULES.map((rule) => {
        const ok = rule.test(password);
        return (
          <li
            key={rule.id}
            className="text-body-sm flex items-center gap-2"
            style={{ color: ok ? "var(--gold-100)" : "var(--gold-500)" }}
          >
            <span
              aria-hidden="true"
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
              style={{
                background: ok ? "var(--gold-100)" : "transparent",
                border: ok ? "none" : "1px solid var(--surface-200)",
                color: "var(--surface-page)",
              }}
            >
              {ok && <IconCheck size={10} />}
            </span>
            {rule.label}
            <span className="sr-only">{ok ? " — terpenuhi" : " — belum terpenuhi"}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Artboard: Register. Membuat akun untuk email anggota yang sudah disetujui admin. */
export function RegisterView() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  // email dari halaman Cek Status (pendaftaran yang disetujui); dikunci agar tidak salah ketik
  const [locked, setLocked] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const remembered = readRegisterEmail();
    if (remembered) {
      setEmail(remembered);
      setLocked(true);
    }
  }, []);

  const unlockEmail = () => {
    clearRegisterEmail();
    setLocked(false);
    setEmail("");
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim()) return setError("Email wajib diisi.");
    const passwordError = validatePassword(password);
    if (passwordError) return setError(passwordError);
    setBusy(true);
    try {
      const { needsConfirmation } = await registerAccount(email, password);
      if (needsConfirmation) setSentTo(email.trim().toLowerCase());
      else {
        clearRegisterEmail();
        router.replace("/akun/");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal membuat akun.");
    } finally {
      setBusy(false);
    }
  };

  if (sentTo) {
    return (
      <AuthShell title="Cek Email Kamu" subtitle={`Kami mengirim tautan konfirmasi ke ${sentTo}.`}>
        <Notice tone="success">
          Klik tautan di email tersebut untuk mengaktifkan akun. Setelah itu kamu bisa masuk dengan email
          dan password yang baru dibuat. Periksa folder spam bila belum terlihat.
        </Notice>
        <ResendConfirmation email={sentTo} />
        <Link href="/login/" className="btn btn-primary btn-block">
          Ke Halaman Login
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Buat Akun"
      subtitle="Gunakan email yang sama dengan registrasi anggota yang sudah disetujui admin."
    >
      <form noValidate onSubmit={onSubmit} className="stack gap-4">
        <Field
          id="r-email"
          label="Email"
          help={locked ? "Diambil dari pendaftaran yang kamu cek." : undefined}
        >
          <input id="r-email" className="input" type="email" placeholder="Email pendaftaran" autoComplete="email" readOnly={locked} value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        {locked && (
          <button type="button" onClick={unlockEmail} className="text-body-sm -mt-2 self-start text-gold-100 underline">
            Pakai email lain
          </button>
        )}
        <Field id="r-pass" label="Password">
          <PasswordInput
            id="r-pass"
            placeholder="Buat password"
            autoComplete="new-password"
            maxLength={PASSWORD_MAX_LENGTH}
            aria-describedby="r-pass-rules"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <div id="r-pass-rules">
          <PasswordChecklist password={password} />
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        <button type="submit" className="btn btn-primary btn-block mt-1" disabled={busy}>
          {busy ? "Memproses…" : "Buat Akun"}
        </button>
      </form>
      <p className="text-body-sm text-center">
        Sudah punya akun?{" "}
        <Link href="/login/" className="text-gold-100 underline">
          Login
        </Link>
      </p>
    </AuthShell>
  );
}

/** Minta tautan reset password lewat email. */
export function ForgotPasswordView() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError("Masukkan email yang valid.");
    setBusy(true);
    try {
      await requestPasswordReset(email);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengirim email.");
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <AuthShell title="Cek Email Kamu" subtitle="Permintaan reset password diterima.">
        <Notice tone="success">
          Jika {email.trim().toLowerCase()} terdaftar sebagai akun anggota, kami mengirim tautan untuk membuat
          password baru. Tautan berlaku sebentar; periksa folder spam bila belum terlihat.
        </Notice>
        <Link href="/login/" className="btn btn-primary btn-block">
          Kembali ke Login
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Lupa Password" subtitle="Masukkan email akunmu. Kami kirim tautan untuk membuat password baru.">
      <form noValidate onSubmit={onSubmit} className="stack gap-4">
        <Field id="f-email" label="Email">
          <input id="f-email" className="input" type="email" placeholder="Email akun kamu" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        {error && <Notice tone="error">{error}</Notice>}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "Mengirim…" : "Kirim Tautan Reset"}
        </button>
      </form>
      <p className="text-body-sm text-center">
        Ingat password?{" "}
        <Link href="/login/" className="text-gold-100 underline">
          Login
        </Link>
      </p>
    </AuthShell>
  );
}

/** Tujuan tautan email recovery: sesi recovery sudah aktif, tinggal membuat password baru. */
export function ResetPasswordView() {
  const router = useRouter();
  const [state, setState] = useState<"checking" | "ready" | "invalid">("checking");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    const sb = getSupabase();
    const check = async () => {
      const { data } = await sb.auth.getSession();
      if (alive && data.session) setState("ready");
    };
    void check();
    // sesi dari hash URL diproses asinkron oleh supabase-js
    const { data } = sb.auth.onAuthStateChange(() => setTimeout(() => void check(), 0));
    const timer = setTimeout(() => alive && setState((s) => (s === "checking" ? "invalid" : s)), 3000);
    return () => {
      alive = false;
      clearTimeout(timer);
      data.subscription.unsubscribe();
    };
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const problem = validatePassword(password);
    if (problem) return setError(problem);
    setBusy(true);
    try {
      await setNewPassword(password);
      setDone(true);
      setTimeout(() => router.replace("/login/"), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengubah password.");
      setBusy(false);
    }
  };

  if (state === "checking") {
    return (
      <AuthShell title="Reset Password" subtitle="Memeriksa tautan…">
        <div role="status" className="text-body-sm">Mohon tunggu…</div>
      </AuthShell>
    );
  }
  if (state === "invalid") {
    return (
      <AuthShell title="Tautan Tidak Valid" subtitle="Tautan reset password salah atau sudah kedaluwarsa.">
        <Link href="/lupa-password/" className="btn btn-primary btn-block">
          Minta Tautan Baru
        </Link>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Buat Password Baru" subtitle="Gunakan password yang belum pernah kamu pakai di tempat lain.">
      <form noValidate onSubmit={onSubmit} className="stack gap-4">
        <Field id="n-pass" label="Password baru">
          <PasswordInput
            id="n-pass"
            autoComplete="new-password"
            maxLength={PASSWORD_MAX_LENGTH}
            aria-describedby="n-pass-rules"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <div id="n-pass-rules">
          <PasswordChecklist password={password} />
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        {done && <Notice tone="success">Password berhasil diubah. Mengarahkan ke halaman login…</Notice>}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy || done}>
          {busy ? "Menyimpan…" : "Simpan Password"}
        </button>
      </form>
    </AuthShell>
  );
}
