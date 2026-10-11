"use client";

import Link from "next/link";

import { Logo } from "@/components/ui/primitives";
import ThemeToggle from "@/components/ui/theme-toggle";
import { isAdminRole, useSession } from "@/lib/auth";

/** Header homepage (artboard Main / MainDesktop). */
export default function PublicHeader() {
  const session = useSession();
  const dashboard = session
    ? isAdminRole(session.role)
      ? { href: "/admin/members/", label: "Admin Panel" }
      : { href: "/akun/", label: "Akun Saya" }
    : null;

  return (
    <header className="flex items-center gap-2 px-5 pb-3 pt-5 sm:gap-3 lg:border-b lg:border-surface-200 lg:px-16 lg:py-6">
      <Logo size={36} />
      <Link href="/" className="text-label flex-1 whitespace-nowrap text-gold-100 lg:text-[18px] lg:font-semibold lg:leading-6">
        Fritzy Force
      </Link>
      {dashboard ? (
        <Link href={dashboard.href} className="btn btn-secondary">
          {dashboard.label}
        </Link>
      ) : (
        <>
          {/* mobile: link teks; desktop: tombol (sesuai artboard masing-masing) */}
          <Link href="/login/" className="text-label px-[10px] py-2 text-gold-300 lg:hidden">
            Login
          </Link>
          <Link href="/register/" className="text-label px-[10px] py-2 text-gold-100 lg:hidden">
            Register
          </Link>
          <Link href="/login/" className="btn btn-ghost hidden lg:inline-flex">
            Login
          </Link>
          <Link href="/register/" className="btn btn-secondary hidden lg:inline-flex">
            Register
          </Link>
        </>
      )}
      <ThemeToggle />
    </header>
  );
}
