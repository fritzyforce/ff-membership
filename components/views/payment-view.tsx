"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import AuthGuard from "@/components/layout/auth-guard";
import PageTopbar from "@/components/layout/page-topbar";
import { Field, Loading, Notice, QrisImage } from "@/components/ui/primitives";
import UploadBox from "@/components/ui/upload-box";
import { getDuesSummary, getMonthlyAmount, previewDues, submitDues } from "@/lib/data/dues";
import { getMyMember } from "@/lib/data/members";
import { DuesSummaryCard } from "@/components/views/member-shared";
import { formatPeriod, formatPeriodRange, formatRupiah } from "@/lib/format";
import { useData } from "@/lib/hooks";
import type { Session } from "@/lib/types";

/** Artboard: PaymentForm (mobile) + PaymentFormDesktop. */
export default function PaymentView() {
  return <AuthGuard roles={["member"]}>{(s) => <PaymentContent session={s} />}</AuthGuard>;
}

function QrisCard() {
  return (
    <div className="card flex flex-col items-center gap-3 lg:sticky lg:top-6">
      <QrisImage />
      <div className="text-label text-gold-100">QRIS Fritzy Force</div>
      <div className="text-body-sm text-center">Scan dengan e-wallet atau m-banking</div>
    </div>
  );
}

const MAX_MONTHS = 12;

function PaymentContent({ session }: { session: Session }) {
  const router = useRouter();
  const memberId = session.memberId ?? "";
  const { data: member, error: memberError } = useData(() => getMyMember(), [memberId]);
  const { data: monthly, error: monthlyError } = useData(() => getMonthlyAmount(), [memberId]);
  const { data: summary } = useData(() => getDuesSummary(), [memberId]);

  // default: lunasi semua tunggakan sekaligus (maks. 12 bulan), minimal 1 bulan
  const [chosen, setChosen] = useState<number | null>(null);
  const months = chosen ?? Math.min(Math.max(summary?.arrearsCount ?? 1, 1), MAX_MONTHS);
  const amount = (monthly ?? 0) * months;

  // bulan apa saja yang akan dibayar: dihitung server (urut dari tunggakan paling awal)
  const [periods, setPeriods] = useState<string[] | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  useEffect(() => {
    if (!monthly) return;
    let alive = true;
    setPeriods(null);
    setPreviewError(null);
    previewDues(amount)
      .then((p) => alive && setPeriods(p))
      .catch((e: unknown) => alive && setPreviewError(e instanceof Error ? e.message : "Gagal menghitung bulan."));
    return () => {
      alive = false;
    };
  }, [amount, monthly]);

  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!file) return setFileError("Upload bukti pembayaran terlebih dahulu.");
    setBusy(true);
    try {
      await submitDues(memberId, amount, file);
      router.push("/akun/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengirim pembayaran.");
      setBusy(false);
    }
  };

  const loadError = memberError ?? monthlyError;
  return (
    <div className="flex min-h-screen flex-col">
      <PageTopbar title="Bayar Uang Kas" backHref="/akun/" />
      {loadError ? (
        <div className="p-6">
          <Notice tone="error">{loadError}</Notice>
        </div>
      ) : member === undefined || monthly === undefined || summary === undefined ? (
        <Loading />
      ) : (
        <main className="mx-auto grid w-full max-w-[1440px] items-start gap-[18px] px-6 pb-8 pt-2 lg:grid-cols-[minmax(0,640px)_380px] lg:justify-center lg:gap-x-10 lg:px-16 lg:py-10">
          <form noValidate onSubmit={onSubmit} className="flex flex-col gap-[18px] lg:card lg:max-w-[640px] lg:gap-5 lg:p-6">
            <Field id="p-anggota" label="Nomor Anggota" help="Terisi otomatis dari akun kamu">
              <input id="p-anggota" className="input" type="text" value={member?.memberNumber ?? ""} disabled />
            </Field>

            <DuesSummaryCard summary={summary} />

            <Field
              id="p-bulan"
              label="Jumlah bulan yang dibayar"
              help={`Iuran ${formatRupiah(monthly)} per bulan. Dibayarkan berurutan mulai dari bulan yang belum lunas paling awal; kelebihan otomatis untuk bulan ke depan.`}
            >
              <select id="p-bulan" className="input lg:max-w-[360px]" value={months} onChange={(e) => setChosen(Number(e.target.value))}>
                {Array.from({ length: MAX_MONTHS }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n} bulan — {formatRupiah(monthly * n)}
                  </option>
                ))}
              </select>
            </Field>

            <div className="card-flat stack gap-2" aria-live="polite">
              <div className="row items-center justify-between gap-3">
                <span className="text-body-sm">Total transfer</span>
                <span className="text-h2 text-[20px]">{formatRupiah(amount)}</span>
              </div>
              {previewError ? (
                <div className="input-error" role="alert">
                  {previewError}
                </div>
              ) : periods ? (
                <div className="text-body-sm">
                  Bulan dibayar: <span className="text-gold-100">{periods.map(formatPeriod).join(", ")}</span>
                  {periods.length > 1 && (
                    <span className="text-caption ml-2">({formatPeriodRange(periods[0], periods[periods.length - 1])})</span>
                  )}
                </div>
              ) : (
                <div className="text-body-sm">Menghitung bulan…</div>
              )}
            </div>

            <div className="lg:hidden">
              <QrisCard />
            </div>

            <Field label="Upload Bukti Bayar">
              <UploadBox
                file={file}
                onChange={(f) => {
                  setFile(f);
                  setFileError(undefined);
                }}
                onError={setFileError}
                error={fileError}
              />
            </Field>

            {error && <Notice tone="error">{error}</Notice>}

            <button
              type="submit"
              className="btn btn-primary btn-block lg:mt-2 lg:w-auto lg:self-start lg:px-10 lg:py-4"
              disabled={busy || !periods}
            >
              {busy ? "Mengirim…" : "Konfirmasi Pembayaran"}
            </button>
          </form>
          <div className="hidden lg:block">
            <QrisCard />
          </div>
        </main>
      )}
    </div>
  );
}
