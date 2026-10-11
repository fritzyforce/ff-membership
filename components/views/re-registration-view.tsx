"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import PageTopbar from "@/components/layout/page-topbar";
import { Field, Logo, Notice, QrisImage } from "@/components/ui/primitives";
import UploadBox from "@/components/ui/upload-box";
import { DUES_AMOUNT } from "@/lib/config";
import { submitReRegistration } from "@/lib/data/re-registrations";
import { formatRupiah } from "@/lib/format";

type Values = { fullName: string; email: string; lineId: string };
type Errors = Partial<Record<keyof Values | "proof", string>>;

function validate(v: Values, file: File | null): Errors {
  const e: Errors = {};
  if (!v.fullName.trim()) e.fullName = "Nama lengkap wajib diisi.";
  if (!v.email.trim()) e.email = "Email wajib diisi.";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) e.email = "Format email tidak valid.";
  if (!v.lineId.trim()) e.lineId = "ID Line wajib diisi.";
  if (!file) e.proof = "Upload bukti pembayaran uang kas.";
  return e;
}

function QrisCard() {
  return (
    <div className="card flex flex-col items-center gap-3">
      <QrisImage />
      <div className="text-label text-gold-100">QRIS Fritzy Force</div>
      <div className="text-body-sm text-center">Scan untuk membayar uang kas</div>
      <div className="text-h1 text-[22px]">{formatRupiah(DUES_AMOUNT)}</div>
      <div className="text-caption">*nominal uang kas contoh</div>
    </div>
  );
}

/**
 * Registrasi ulang anggota lama (belum ada artboard — mengikuti pola
 * RecruitmentForm). Data masuk ke Supabase dengan status "pending" dan
 * menunggu review admin.
 */
export default function ReRegistrationView() {
  const router = useRouter();
  const [values, setValues] = useState<Values>({ fullName: "", email: "", lineId: "" });
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const bind = (key: keyof Values) => ({
    id: `ru-${key}`,
    value: values[key],
    "aria-invalid": errors[key] ? true : undefined,
    onChange: (e: { target: { value: string } }) =>
      setValues((v) => ({ ...v, [key]: e.target.value })),
  });

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const found = validate(values, file);
    setErrors(found);
    setServerError(null);
    if (Object.keys(found).length || !file) return;
    setSubmitting(true);
    try {
      const code = await submitReRegistration(values, file);
      router.push(`/registrasi-ulang/berhasil/?kode=${encodeURIComponent(code)}`);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Gagal mengirim registrasi ulang.");
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <PageTopbar title="Registrasi Ulang" backHref="/" />

      <div className="mx-auto grid w-full max-w-[1440px] flex-1 lg:grid-cols-[380px_minmax(0,760px)] lg:justify-center lg:gap-x-12 lg:px-16 lg:py-10">
        {/* Kolom info — desktop */}
        <aside className="hidden flex-col gap-5 lg:flex">
          <Logo size={88} />
          <h2 className="text-h1 text-[30px]">Registrasi ulang anggota lama</h2>
          <p className="text-body">
            Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor
            incididunt ut labore et dolore magna aliqua.
          </p>
          <QrisCard />
        </aside>

        <form
          noValidate
          onSubmit={onSubmit}
          className="flex flex-col gap-[18px] px-6 pb-8 pt-1 lg:card lg:max-w-[760px] lg:gap-5 lg:self-start lg:p-6"
        >
          <p className="text-body-sm">
            Khusus anggota lama Fritzy Force. Lorem ipsum dolor sit amet, consectetur adipiscing
            elit. Semua kolom wajib diisi dan akan direview admin.
          </p>

          <Field id="ru-fullName" label="Nama Lengkap" required error={errors.fullName}>
            <input className="input" type="text" placeholder="Sesuai identitas resmi" autoComplete="name" {...bind("fullName")} />
          </Field>

          <div className="grid gap-[18px] lg:grid-cols-2 lg:gap-5">
            <Field
              id="ru-email"
              label="Email"
              required
              help="Email ini akan dipakai untuk registrasi & login akun."
              error={errors.email}
            >
              <input className="input" type="email" placeholder="Dipakai untuk login akun" autoComplete="email" {...bind("email")} />
            </Field>
            <Field id="ru-lineId" label="ID Line" required error={errors.lineId}>
              <input className="input" type="text" placeholder="ID Line aktif" {...bind("lineId")} />
            </Field>
          </div>

          <div className="lg:hidden">
            <QrisCard />
          </div>

          <Field label="Bukti Pembayaran Uang Kas" required>
            <UploadBox
              file={file}
              onChange={(f) => {
                setFile(f);
                setErrors((x) => ({ ...x, proof: undefined }));
              }}
              onError={(msg) => setErrors((x) => ({ ...x, proof: msg }))}
              error={errors.proof}
            />
          </Field>

          {serverError && <Notice tone="error">{serverError}</Notice>}

          <button
            type="submit"
            className="btn btn-primary btn-block mt-2 lg:w-auto lg:self-start lg:px-10 lg:py-4"
            disabled={submitting}
          >
            {submitting ? "Mengirim…" : "Kirim Registrasi Ulang"}
          </button>
        </form>
      </div>
    </div>
  );
}
