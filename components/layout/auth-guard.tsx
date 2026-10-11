"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { Loading } from "@/components/ui/primitives";
import { isSigningOut, useSession } from "@/lib/auth";
import type { Role, Session } from "@/lib/types";

/**
 * Proteksi halaman di sisi client (static export tidak punya middleware).
 * Nanti dengan Supabase, RLS di database tetap jadi pengaman utamanya.
 */
export default function AuthGuard({
  roles,
  children,
}: {
  roles: Role[];
  children: (session: Session) => ReactNode;
}) {
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const allowed = !!session && roles.includes(session.role);

  useEffect(() => {
    if (session === undefined) return;
    if (!session) {
      if (isSigningOut()) return; // tombol Keluar sendiri yang mengarahkan
      router.replace(`/login/?next=${encodeURIComponent(pathname)}`);
    } else if (!roles.includes(session.role)) {
      router.replace(session.role === "member" ? "/akun/" : "/admin/members/");
    }
  }, [session, roles, router, pathname]);

  if (!allowed) return <Loading label="Memeriksa sesi…" />;
  return <>{children(session)}</>;
}
