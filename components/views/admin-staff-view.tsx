"use client";

import { useState, type FormEvent } from "react";

import AdminShell, { AdminTopbar } from "@/components/layout/admin-shell";
import { Badge, Field, Loading, Notice } from "@/components/ui/primitives";
import { requestPasswordReset } from "@/lib/auth";
import { createStaff, listStaff, type StaffRole } from "@/lib/data/staff";
import { formatDateShort } from "@/lib/format";
import { useData } from "@/lib/hooks";
import type { Role } from "@/lib/types";

const ROLE_LABEL: Record<Role, string> = {
  member: "Member",
  admin: "Admin",
  admin_finance: "Admin Finance",
  superadmin: "Superadmin",
};

/** Superadmin: buat akun Admin / Admin Finance dan lihat daftar akun staf. */
export function AdminStaffView() {
  return (
    <AdminShell>
      {(session) =>
        session.role === "superadmin" ? (
          <StaffContent />
        ) : (
          <Notice tone="error">Halaman ini hanya untuk superadmin.</Notice>
        )
      }
    </AdminShell>
  );
}

function StaffContent() {
  const [version, setVersion] = useState(0);
  const { data, error } = useData(() => listStaff(), [version]);

  return (
    <>
      <AdminTopbar
        title="Akun Staf"
        subtitle={
          <p className="text-body-sm">
            Buat akun Admin atau Admin Finance. Staf menerima email untuk mengatur passwordnya sendiri.
          </p>
        }
      />

      <CreateForm onCreated={() => setVersion((v) => v + 1)} />

      {error && <Notice tone="error">{error}</Notice>}
      {!data && !error && <Loading />}
      {data && (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Nama</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Login Terakhir</th>
                  <th aria-label="Aksi" />
                </tr>
              </thead>
              <tbody>
                {data.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center">
                      Belum ada akun staf.
                    </td>
                  </tr>
                )}
                {data.map((s) => (
                  <tr key={s.profileId}>
                    <td className="whitespace-nowrap">{s.displayName}</td>
                    <td>{s.email}</td>
                    <td className="whitespace-nowrap">{ROLE_LABEL[s.role]}</td>
                    <td>
                      <Badge tone={s.active ? "approved" : "reject"} dot={!s.active}>
                        {s.active ? "Aktif" : "Nonaktif"}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap">
                      {s.lastSignInAt ? formatDateShort(s.lastSignInAt) : "Belum pernah"}
                    </td>
                    <td className="text-right">
                      {!s.lastSignInAt && <ResendSetup email={s.email} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function CreateForm({ onCreated }: { onCreated: () => void }) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<StaffRole>("admin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    const mail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return setError("Format email tidak valid.");
    if (!displayName.trim()) return setError("Nama wajib diisi.");
    setBusy(true);
    try {
      const { emailSent } = await createStaff({ email: mail, displayName: displayName.trim(), role });
      setResult(
        emailSent
          ? `Akun ${ROLE_LABEL[role]} untuk ${mail} dibuat. Email untuk mengatur password sudah dikirim.`
          : `Akun ${ROLE_LABEL[role]} untuk ${mail} dibuat, tetapi email atur password gagal terkirim. Gunakan "Kirim ulang email" di daftar bawah.`,
      );
      setEmail("");
      setDisplayName("");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal membuat akun.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="card stack mb-6 gap-4">
      <h2 className="text-h2 text-[18px]">Buat akun staf</h2>
      <div className="grid gap-4 lg:grid-cols-3">
        <Field id="staff-email" label="Email" required>
          <input
            id="staff-email"
            className="input"
            type="email"
            autoComplete="off"
            placeholder="email@contoh.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field id="staff-name" label="Nama" required>
          <input
            id="staff-name"
            className="input"
            type="text"
            autoComplete="off"
            placeholder="Nama staf"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </Field>
        <Field id="staff-role" label="Role" required>
          <select id="staff-role" className="input" value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
            <option value="admin">Admin (hanya lihat & kelola anggota)</option>
            <option value="admin_finance">Admin Finance (+ approve/reject)</option>
          </select>
        </Field>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {result && <Notice tone="success">{result}</Notice>}
      <button type="submit" className="btn btn-primary self-start" disabled={busy}>
        {busy ? "Membuat…" : "Buat Akun"}
      </button>
    </form>
  );
}

/** Kirim ulang email atur password untuk staf yang belum pernah login. */
function ResendSetup({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const send = async () => {
    setState("sending");
    try {
      await requestPasswordReset(email);
      setState("sent");
    } catch {
      setState("error");
    }
  };
  return (
    <button type="button" className="btn btn-sm btn-secondary" onClick={send} disabled={state === "sending"}>
      {state === "sent" ? "Email terkirim" : state === "error" ? "Gagal, coba lagi" : "Kirim ulang email"}
    </button>
  );
}
