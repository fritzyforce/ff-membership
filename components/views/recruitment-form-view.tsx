"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import PageTopbar from "@/components/layout/page-topbar";
import { Field, Logo, Notice } from "@/components/ui/primitives";
import { RECRUITMENT_OPEN } from "@/lib/config";
import { submitApplication, type ApplicationInput } from "@/lib/data/store";

const EMPTY: ApplicationInput = {
  fullName: "",
  birthPlace: "",
  birthDate: "",
  address: "",
  socialX: "",
  socialInstagram: "",
  socialTiktok: "",
  email: "",
  phone: "",
  lineId: "",
};

type Errors = Partial<Record<keyof ApplicationInput | "social", string>>;

function validate(v: ApplicationInput): Errors {
  const e: Errors = {};
  if (!v.fullName.trim()) e.fullName = "Nama lengkap wajib diisi.";
  if (!v.address.trim()) e.address = "Alamat domisili wajib diisi.";
  if (!v.socialX.trim() && !v.socialInstagram.trim() && !v.socialTiktok.trim()) {
    e.social = "Isi minimal salah satu akun sosial media.";
  }
  if (!v.email.trim()) e.email = "Email wajib diisi.";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) e.email = "Format email tidak valid.";
  if (!v.phone.trim()) e.phone = "No. HP wajib diisi.";
  else if (!/^(\+62|0)8\d{7,12}$/.test(v.phone.replace(/[\s-]/g, ""))) {
    e.phone = "Gunakan format 08xxxxxxxxxx.";
  }
  if (!v.lineId.trim()) e.lineId = "ID Line wajib diisi.";
  return e;
}

/** Pendaftaran anggota baru sementara ditutup (lihat RECRUITMENT_OPEN di lib/config). */
export default function RecruitmentFormView() {
  return RECRUITMENT_OPEN ? <RecruitmentForm /> : <RecruitmentClosed />;
}

function RecruitmentClosed() {
  return (
    <div className="flex min-h-screen flex-col">
      <PageTopbar title="Formulir Pendaftaran" backHref="/" />
      <main className="mx-auto flex w-full max-w-[520px] flex-1 flex-col items-center justify-center gap-5 px-6 pb-16 text-center">
        <Logo size={96} />
        <h1 className="text-h1 text-[26px]">Pendaftaran Belum Dibuka</h1>
        <p className="text-body">
          Pendaftaran anggota baru sedang ditutup sementara. Lorem ipsum dolor sit amet, consectetur
          adipiscing elit.
        </p>
        <div className="flex w-full max-w-[320px] flex-col gap-3">
          <Link href="/registrasi-ulang/" className="btn btn-primary btn-block">
            Registrasi Ulang Anggota Lama
          </Link>
          <Link href="/" className="btn btn-secondary btn-block">
            Kembali ke Beranda
          </Link>
        </div>
      </main>
    </div>
  );
}

/** Artboard: RecruitmentForm (mobile) + RecruitmentFormDesktop. */
function RecruitmentForm() {
  const router = useRouter();
  const [values, setValues] = useState<ApplicationInput>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const bind = (key: keyof ApplicationInput) => ({
    id: `f-${key}`,
    value: values[key],
    "aria-invalid": errors[key] ? true : undefined,
    onChange: (e: { target: { value: string } }) =>
      setValues((v) => ({ ...v, [key]: e.target.value })),
  });

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const found = validate(values);
    setErrors(found);
    setServerError(null);
    if (Object.keys(found).length) return;
    setSubmitting(true);
    try {
      const normalizeHandle = (h: string) =>
        h.trim() ? `@${h.trim().replace(/^@+/, "")}` : "";
      const applicant = await submitApplication({
        ...values,
        fullName: values.fullName.trim(),
        socialX: normalizeHandle(values.socialX),
        socialInstagram: normalizeHandle(values.socialInstagram),
        socialTiktok: normalizeHandle(values.socialTiktok),
      });
      router.push(`/daftar/berhasil/?kode=${encodeURIComponent(applicant.code)}`);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Gagal mengirim pendaftaran.");
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <PageTopbar title="Formulir Pendaftaran" backHref="/" />

      <div className="mx-auto grid w-full max-w-[1440px] flex-1 lg:grid-cols-[380px_minmax(0,1fr)] lg:gap-x-12 lg:px-16 lg:py-10">
        {/* Kolom info — desktop */}
        <aside className="hidden flex-col gap-5 lg:flex">
          <Logo size={88} />
          <h2 className="text-h1 text-[30px]">Gabung jadi anggota Fritzy Force</h2>
          <p className="text-body">
            Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor
            incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam.
          </p>
          <div className="card-flat stack gap-[10px]">
            <div className="text-caption">Yang perlu disiapkan</div>
            <div className="text-body-sm">• Data diri &amp; alamat domisili</div>
            <div className="text-body-sm">• Salah satu akun sosial media (X / Instagram / TikTok)</div>
            <div className="text-body-sm">• Email aktif untuk login &amp; nomor HP</div>
          </div>
        </aside>

        <form
          noValidate
          onSubmit={onSubmit}
          className="flex flex-col gap-[18px] px-6 pb-8 pt-1 lg:card lg:max-w-[760px] lg:gap-5 lg:p-6"
        >
          <p className="text-body-sm lg:hidden">
            Lorem ipsum dolor sit amet, consectetur adipiscing elit. Kolom bertanda{" "}
            <span className="field-required">*</span> wajib diisi.
          </p>

          <Field id="f-fullName" label="Nama Lengkap" required error={errors.fullName}>
            <input className="input" type="text" placeholder="Sesuai identitas resmi" autoComplete="name" {...bind("fullName")} />
          </Field>

          <div className="grid gap-[18px] lg:grid-cols-2 lg:gap-5">
            <Field id="f-birthPlace" label="Tempat Lahir">
              <input className="input" type="text" placeholder="Kota kelahiran" {...bind("birthPlace")} />
            </Field>
            <Field id="f-birthDate" label="Tanggal Lahir">
              <input className="input" type="date" {...bind("birthDate")} />
            </Field>
          </div>

          <Field id="f-address" label="Alamat Domisili" required error={errors.address}>
            <textarea
              className="input"
              rows={3}
              placeholder="Alamat lengkap tempat tinggal saat ini"
              autoComplete="street-address"
              {...bind("address")}
            />
          </Field>

          <Field label="Sosial Media" required help="Isi minimal salah satu akun di bawah ini" error={errors.social}>
            <></>
          </Field>

          <div className="grid gap-[18px] lg:grid-cols-3 lg:gap-5">
            <Field id="f-socialX" label="Username X (Twitter)">
              <input className="input" type="text" placeholder="@username" {...bind("socialX")} aria-invalid={errors.social ? true : undefined} />
            </Field>
            <Field id="f-socialInstagram" label="Username Instagram">
              <input className="input" type="text" placeholder="@username" {...bind("socialInstagram")} aria-invalid={errors.social ? true : undefined} />
            </Field>
            <Field id="f-socialTiktok" label="Username TikTok">
              <input className="input" type="text" placeholder="@username" {...bind("socialTiktok")} aria-invalid={errors.social ? true : undefined} />
            </Field>
          </div>

          <hr className="divider" />

          <div className="grid gap-[18px] lg:grid-cols-2 lg:gap-5">
            <Field
              id="f-email"
              label="Email"
              required
              help="Email ini akan dipakai untuk registrasi & login akun."
              error={errors.email}
            >
              <input className="input" type="email" placeholder="Dipakai untuk login akun" autoComplete="email" {...bind("email")} />
            </Field>
            <Field id="f-phone" label="No. HP" required error={errors.phone}>
              <input className="input" type="tel" placeholder="08xxxxxxxxxx" autoComplete="tel" {...bind("phone")} />
            </Field>
          </div>

          <Field id="f-lineId" label="ID Line" required error={errors.lineId}>
            <input className="input lg:max-w-[360px]" type="text" placeholder="ID Line aktif" {...bind("lineId")} />
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
