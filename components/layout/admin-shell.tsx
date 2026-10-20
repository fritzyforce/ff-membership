"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";

import AuthGuard from "@/components/layout/auth-guard";
import { IconClipboard, IconFile, IconLogout, IconRefresh, IconUserCheck, IconUsers, IconWallet } from "@/components/ui/icons";
import { Logo } from "@/components/ui/primitives";
import ThemeToggle from "@/components/ui/theme-toggle";
import { logout } from "@/lib/auth";
import { resetDummyData } from "@/lib/data/store";
import type { Role, Session } from "@/lib/types";

const ROLE_NAME: Record<Role, string> = {
  member: "Member",
  admin: "Admin",
  admin_finance: "Admin Finance",
  superadmin: "Superadmin",
};

const NAV = [
  { href: "/admin/members/", label: "Member Management", Icon: IconUsers },
  { href: "/admin/recruitment/", label: "Recruitment Management", Icon: IconClipboard },
  { href: "/admin/registrasi-ulang/", label: "Registrasi Ulang", Icon: IconUserCheck },
  { href: "/admin/anggota-lama/", label: "Anggota Lama", Icon: IconFile },
  { href: "/admin/uang-kas/", label: "Uang Kas", Icon: IconWallet },
  { href: "/admin/staff/", label: "Akun Staf", Icon: IconUserCheck, superadminOnly: true },
];

/** Shell admin (artboard Admin*): sidebar 240px di desktop, top bar di mobile. */
export default function AdminShell({ children }: { children: (session: Session) => ReactNode }) {
  return (
    <AuthGuard roles={["admin", "admin_finance", "superadmin"]}>
      {(session) => <Shell session={session}>{children(session)}</Shell>}
    </AuthGuard>
  );
}

function Shell({ session, children }: { session: Session; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const signOut = () => {
    logout();
    router.replace("/");
  };

  const resetData = async () => {
    if (!window.confirm("Reset semua data dummy ke kondisi awal?")) return;
    await resetDummyData();
  };

  const nav = NAV.filter((n) => !n.superadminOnly || session.role === "superadmin").map(({ href, label, Icon }) => (
    <Link
      key={href}
      href={href}
      className={`admin-nav-item w-auto shrink-0 lg:w-full ${pathname.startsWith(href) ? "active" : ""}`}
      aria-current={pathname.startsWith(href) ? "page" : undefined}
    >
      <Icon />
      <span className="whitespace-nowrap lg:whitespace-normal">{label}</span>
    </Link>
  ));

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* Sidebar desktop */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-1 border-r border-surface-200 bg-surface-100 px-4 py-6 lg:flex">
        <div className="flex items-center gap-[10px] px-2 pb-6">
          <Logo size={32} />
          <div className="text-label text-[14px] text-gold-100">Fritzy Force Admin</div>
        </div>
        <nav className="stack gap-1" aria-label="Menu admin">
          {nav}
        </nav>
        <div className="flex-1" />
        <div className="px-4 pb-2">
          <div className="text-caption">{ROLE_NAME[session.role]}</div>
          <div className="text-body-sm truncate">{session.email}</div>
        </div>
        <ThemeToggle variant="nav" />
        <button type="button" className="admin-nav-item" style={{ color: "var(--gold-500)" }} onClick={resetData}>
          <IconRefresh />
          Reset data dummy
        </button>
        <button type="button" className="admin-nav-item" onClick={signOut}>
          <IconLogout />
          Keluar
        </button>
      </aside>

      {/* Top bar mobile */}
      <header className="border-b border-surface-200 bg-surface-100 lg:hidden">
        <div className="flex items-center gap-[10px] px-4 py-3">
          <Logo size={28} />
          <div className="text-label flex-1 text-[14px] text-gold-100">Fritzy Force Admin</div>
          <ThemeToggle />
          <button type="button" className="btn-icon" aria-label="Keluar" onClick={signOut}>
            <IconLogout />
          </button>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3" aria-label="Menu admin">
          {nav}
        </nav>
      </header>

      <main className="min-w-0 flex-1 px-4 py-6 lg:px-10 lg:py-8">{children}</main>
    </div>
  );
}

/** Judul halaman admin + slot aksi kanan. */
export function AdminTopbar({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col items-start justify-between gap-4 xl:flex-row">
      <div className="stack gap-1">
        <h1 className="text-h1 text-[26px]">{title}</h1>
        {subtitle}
      </div>
      {actions && <div className="row flex-wrap items-center gap-3">{actions}</div>}
    </div>
  );
}
