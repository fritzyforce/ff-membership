"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import PageTopbar from "@/components/layout/page-topbar";
import { IconCheck, IconCopy } from "@/components/ui/icons";

const COPY = {
  recruitment: {
    title: "Pendaftaran Terkirim",
    heading: "Pendaftaran Diterima!",
    body: "Simpan kode pendaftaran di bawah ini untuk mengecek status pendaftaran.",
    label: "Kode Pendaftaran",
  },
  re_registration: {
    title: "Registrasi Ulang Terkirim",
    heading: "Registrasi Ulang Diterima!",
    body: "Pengajuanmu akan direview admin. Simpan kode di bawah ini — kamu membutuhkannya untuk mengecek status registrasi ulang.",
    label: "Kode Registrasi Ulang",
  },
} as const;

/** Artboard: RegistrationCode. Dipakai untuk pendaftaran baru & registrasi ulang. */
export default function RegistrationCodeView({
  variant = "recruitment",
}: {
  variant?: keyof typeof COPY;
}) {
  const text = COPY[variant];
  const code = useSearchParams().get("kode") ?? "";
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard diblokir: kode tetap terlihat untuk disalin manual
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <PageTopbar title={text.title} backHref="/" backLabel="Ke beranda" />
      <main className="mx-auto flex w-full max-w-[480px] flex-col items-center gap-5 px-8 py-6 text-center">
        <div className="mt-3 flex h-[72px] w-[72px] items-center justify-center rounded-full bg-gold-100 text-surface-page">
          <IconCheck size={32} />
        </div>
        <h1 className="text-h1 text-[24px]">{text.heading}</h1>
        <p className="text-body">{text.body}</p>
        <button
          type="button"
          onClick={copy}
          className="card flex w-full cursor-pointer flex-col items-center gap-2"
          aria-label={`Salin kode pendaftaran ${code}`}
        >
          <span className="text-caption">{text.label}</span>
          <span className="text-h1 text-[28px] tracking-[0.04em]">{code || "—"}</span>
          <span className="row items-center gap-2 text-gold-500">
            {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
            <span className="text-body-sm">{copied ? "Kode tersalin" : "Ketuk untuk menyalin"}</span>
          </span>
        </button>
        <Link
          href={`/cek-status/?kode=${encodeURIComponent(code)}`}
          className="btn btn-primary btn-block"
        >
          Cek Status Pendaftaran
        </Link>
        <Link href="/" className="text-body-sm underline">
          Kembali ke Beranda
        </Link>
      </main>
    </div>
  );
}
