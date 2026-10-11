"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import AuthGuard from "@/components/layout/auth-guard";
import { IconLogout } from "@/components/ui/icons";
import { Avatar, Badge, Field, Loading, Logo, Notice } from "@/components/ui/primitives";
import ThemeToggle from "@/components/ui/theme-toggle";
import { DuesCards, DuesSummaryCard, DuesTable, ProfileRows } from "@/components/views/member-shared";
import { logout } from "@/lib/auth";
import { getMyMember, updateMyProfile, type MemberProfileInput } from "@/lib/data/members";
import { getDuesSummary, listMyDues } from "@/lib/data/dues";
import { useData } from "@/lib/hooks";
import type { Member, Session } from "@/lib/types";

export function AccountHeader({ title, showPay }: { title: string; showPay?: boolean }) {
  const router = useRouter();
  return (
    <header className="topbar lg:gap-[14px] lg:border-b lg:border-surface-200 lg:px-16 lg:py-6">
      <Logo size={30} className="hidden lg:block" />
      <div className="text-label topbar-title text-[16px] text-gold-100 lg:text-[17px] lg:font-semibold lg:leading-6">
        {title}
      </div>
      {showPay && (
        <Link href="/akun/bayar/" className="btn btn-secondary hidden lg:inline-flex">
          Bayar Uang Kas
        </Link>
      )}
      <ThemeToggle />
      <button
        type="button"
        className="btn-icon"
        aria-label="Keluar"
        title="Keluar"
        onClick={() => {
          logout();
          router.replace("/");
        }}
      >
        <IconLogout />
      </button>
    </header>
  );
}

/** Artboard: AccountDetail (mobile) + AccountDetailDesktop. */
export default function AccountView() {
  return <AuthGuard roles={["member"]}>{(s) => <AccountContent session={s} />}</AuthGuard>;
}

function AccountContent({ session }: { session: Session }) {
  const memberId = session.memberId ?? "";
  const [version, setVersion] = useState(0);
  const { data: member, error } = useData(() => getMyMember(), [memberId, version]);
  const { data: dues, error: duesError } = useData(() => listMyDues(), [memberId]);
  const { data: summary } = useData(() => getDuesSummary(), [memberId]);
  const [editing, setEditing] = useState(false);

  return (
    <div className="flex min-h-screen flex-col">
      <AccountHeader title="Akun Saya" showPay />
      {error || duesError ? (
        <div className="p-6">
          <Notice tone="error">{error ?? duesError}</Notice>
        </div>
      ) : member === undefined || dues === undefined ? (
        <Loading />
      ) : member === null ? (
        <div className="p-6">
          <Notice tone="error">Data anggota untuk akun ini tidak ditemukan.</Notice>
        </div>
      ) : (
        <main className="mx-auto grid w-full max-w-[1440px] items-start gap-6 px-6 pb-8 pt-2 lg:grid-cols-[380px_minmax(0,1fr)] lg:gap-8 lg:px-16 lg:py-8">
          {/* Mobile: kartu identitas + blok "Profil" terpisah; desktop: satu kartu */}
          <section className="stack gap-6 lg:card lg:gap-4">
            <div className="card flex flex-col items-center gap-[10px] text-center lg:border-0 lg:bg-transparent lg:p-0">
              <Avatar name={member.fullName} size={64} />
              <h1 className="text-h2 text-[20px]">{member.fullName}</h1>
              <Badge tone="approved">Nomor Anggota: {member.memberNumber}</Badge>
              <div className="text-body-sm mt-1">{member.email}</div>
              {!editing && (
                <button type="button" className="btn btn-secondary mt-1" onClick={() => setEditing(true)}>
                  Edit Profil
                </button>
              )}
            </div>
            <hr className="divider hidden lg:block" />
            <div className="stack gap-3">
              <h2 className="text-h2 text-[18px] lg:sr-only">Profil</h2>
              <div className="card-flat stack gap-3 lg:bg-transparent lg:p-0">
                {editing ? (
                  <EditProfileForm
                    member={member}
                    onDone={() => {
                      setEditing(false);
                      setVersion((v) => v + 1);
                    }}
                    onCancel={() => setEditing(false)}
                  />
                ) : (
                  <ProfileRows member={member} />
                )}
              </div>
            </div>
          </section>

          <section className="stack gap-3 lg:gap-4">
            <div className="row items-center justify-between">
              <h2 className="text-h2 text-[18px]">Riwayat Uang Kas</h2>
              <Link href="/akun/bayar/" className="text-body-sm text-gold-100 underline lg:hidden">
                Bayar Uang Kas
              </Link>
            </div>
            {summary && <DuesSummaryCard summary={summary} />}
            <div className="stack gap-3 lg:hidden">
              <DuesCards dues={dues} />
            </div>
            <div className="hidden lg:block">
              <DuesTable dues={dues} />
            </div>
          </section>
        </main>
      )}
    </div>
  );
}

function EditProfileForm({
  member,
  onDone,
  onCancel,
}: {
  member: Member;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState<MemberProfileInput>({
    address: member.address,
    phone: member.phone,
    lineId: member.lineId,
    socialX: member.socialX,
    socialInstagram: member.socialInstagram,
    socialTiktok: member.socialTiktok,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof MemberProfileInput) => (e: { target: { value: string } }) =>
    setV((x) => ({ ...x, [k]: e.target.value }));

  // Validasi akhir ada di database (RPC update_my_member_profile); ini hanya umpan balik cepat.
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!v.address.trim() || !v.phone.trim() || !v.lineId.trim()) {
      setError("Alamat, No. HP, dan ID Line wajib diisi.");
      return;
    }
    if (!/^(\+62|0)8\d{7,12}$/.test(v.phone.replace(/[\s-]/g, ""))) {
      setError("No. HP tidak valid. Gunakan format 08xxxxxxxxxx.");
      return;
    }
    if (!v.socialX.trim() && !v.socialInstagram.trim() && !v.socialTiktok.trim()) {
      setError("Isi minimal salah satu akun sosial media.");
      return;
    }
    setBusy(true);
    try {
      await updateMyProfile(v);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan profil.");
      setBusy(false);
    }
  };

  return (
    <form className="stack gap-4" onSubmit={save} noValidate>
      <Field id="e-address" label="Alamat Domisili" required>
        <textarea id="e-address" className="input" rows={2} value={v.address} onChange={set("address")} />
      </Field>
      <Field id="e-phone" label="No. HP" required>
        <input id="e-phone" className="input" type="tel" value={v.phone} onChange={set("phone")} />
      </Field>
      <Field id="e-line" label="ID Line" required>
        <input id="e-line" className="input" type="text" value={v.lineId} onChange={set("lineId")} />
      </Field>
      <Field id="e-x" label="Username X (Twitter)">
        <input id="e-x" className="input" type="text" placeholder="@username" value={v.socialX} onChange={set("socialX")} />
      </Field>
      <Field id="e-ig" label="Username Instagram">
        <input id="e-ig" className="input" type="text" placeholder="@username" value={v.socialInstagram} onChange={set("socialInstagram")} />
      </Field>
      <Field id="e-tt" label="Username TikTok">
        <input id="e-tt" className="input" type="text" placeholder="@username" value={v.socialTiktok} onChange={set("socialTiktok")} />
      </Field>
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
