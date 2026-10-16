"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import AdminShell, { AdminTopbar } from "@/components/layout/admin-shell";
import { IconBack } from "@/components/ui/icons";
import { Avatar, Badge, Field, InfoRow, Loading, Notice, Pagination } from "@/components/ui/primitives";
import { DuesSummaryCard, DuesTable, ProfileRows } from "@/components/views/member-shared";
import { requestPasswordReset } from "@/lib/auth";
import { getDuesSummary, listDuesByMember } from "@/lib/data/dues";
import {
  adminSetMemberStatus,
  adminUpdateMember,
  getMemberAccount,
  getMemberById,
  listMemberAudit,
  listMembers,
  superadminLogPasswordReset,
  superadminSetAccountActive,
  superadminSetAccountRole,
  type AdminMemberInput,
  type AdminMemberRow,
  type AuditEntry,
} from "@/lib/data/members";
import { formatDateShort } from "@/lib/format";
import { useData } from "@/lib/hooks";
import type { MemberStatus, Role, Session } from "@/lib/types";

const PAGE_SIZE = 10;

const MEMBER_STATUS: Record<MemberStatus, { label: string; tone: "approved" | "pending" | "reject" }> = {
  active: { label: "Aktif", tone: "approved" },
  inactive: { label: "Nonaktif", tone: "pending" },
  revoked: { label: "Revoked", tone: "reject" },
};

const SOURCE_LABEL = { recruitment: "Rekrutmen", re_registration: "Registrasi Ulang" } as const;
const ROLE_LABEL: Record<Role, string> = {
  member: "Member",
  admin: "Admin",
  admin_finance: "Admin Finance",
  superadmin: "Superadmin",
};

function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function formatDateTime(iso: string) {
  const time = new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  return `${formatDateShort(iso)}, ${time}`;
}

/* ------------------------------------------------------------------ */
/* Daftar anggota                                                       */
/* ------------------------------------------------------------------ */

export function AdminMembersView() {
  return <AdminShell>{() => <MemberList />}</AdminShell>;
}

function MemberList() {
  const [status, setStatus] = useState<MemberStatus | "all">("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const search = useDebounced(query, 300);

  const { data, error } = useData(
    () => listMembers({ page, pageSize: PAGE_SIZE, status, query: search }),
    [page, status, search],
  );
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));
  const current = Math.min(page, pages);

  return (
    <>
      <AdminTopbar
        title="Member Management"
        subtitle={<p className="text-body-sm">Kelola data anggota resmi Fritzy Force.</p>}
        actions={
          <>
            <select
              className="input w-full md:w-auto"
              aria-label="Filter status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as MemberStatus | "all");
                setPage(1);
              }}
            >
              <option value="all">Semua status</option>
              <option value="active">Aktif</option>
              <option value="inactive">Nonaktif</option>
              <option value="revoked">Revoked</option>
            </select>
            <input
              className="input w-full md:w-[260px]"
              type="search"
              aria-label="Cari anggota"
              placeholder="Cari nama / email / no. anggota"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
          </>
        }
      />
      {error && <Notice tone="error">{error}</Notice>}
      {!data && !error && <Loading />}
      {data && (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>No. Anggota</th>
                  <th>Nama</th>
                  <th>Email</th>
                  <th className="hidden xl:table-cell">Asal</th>
                  <th>Status</th>
                  <th>Akun</th>
                  <th aria-label="Aksi" />
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center">
                      Tidak ada anggota yang cocok.
                    </td>
                  </tr>
                )}
                {data.rows.map((m) => (
                  <tr key={m.id}>
                    <td className="whitespace-nowrap font-semibold" style={{ color: "var(--gold-100)" }}>
                      {m.memberNumber}
                    </td>
                    <td className="whitespace-nowrap">{m.fullName}</td>
                    <td>{m.email}</td>
                    <td className="hidden whitespace-nowrap xl:table-cell">{SOURCE_LABEL[m.source]}</td>
                    <td>
                      <Badge tone={MEMBER_STATUS[m.status].tone} dot={m.status === "revoked"}>
                        {MEMBER_STATUS[m.status].label}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap">
                      {m.account ? (m.account.active ? "Ada" : "Dinonaktifkan") : "Belum"}
                    </td>
                    <td>
                      <Link href={`/admin/members/detail/?id=${m.id}`} className="btn btn-secondary btn-sm">
                        Detail
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && <Pagination page={current} pages={pages} onChange={setPage} />}
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Detail anggota                                                       */
/* ------------------------------------------------------------------ */

export function AdminMemberDetailView() {
  return <AdminShell>{(s) => <MemberDetail session={s} />}</AdminShell>;
}

function MemberDetail({ session }: { session: Session }) {
  const id = useSearchParams().get("id") ?? "";
  const [version, setVersion] = useState(0);
  const reload = () => setVersion((v) => v + 1);
  const { data: member, error } = useData(() => getMemberById(id), [id, version]);

  return (
    <>
      <Link href="/admin/members/" className="text-body-sm mb-4 inline-flex items-center gap-[6px]">
        <IconBack size={14} />
        Kembali ke Member Management
      </Link>
      {error && <Notice tone="error">{error}</Notice>}
      {member === undefined && !error && <Loading />}
      {member === null && <Notice tone="error">Anggota tidak ditemukan.</Notice>}
      {member && <DetailBody member={member} session={session} version={version} onChanged={reload} />}
    </>
  );
}

function DetailBody({
  member,
  session,
  version,
  onChanged,
}: {
  member: AdminMemberRow;
  session: Session;
  version: number;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const status = MEMBER_STATUS[member.status];
  const isSelf = session.memberId === member.id;

  return (
    <>
      <AdminTopbar
        title={member.fullName}
        subtitle={
          <Badge tone={status.tone} dot={member.status === "revoked"}>
            {member.memberNumber} · {status.label}
          </Badge>
        }
        actions={
          !editing && (
            <button type="button" className="btn btn-secondary" onClick={() => setEditing(true)}>
              Edit Data
            </button>
          )
        }
      />

      <div className="flex flex-col items-start gap-6 xl:flex-row">
        <section className="card stack w-full shrink-0 gap-4 xl:w-[420px]">
          <div className="flex items-center gap-[14px]">
            <Avatar name={member.fullName} size={56} />
            <div className="stack min-w-0 gap-[2px]">
              <div className="text-body font-semibold text-gold-100">{member.fullName}</div>
              <div className="text-body-sm truncate">{member.email}</div>
            </div>
          </div>
          <hr className="divider" />
          {editing ? (
            <EditMemberForm
              member={member}
              onCancel={() => setEditing(false)}
              onSaved={() => {
                setEditing(false);
                onChanged();
              }}
            />
          ) : (
            <div className="stack gap-3">
              <ProfileRows member={member} />
              <InfoRow label="Asal Keanggotaan" value={SOURCE_LABEL[member.source]} />
              <InfoRow label="Bergabung" value={formatDateShort(member.joinedAt)} />
            </div>
          )}
        </section>

        <div className="stack w-full min-w-0 flex-1 gap-5">
          <StatusPanel member={member} disabled={isSelf} onChanged={onChanged} />
          <AccountPanel member={member} version={version} />
          <DuesPanel memberId={member.id} version={version} />
          {session.role === "superadmin" && (
            <SuperadminPanel member={member} version={version} disabled={isSelf} onChanged={onChanged} />
          )}
          <AuditPanel memberId={member.id} version={version} />
        </div>
      </div>
    </>
  );
}

/* ------------------------- edit data ------------------------- */

function EditMemberForm({
  member,
  onCancel,
  onSaved,
}: {
  member: AdminMemberRow;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [v, setV] = useState<AdminMemberInput>({
    fullName: member.fullName,
    nickname: member.nickname,
    domicile: member.domicile,
    birthDate: member.birthDate,
    address: member.address,
    lineId: member.lineId,
    socialX: member.socialX,
    socialInstagram: member.socialInstagram,
    socialTiktok: member.socialTiktok,
    duesStartPeriod: member.duesStartPeriod,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof AdminMemberInput) => (e: { target: { value: string } }) =>
    setV((x) => ({ ...x, [k]: e.target.value }));

  // Validasi akhir ada di database (RPC admin_update_member).
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!v.fullName.trim()) return setError("Nama lengkap wajib diisi.");
    if (!v.nickname.trim()) return setError("Nickname wajib diisi.");
    if (!v.lineId.trim()) return setError("ID Line wajib diisi.");
    setBusy(true);
    try {
      await adminUpdateMember(member.id, v);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan.");
      setBusy(false);
    }
  };

  return (
    <form className="stack gap-4" onSubmit={save} noValidate>
      <Field id="a-name" label="Nama Lengkap" required>
        <input id="a-name" className="input" value={v.fullName} onChange={set("fullName")} />
      </Field>
      <Field id="a-nick" label="Nickname" required>
        <input id="a-nick" className="input" value={v.nickname} onChange={set("nickname")} />
      </Field>
      <Field id="a-domicile" label="Domisili">
        <input id="a-domicile" className="input" value={v.domicile} onChange={set("domicile")} />
      </Field>
      <Field id="a-birth" label="Tanggal Lahir">
        <input id="a-birth" className="input" type="date" value={v.birthDate} onChange={set("birthDate")} />
      </Field>
      <Field id="a-addr" label="Alamat Lengkap">
        <textarea id="a-addr" className="input" rows={2} value={v.address} onChange={set("address")} />
      </Field>
      <Field id="a-line" label="ID Line" required>
        <input id="a-line" className="input" value={v.lineId} onChange={set("lineId")} />
      </Field>
      <Field id="a-x" label="Username X (Twitter)">
        <input id="a-x" className="input" placeholder="@username" value={v.socialX} onChange={set("socialX")} />
      </Field>
      <Field id="a-ig" label="Username Instagram">
        <input id="a-ig" className="input" placeholder="@username" value={v.socialInstagram} onChange={set("socialInstagram")} />
      </Field>
      <Field id="a-tt" label="Username TikTok">
        <input id="a-tt" className="input" placeholder="@username" value={v.socialTiktok} onChange={set("socialTiktok")} />
      </Field>
      <Field
        id="a-dues"
        label="Iuran dihitung sejak"
        help="Bulan pertama yang ditagih uang kas (default: bulan registrasi / registrasi ulang). Ubah hanya untuk kasus khusus."
      >
        <input id="a-dues" className="input" type="month" value={v.duesStartPeriod} onChange={set("duesStartPeriod")} />
      </Field>
      <p className="input-help">Email tidak bisa diubah di sini karena menjadi penghubung ke akun login.</p>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="row gap-3">
        <button type="button" className="btn btn-secondary flex-1" onClick={onCancel}>
          Batal
        </button>
        <button type="submit" className="btn btn-primary flex-1" disabled={busy}>
          {busy ? "Menyimpan…" : "Simpan"}
        </button>
      </div>
    </form>
  );
}

/* ------------------------- status keanggotaan ------------------------- */

function StatusPanel({
  member,
  disabled,
  onChanged,
}: {
  member: AdminMemberRow;
  disabled: boolean;
  onChanged: () => void;
}) {
  const [target, setTarget] = useState<MemberStatus | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    if (!target) return;
    if (target !== "active" && !note.trim()) {
      setError("Alasan wajib diisi.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await adminSetMemberStatus(member.id, target, note.trim());
      setTarget(null);
      setNote("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengubah status.");
    } finally {
      setBusy(false);
    }
  };

  const options: { to: MemberStatus; label: string; danger?: boolean }[] =
    member.status === "active"
      ? [
          { to: "inactive", label: "Nonaktifkan" },
          { to: "revoked", label: "Revoke", danger: true },
        ]
      : [{ to: "active", label: "Pulihkan Keanggotaan" }];

  return (
    <section className="card stack gap-3">
      <h2 className="text-h2 text-[18px]">Status Keanggotaan</h2>
      <p className="text-body-sm">
        Anggota yang tidak aktif langsung kehilangan akses ke profil dan pembayarannya, meski masih login.
      </p>
      {disabled && <Notice>Kamu tidak bisa mengubah keanggotaanmu sendiri.</Notice>}
      {!target ? (
        <div className="row flex-wrap gap-3">
          {options.map((o) => (
            <button
              key={o.to}
              type="button"
              className={`btn ${o.danger ? "btn-outline-magenta" : "btn-secondary"}`}
              disabled={disabled}
              onClick={() => {
                setTarget(o.to);
                setError(null);
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="stack gap-3">
          <Field
            id="status-note"
            label={target === "active" ? "Catatan (opsional)" : "Alasan"}
            required={target !== "active"}
          >
            <textarea
              id="status-note"
              className="input"
              rows={2}
              maxLength={300}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          {error && <Notice tone="error">{error}</Notice>}
          <div className="row gap-3">
            <button type="button" className="btn btn-secondary" onClick={() => setTarget(null)} disabled={busy}>
              Batal
            </button>
            <button type="button" className="btn btn-primary" onClick={confirm} disabled={busy}>
              {busy ? "Memproses…" : `Konfirmasi: ${MEMBER_STATUS[target].label}`}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/* ------------------------- info akun ------------------------- */

function AccountPanel({ member, version }: { member: AdminMemberRow; version: number }) {
  const { data, error } = useData(() => getMemberAccount(member.id), [member.id, version]);
  return (
    <section className="card stack gap-3">
      <h2 className="text-h2 text-[18px]">Akun Login</h2>
      {error && <Notice tone="error">{error}</Notice>}
      {!data && !error && <Loading />}
      {data && !data.hasAccount && <p className="text-body-sm">Anggota ini belum membuat akun.</p>}
      {data?.hasAccount && (
        <div className="stack gap-3">
          <InfoRow label="Status akun" value={data.active ? "Aktif" : "Dinonaktifkan"} />
          <InfoRow label="Role" value={data.role ? ROLE_LABEL[data.role] : "—"} />
          <InfoRow label="Email terkonfirmasi" value={data.emailConfirmed ? "Ya" : "Belum"} />
          <InfoRow label="Dibuat" value={data.createdAt ? formatDateTime(data.createdAt) : "—"} />
          <InfoRow label="Login terakhir" value={data.lastSignInAt ? formatDateTime(data.lastSignInAt) : "Belum pernah"} />
        </div>
      )}
    </section>
  );
}

/* ------------------------- uang kas ------------------------- */

function DuesPanel({ memberId, version }: { memberId: string; version: number }) {
  const { data, error } = useData(() => listDuesByMember(memberId), [memberId, version]);
  const { data: summary } = useData(() => getDuesSummary(memberId), [memberId, version]);
  return (
    <section className="stack gap-3">
      <h2 className="text-h2 text-[18px]">Riwayat Uang Kas</h2>
      {summary && <DuesSummaryCard summary={summary} />}
      {error && <Notice tone="error">{error}</Notice>}
      {!data && !error && <Loading />}
      {data && (
        <DuesTable
          dues={data}
          action={(d) => (
            <Link
              href={`/admin/uang-kas/detail/?id=${d.id}`}
              className={`btn btn-sm ${d.status === "processing" ? "btn-primary" : "btn-secondary"}`}
            >
              {d.status === "processing" ? "Review" : "Bukti"}
            </Link>
          )}
        />
      )}
    </section>
  );
}

/* ------------------------- aksi superadmin ------------------------- */

function SuperadminPanel({
  member,
  version,
  disabled,
  onChanged,
}: {
  member: AdminMemberRow;
  version: number;
  disabled: boolean;
  onChanged: () => void;
}) {
  const { data: account } = useData(() => getMemberAccount(member.id), [member.id, version]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      setMessage(await fn());
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memproses.");
    } finally {
      setBusy(false);
    }
  };

  const hasAccount = Boolean(account?.hasAccount);

  return (
    <section className="card stack gap-[14px]" style={{ borderColor: "var(--accent-magenta)" }}>
      <div className="row items-center justify-between gap-3">
        <h2 className="text-h2 text-[18px]">Superadmin Actions</h2>
        <Badge tone="reject">Superadmin Only</Badge>
      </div>
      <p className="text-body-sm">Tindakan berikut hanya dapat dilakukan oleh superadmin dan tercatat di riwayat aktivitas.</p>
      {account && !hasAccount && (
        <p className="text-body-sm">Anggota ini belum punya akun, jadi aksi akun belum tersedia.</p>
      )}
      {disabled && hasAccount && <Notice>Kamu tidak bisa mengubah akunmu sendiri.</Notice>}

      <div className="row flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={!hasAccount || busy}
          onClick={() => {
            if (!window.confirm(`Kirim email reset password ke ${member.email}?`)) return;
            void run(async () => {
              await requestPasswordReset(member.email);
              await superadminLogPasswordReset(member.id);
              return `Email reset password dikirim ke ${member.email}.`;
            });
          }}
        >
          Kirim Email Reset Password
        </button>

        <label className="sr-only" htmlFor="role-select">
          Ubah Role Akun
        </label>
        <select
          id="role-select"
          className="input w-auto"
          value={account?.role ?? ""}
          disabled={!hasAccount || disabled || busy}
          onChange={(e) => {
            const role = e.target.value as Role;
            if (!window.confirm(`Ubah role akun ${member.email} menjadi ${ROLE_LABEL[role]}?`)) return;
            void run(async () => {
              await superadminSetAccountRole(member.id, role);
              return `Role diubah menjadi ${ROLE_LABEL[role]}.`;
            });
          }}
        >
          {!hasAccount && <option value="">Ubah Role Akun</option>}
          <option value="member">Role: Member</option>
          <option value="admin">Role: Admin</option>
          <option value="admin_finance">Role: Admin Finance</option>
          <option value="superadmin">Role: Superadmin</option>
        </select>

        <button
          type="button"
          className="btn btn-outline-magenta"
          disabled={!hasAccount || disabled || busy}
          onClick={() => {
            const next = !account?.active;
            if (!window.confirm(`${next ? "Aktifkan" : "Nonaktifkan"} akun ${member.email}?`)) return;
            void run(async () => {
              await superadminSetAccountActive(member.id, next);
              return next ? "Akun diaktifkan kembali." : "Akun dinonaktifkan.";
            });
          }}
        >
          {account?.active === false ? "Aktifkan Akun" : "Nonaktifkan Akun"}
        </button>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {message && <Notice tone="success">{message}</Notice>}
    </section>
  );
}

/* ------------------------- riwayat aktivitas ------------------------- */

function describe(e: AuditEntry): string {
  const d = e.details as Record<string, string | boolean | undefined>;
  switch (e.action) {
    case "member.updated":
      return "Data anggota diubah";
    case "member.status_changed":
      return `Status ${d.from} → ${d.to}${d.note ? ` — ${d.note}` : ""}`;
    case "account.role_changed":
      return `Role akun ${ROLE_LABEL[d.from as Role] ?? d.from} → ${ROLE_LABEL[d.to as Role] ?? d.to}`;
    case "account.active_changed":
      return d.active ? "Akun diaktifkan" : "Akun dinonaktifkan";
    case "account.password_reset_requested":
      return "Email reset password dikirim";
    default:
      return e.action;
  }
}

function AuditPanel({ memberId, version }: { memberId: string; version: number }) {
  const { data, error } = useData(() => listMemberAudit(memberId), [memberId, version]);
  return (
    <section className="stack gap-3">
      <h2 className="text-h2 text-[18px]">Riwayat Aktivitas</h2>
      {error && <Notice tone="error">{error}</Notice>}
      {!data && !error && <Loading />}
      {data && data.length === 0 && <p className="text-body-sm">Belum ada aktivitas admin pada anggota ini.</p>}
      {data && data.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {data.map((e) => (
            <li key={e.id} className="card-flat stack gap-1">
              <div className="text-body-sm text-gold-100">{describe(e)}</div>
              <div className="text-caption">
                {formatDateTime(e.createdAt)} · {e.actorName ?? "admin dihapus"}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
