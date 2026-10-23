"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import PageTopbar from "@/components/layout/page-topbar";
import { Field, Logo, Notice } from "@/components/ui/primitives";
import { RECRUITMENT_OPEN } from "@/lib/config";
import { submitRecruitment } from "@/lib/data/recruitment";

type Values = {
  email: string;
  fullName: string;
  nickname: string;
  lineId: string;
  domicile: string;
  socialX: string;
  socialInstagram: string;
  socialTiktok: string;
  reason: string;
};
type Errors = Partial<Record<keyof Values | "social", string>>;

const EMPTY: Values = {
  email: "",
  fullName: "",
  nickname: "",
  lineId: "",
  domicile: "",
  socialX: "",
  socialInstagram: "",
  socialTiktok: "",
  reason: "",
};

const REASON_MAX = 1000;

// Validasi akhir ada di database (RPC submit_recruitment); ini hanya umpan balik cepat.
function validate(v: Values): Errors {
  const e: Errors = {};
  if (!v.email.trim()) e.email = "Email wajib diisi.";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) e.email = "Format email tidak valid.";
  if (!v.nickname.trim()) e.nickname = "Nickname wajib diisi.";
  if (!v.lineId.trim()) e.lineId = "ID Line wajib diisi.";
  if (!v.domicile.trim()) e.domicile = "Domisili wajib diisi.";
  if (!v.socialX.trim() && !v.socialInstagram.trim() && !v.socialTiktok.trim()) {
    e.social = "Isi minimal salah satu akun sosial media (X, Instagram, atau TikTok).";
  }
  if (!v.reason.trim()) e.reason = "Alasan bergabung wajib diisi.";
  return e;
}

/** Pendaftaran anggota baru ditutup sementara (lihat RECRUITMENT_OPEN di lib/config). */
function Closed() {
  return (
    <div className="flex min-h-screen flex-col">
      <PageTopbar title="Join Us" backHref="/" />
      <main className="mx-auto flex w-full max-w-[440px] flex-col items-center gap-5 px-8 py-10 text-center">
        <Logo size={72} />
        <h1 className="text-h1 text-[24px]">Pendaftaran belum dibuka</h1>
        <p className="text-body-sm">Pendaftaran anggota baru sedang ditutup sementara. Silakan kembali lagi nanti.</p>
      </main>
    </div>
  );
}

/** Join Us: pendaftaran anggota baru. Pembayaran dilakukan SETELAH pendaftaran diterima admin (pre-approve di sisi admin). */
export default function JoinUsView() {
  return RECRUITMENT_OPEN ? <JoinUsForm /> : <Closed />;
}

function JoinUsForm() {
  const router = useRouter();
  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const bind = (key: keyof Values) => ({
    id: `ju-${key}`,
    value: values[key],
    "aria-invalid": errors[key] || (key.startsWith("social") && errors.social) ? true : undefined,
    onChange: (e: { target: { value: string } }) => {
      setValues((v) => ({ ...v, [key]: e.target.value }));
      setErrors((x) => ({ ...x, [key]: undefined, ...(key.startsWith("social") ? { social: undefined } : {}) }));
    },
  });

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const found = validate(values);
    setErrors(found);
    setServerError(null);
    if (Object.keys(found).length) return;
    setSubmitting(true);
    try {
      const code = await submitRecruitment(values);
      router.push(`/join-us/berhasil/?kode=${encodeURIComponent(code)}`);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Gagal mengirim pendaftaran.");
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <PageTopbar title="Join Us" backHref="/" />

      <div className="mx-auto grid w-full max-w-[1440px] flex-1 lg:grid-cols-[380px_minmax(0,760px)] lg:justify-center lg:gap-x-12 lg:px-16 lg:py-10">
        {/* Kolom info — desktop */}
        <aside className="hidden flex-col gap-5 lg:flex">
          <Logo size={88} />
          <h2 className="text-h1 text-[30px]">Bergabung dengan Fritzy Force</h2>
          <ol className="text-body m-0 flex list-decimal flex-col gap-2 pl-5">
            <li>Isi formulir pendaftaran.</li>
            <li>Admin meninjau pendaftaranmu. Bila diterima, kamu menerima email.</li>
            <li>Bayar uang kas pertama lewat QRIS dan unggah bukti pembayaran.</li>
            <li>Setelah pembayaran diverifikasi, kamu resmi menjadi anggota.</li>
          </ol>
        </aside>

        <form
          noValidate
          onSubmit={onSubmit}
          className="flex flex-col gap-[18px] px-6 pb-8 pt-1 lg:card lg:max-w-[760px] lg:gap-5 lg:self-start lg:p-6"
        >
          <p className="text-body-sm">
            Kolom bertanda <span className="field-required">*</span> wajib diisi.
            <br />
            Jika pendaftaran diterima, akan diberitahukan melalui email terdaftar dan dilanjutkan dengan pembayaran uang kas
            pertama.
          </p>

          <Field id="ju-email" label="Email" required error={errors.email}>
            <input className="input" type="email" placeholder="Email aktif" autoComplete="email" {...bind("email")} />
          </Field>

          <div className="grid gap-[18px] lg:grid-cols-2 lg:gap-5">
            <Field id="ju-fullName" label="Nama Lengkap (opsional)" error={errors.fullName}>
              <input className="input" type="text" placeholder="Sesuai identitas resmi" autoComplete="name" {...bind("fullName")} />
            </Field>
            <Field id="ju-nickname" label="Nickname" required error={errors.nickname}>
              <input className="input" type="text" placeholder="Nama panggilan" autoComplete="nickname" {...bind("nickname")} />
            </Field>
            <Field id="ju-lineId" label="ID Line" required error={errors.lineId}>
              <input className="input" type="text" placeholder="ID Line aktif" {...bind("lineId")} />
            </Field>
            <Field id="ju-domicile" label="Domisili" required error={errors.domicile}>
              <input className="input" type="text" placeholder="Kota / kabupaten tempat tinggal" {...bind("domicile")} />
            </Field>
          </div>

          <fieldset className="stack m-0 gap-[10px] border-0 p-0">
            <legend className="field-label p-0">
              Sosial Media <span className="field-required">*</span>
            </legend>
            <div className="input-help">Isi minimal salah satu: X, Instagram, atau TikTok.</div>
            <div className="grid gap-[18px] lg:grid-cols-3 lg:gap-5">
              <Field id="ju-socialX" label="X (Twitter)">
                <input className="input" type="text" maxLength={60} placeholder="@username" {...bind("socialX")} />
              </Field>
              <Field id="ju-socialInstagram" label="Instagram">
                <input className="input" type="text" maxLength={60} placeholder="@username" {...bind("socialInstagram")} />
              </Field>
              <Field id="ju-socialTiktok" label="TikTok">
                <input className="input" type="text" maxLength={60} placeholder="@username" {...bind("socialTiktok")} />
              </Field>
            </div>
            {errors.social && (
              <div className="input-error" role="alert">
                {errors.social}
              </div>
            )}
          </fieldset>

          <Field
            id="ju-reason"
            label="Alasan Join Fritzy Force"
            required
            help={`${values.reason.length}/${REASON_MAX}`}
            error={errors.reason}
          >
            <textarea
              className="input"
              rows={4}
              maxLength={REASON_MAX}
              placeholder="Ceritakan kenapa kamu ingin bergabung dengan Fritzy Force"
              {...bind("reason")}
            />
          </Field>

          {serverError && <Notice tone="error">{serverError}</Notice>}

          <button
            type="submit"
            className="btn btn-primary btn-block mt-2 lg:w-auto lg:self-start lg:px-10 lg:py-4"
            disabled={submitting}
          >
            {submitting ? "Mengirim…" : "Kirim Pendaftaran"}
          </button>
        </form>
      </div>
    </div>
  );
}
