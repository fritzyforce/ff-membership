import Link from "next/link";

import { Logo } from "@/components/ui/primitives";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-[440px] flex-col items-center justify-center gap-5 px-8 text-center">
      <Logo size={72} />
      <h1 className="text-h1 text-[26px]">Halaman tidak ditemukan</h1>
      <p className="text-body-sm">Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>
      <Link href="/" className="btn btn-primary">
        Kembali ke Beranda
      </Link>
    </main>
  );
}
