import Link from "next/link";

import PublicHeader from "@/components/layout/public-header";
import { Logo } from "@/components/ui/primitives";
import { RECRUITMENT_OPEN } from "@/lib/config";

const STEPS = [
  {
    title: "Isi formulir pendaftaran",
    body: "Lorem ipsum dolor sit amet, consectetur adipiscing elit sed do eiusmod.",
  },
  {
    title: "Verifikasi & bayar uang kas",
    body: "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi.",
  },
  {
    title: "Aktivasi akun",
    body: "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum.",
  },
];

/** Artboard: Main (mobile) + MainDesktop. */
export default function HomeView() {
  return (
    <div className="flex min-h-screen flex-col">
      <PublicHeader />

      {/* Hero */}
      <section className="mx-auto grid w-full max-w-[1440px] flex-1 items-center gap-5 px-8 pb-8 pt-6 lg:grid-cols-2 lg:gap-x-16 lg:px-16 lg:py-16">
        <div className="flex flex-col items-center gap-5 text-center lg:items-start lg:text-left">
          <Logo size={128} className="lg:hidden" />
          <h1 className="text-display text-[40px] leading-[44px] lg:text-[56px] lg:leading-[58px]">
            Fritzy Force
          </h1>
          <p className="text-body max-w-[300px] lg:max-w-[440px] lg:text-[18px] lg:leading-7">
            Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor
            incididunt ut labore et dolore magna aliqua.
          </p>
          <div className="flex w-full max-w-[320px] flex-col gap-4 lg:mt-2 lg:max-w-none lg:flex-row lg:flex-wrap">
            <Link href="/registrasi-ulang/" className="btn btn-primary btn-block whitespace-nowrap lg:w-auto lg:px-8 lg:py-4">
              Registrasi Ulang
            </Link>
            {RECRUITMENT_OPEN ? (
              <Link href="/daftar/" className="btn btn-secondary btn-block whitespace-nowrap lg:w-auto lg:px-8 lg:py-4">
                Join Us Now!
              </Link>
            ) : (
              <button
                type="button"
                disabled
                title="Pendaftaran anggota baru belum dibuka"
                className="btn btn-secondary btn-block whitespace-nowrap lg:w-auto lg:px-8 lg:py-4"
              >
                Join Us Now!
              </button>
            )}
            <Link
              href="/cek-status/"
              className="btn btn-secondary hidden whitespace-nowrap lg:inline-flex lg:px-8 lg:py-4"
            >
              Cek Status Pendaftaran
            </Link>
          </div>
          {!RECRUITMENT_OPEN && (
            <p className="text-caption">Pendaftaran anggota baru (Join Us) segera dibuka.</p>
          )}
          <p className="text-body-sm lg:hidden">
            Sudah daftar?{" "}
            <Link href="/cek-status/" className="text-gold-100 underline">
              Cek status pendaftaran
            </Link>
          </p>
        </div>
        <div className="hidden items-center justify-center lg:flex">
          <div className="card flex h-[380px] w-[380px] items-center justify-center">
            <Logo size={280} />
          </div>
        </div>
      </section>

      {/* Cara bergabung */}
      <section className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 px-8 pb-8 pt-2 lg:px-16 lg:pb-12 lg:pt-10">
        <h2 className="text-h2 text-[20px] lg:sr-only">Cara Bergabung</h2>
        <ol className="m-0 grid list-none gap-4 p-0 lg:grid-cols-3 lg:gap-6">
          {STEPS.map((step, i) => (
            <li key={step.title} className="card-flat flex items-start gap-4 lg:flex-col lg:gap-[10px]">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-surface-200 text-[14px] font-bold leading-none text-gold-100 lg:h-8 lg:w-8 lg:text-[15px]">
                {i + 1}
              </div>
              <div className="stack gap-1 lg:gap-[10px]">
                <div className="text-body font-semibold text-gold-100">{step.title}</div>
                <div className="text-body-sm">{step.body}</div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <div className="flex gap-3 px-8 pb-10 lg:hidden">
        <Link href="/login/" className="btn btn-secondary flex-1">
          Login
        </Link>
        <Link href="/register/" className="btn btn-secondary flex-1">
          Register
        </Link>
      </div>
    </div>
  );
}
