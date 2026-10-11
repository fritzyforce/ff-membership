"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import PageTopbar from "@/components/layout/page-topbar";
import { IconCheck } from "@/components/ui/icons";
import { Badge, Field, Loading, Logo, Notice, QrisImage } from "@/components/ui/primitives";
import ReRegistrationStatusCard, { isReRegistrationCode } from "@/components/views/re-registration-status";
import UploadBox from "@/components/ui/upload-box";
import { DUES_AMOUNT } from "@/lib/config";
import { findApplicant, submitApplicantPayment } from "@/lib/data/store";
import { APPLICANT_STATUS, formatRupiah } from "@/lib/format";
import { useData } from "@/lib/hooks";
import { rememberRegisterEmail } from "@/lib/register-prefill";
import type { Applicant } from "@/lib/types";

/** Artboard: CheckStatusInput → CheckStatusPreApproved / CheckStatusApproved. */
export default function CheckStatusView() {
  // Hanya kode pendaftaran yang boleh lewat URL (?kode=); email cukup di state
  // supaya data pribadi tidak masuk ke URL / riwayat browser.
  const initialCode = useSearchParams().get("kode") ?? "";
  const [input, setInput] = useState(initialCode);
  const [query, setQuery] = useState(initialCode);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    setQuery(input.trim());
  };

  if (query) return <StatusResult query={query} onBack={() => setQuery("")} />;

  return (
    <div className="flex min-h-screen flex-col">
      <PageTopbar title="Cek Status Pendaftaran" backHref="/" />
      <main className="mx-auto flex w-full max-w-[480px] flex-col gap-5 px-6 pb-8 pt-6">
        <Logo size={72} className="self-center" />
        <p className="text-body text-center">
          Masukkan kode pendaftaran atau email yang kamu gunakan saat mendaftar.
        </p>
        <form onSubmit={onSubmit} className="stack gap-5">
          <Field id="f-check" label="Kode Pendaftaran / Email">
            <input
              id="f-check"
              className="input"
              type="text"
              placeholder="REG-… / RU-… atau email kamu"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              autoComplete="off"
            />
          </Field>
          <button type="submit" className="btn btn-primary btn-block" disabled={!input.trim()}>
            Cek Status
          </button>
        </form>
      </main>
    </div>
  );
}

function StatusResult({ query, onBack }: { query: string; onBack: () => void }) {
  return (
    <div className="flex min-h-screen flex-col">
      <PageTopbar title="Status Pendaftaran" onBack={onBack} />
      <main className="mx-auto flex w-full max-w-[480px] flex-col gap-5 px-6 pb-8 pt-2">
        {isReRegistrationCode(query) ? (
          <ReRegistrationStatusCard code={query} onBack={onBack} />
        ) : (
          <RecruitmentStatus query={query} onBack={onBack} />
        )}
      </main>
    </div>
  );
}

function RecruitmentStatus({ query, onBack }: { query: string; onBack: () => void }) {
  const { data: applicant } = useData(() => findApplicant(query), [query]);

  return (
    <>
      {applicant === undefined && <Loading label="Mencari pendaftaran…" />}
      {applicant === null && (
        <>
          <Notice tone="error">
            Pendaftaran dengan kode / email <strong>{query}</strong> tidak ditemukan. Periksa
            kembali penulisannya.
          </Notice>
          <button type="button" onClick={onBack} className="btn btn-secondary btn-block">
            Coba Lagi
          </button>
        </>
      )}
      {applicant && <StatusBody applicant={applicant} />}
    </>
  );
}

function StatusHeader({ applicant, greeting, children }: { applicant: Applicant; greeting: string; children: React.ReactNode }) {
  const status = APPLICANT_STATUS[applicant.status];
  return (
    <div className="card stack gap-[10px]">
      <div className="row items-center justify-between">
        <div className="text-caption">{applicant.code}</div>
        <Badge tone={status.badge}>{status.label}</Badge>
      </div>
      <h1 className="text-h2 text-[20px]">
        {greeting}, {applicant.fullName}
        {applicant.status === "approved" ? "!" : ""}
      </h1>
      <div className="text-body-sm">{children}</div>
    </div>
  );
}

function StatusBody({ applicant }: { applicant: Applicant }) {
  switch (applicant.status) {
    case "pending":
      return (
        <StatusHeader applicant={applicant} greeting="Halo">
          Pendaftaranmu sedang direview admin. Lorem ipsum dolor sit amet, consectetur
          adipiscing elit, sed do eiusmod tempor incididunt.
        </StatusHeader>
      );
    case "pre_approved":
      return <PreApproved applicant={applicant} />;
    case "payment_submitted":
      return (
        <>
          <StatusHeader applicant={applicant} greeting="Halo">
            Bukti pembayaran sudah kami terima dan sedang diverifikasi admin. Lorem ipsum dolor
            sit amet, consectetur adipiscing elit.
          </StatusHeader>
          <div className="card-flat row items-center justify-between gap-3">
            <span className="text-body-sm">Bukti bayar</span>
            <span className="text-body-sm truncate text-gold-100">{applicant.paymentProof}</span>
          </div>
        </>
      );
    case "approved":
      return <Approved applicant={applicant} />;
    case "rejected":
      return (
        <>
          <StatusHeader applicant={applicant} greeting="Halo">
            Mohon maaf, pendaftaranmu belum dapat kami terima. Lorem ipsum dolor sit amet,
            consectetur adipiscing elit.
          </StatusHeader>
          {applicant.reviewNote && (
            <div className="card-flat stack gap-2">
              <div className="text-caption">Catatan Admin</div>
              <div className="text-body-sm">{applicant.reviewNote}</div>
            </div>
          )}
          <Link href="/daftar/" className="btn btn-secondary btn-block">
            Daftar Ulang
          </Link>
        </>
      );
  }
}

function PreApproved({ applicant }: { applicant: Applicant }) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!file) {
      setError("Upload bukti pembayaran terlebih dahulu.");
      return;
    }
    setSending(true);
    try {
      await submitApplicantPayment(applicant.id, file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengirim bukti.");
      setSending(false);
    }
  };

  return (
    <>
      <StatusHeader applicant={applicant} greeting="Halo">
        Pendaftaranmu sudah direview. Selesaikan pembayaran uang kas untuk melanjutkan ke
        tahap aktivasi.
      </StatusHeader>
      <section className="stack gap-3">
        <h2 className="text-h2 text-[18px]">Pembayaran Uang Kas</h2>
        <div className="card flex flex-col items-center gap-3">
          <QrisImage />
          <div className="text-label text-gold-100">QRIS Fritzy Force</div>
          <div className="text-body-sm">Scan untuk membayar uang kas</div>
          <div className="text-h1 text-[22px]">{formatRupiah(DUES_AMOUNT)}</div>
          <div className="text-caption">*nominal uang kas contoh</div>
        </div>
      </section>
      <section className="stack gap-3">
        <h2 className="text-h2 text-[18px]">Upload Bukti Bayar</h2>
        <UploadBox
          file={file}
          onChange={(f) => {
            setFile(f);
            setError(undefined);
          }}
          onError={setError}
          error={error}
        />
        <button type="button" className="btn btn-primary btn-block" onClick={send} disabled={sending}>
          {sending ? "Mengirim…" : "Kirim Bukti Pembayaran"}
        </button>
      </section>
    </>
  );
}

function Approved({ applicant }: { applicant: Applicant }) {
  useEffect(() => rememberRegisterEmail(applicant.email), [applicant.email]);
  return (
    <>
      <StatusHeader applicant={applicant} greeting="Selamat">
        Pembayaran uang kas terverifikasi. Kamu resmi jadi anggota Fritzy Force.
      </StatusHeader>
      <div className="card flex flex-col items-center gap-2 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gold-100 text-surface-page">
          <IconCheck size={26} />
        </div>
        <div className="text-caption">Nomor Anggota</div>
        <div className="text-h1 text-[26px] tracking-[0.04em]">{applicant.memberNumber}</div>
      </div>
      <p className="text-body-sm text-center">
        Buat akun menggunakan email yang kamu daftarkan untuk mengakses profil dan riwayat
        pembayaran.
      </p>
      <Link href="/register/" className="btn btn-primary btn-block">
        Registrasi Akun
      </Link>
    </>
  );
}
