import Link from "next/link";
import type { ReactNode } from "react";

import { IconBack } from "@/components/ui/icons";
import { Logo } from "@/components/ui/primitives";
import ThemeToggle from "@/components/ui/theme-toggle";

/**
 * Topbar halaman dalam.
 * Mobile: tombol kembali + judul (artboard 390).
 * Desktop: bar penuh ber-border dengan logo (artboard 1440).
 */
export default function PageTopbar({
  title,
  backHref,
  backLabel = "Kembali",
  onBack,
  actions,
}: {
  title: string;
  backHref?: string;
  /** Dipakai bila "kembali" hanya mengubah state halaman, bukan pindah route. */
  onBack?: () => void;
  backLabel?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="topbar lg:gap-[14px] lg:border-b lg:border-surface-200 lg:px-16 lg:py-6">
      {onBack ? (
        <button type="button" onClick={onBack} className="btn-icon" aria-label={backLabel}>
          <IconBack />
        </button>
      ) : (
        backHref && (
          <Link href={backHref} className="btn-icon" aria-label={backLabel}>
            <IconBack />
          </Link>
        )
      )}
      <Logo size={30} className="hidden lg:block" />
      <div className="text-label topbar-title text-[16px] text-gold-100 lg:text-[17px] lg:font-semibold lg:leading-6">
        {title}
      </div>
      {actions}
      <ThemeToggle />
    </header>
  );
}
