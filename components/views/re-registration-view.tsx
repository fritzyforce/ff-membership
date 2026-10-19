"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";

import PageTopbar from "@/components/layout/page-topbar";
import { Field, Logo, Notice, QrisImage } from "@/components/ui/primitives";
import UploadBox from "@/components/ui/upload-box";
import { DUES_AMOUNT } from "@/lib/config";
import { checkOldMemberNumber, submitReRegistration } from "@/lib/data/re-registrations";
import { formatRupiah } from "@/lib/format";
import type { OldMemberNumberStatus } from "@/lib/types";

type Values = {
  email: string;
  fullName: string;
  nickname: string;
  lineId: string;
  domicile: string;
  oldMemberNumber: string;
  socialX: string;
  socialInstagram: string;
  socialTiktok: string;
  address: string;
  birthDate: string;
};
type Errors = Partial<Record<keyof Values | "proof" | "social", string>>;

const EMPTY: Values = {
  email: "",
  fullName: "",
  nickname: "",
  lineId: "",
  domicile: "",
  oldMemberNumber: "",
  socialX: "",
  socialInstagram: "",
  socialTiktok: "",
  address: "",
  birthDate: "",
};

const OLD_NUMBER_PROBLEM: Record<Exclude<OldMemberNumberStatus, "ok">, string> = {
  not_found:
    "Nomor anggota tidak ditemukan. Coba masukkan display name Line (bukan ID Line). Jika masih terjadi kesalahan, silakan hubungi admin.",
  ambiguous: "Display name Line itu cocok dengan lebih dari satu anggota lama. Silakan hubungi admin.",
  registered: "Nomor anggota lama ini sudah melakukan registrasi ulang.",
  in_use: "Nomor anggota lama ini sedang dipakai pada pengajuan lain yang menunggu review.",
};

const todayIso = () => new Date().toISOString().slice(0, 10);

// Validasi akhir ada di database (RPC submit_re_registration); ini hanya umpan balik cepat.
function validate(v: Values, file: File | null): Errors {
  const e: Errors = {};
  if (!v.email.trim()) e.email = "Email wajib diisi.";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) e.email = "Format email tidak valid.";
  if (!v.fullName.trim()) e.fullName = "Nama lengkap wajib diisi.";
  if (!v.nickname.trim()) e.nickname = "Nickname wajib diisi.";
  if (!v.lineId.trim()) e.lineId = "ID Line wajib diisi.";
  if (!v.domicile.trim()) e.domicile = "Domisili wajib diisi.";
  if (!v.oldMemberNumber.trim()) e.oldMemberNumber = "Nomor anggota lama wajib diisi.";
  if (!v.socialX.trim() && !v.socialInstagram.trim() && !v.socialTiktok.trim()) {
    e.social = "Isi minimal salah satu akun sosial media (X, Instagram, atau TikTok).";
  }
  if (v.birthDate && v.birthDate > todayIso()) e.birthDate = "Tanggal lahir tidak boleh di masa depan.";
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
  const [values, setValues] = useState<Values>(EMPTY);
  // hasil cek nomor anggota lama untuk nilai `checked` (null = belum / sedang dicek)
  const [oldCheck, setOldCheck] = useState<{ value: string; status: OldMemberNumberStatus; number: string | null } | null>(null);
  const checkSeq = useRef(0);
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const bind = (key: keyof Values) => ({
    id: `ru-${key}`,
    value: values[key],
    "aria-invalid": errors[key] || (key.startsWith("social") && errors.social) ? true : undefined,
    onChange: (e: { target: { value: string } }) => {
      setValues((v) => ({ ...v, [key]: e.target.value }));
      setErrors((x) => ({ ...x, [key]: undefined, ...(key.startsWith("social") ? { social: undefined } : {}) }));
    },
  });

  // Cek nomor anggota lama saat kolom ditinggalkan. Gagal cek (jaringan) diabaikan:
  // server tetap mengecek ulang saat submit.
  const verifyOldNumber = async () => {
    const value = values.oldMemberNumber.trim();
    if (!value) return;
    const seq = ++checkSeq.current;
    try {
      const { status, number } = await checkOldMemberNumber(value);
      if (seq !== checkSeq.current) return;
      setOldCheck({ value, status, number });
      setErrors((x) => ({
        ...x,
        oldMemberNumber: status === "ok" ? undefined : OLD_NUMBER_PROBLEM[status],
      }));
    } catch {
      if (seq === checkSeq.current) setOldCheck(null);
    }
  };

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
          <QrisCard />
        </aside>

        <form
          noValidate
          onSubmit={onSubmit}
          className="flex flex-col gap-[18px] px-6 pb-8 pt-1 lg:card lg:max-w-[760px] lg:gap-5 lg:self-start lg:p-6"
        >
          <p className="text-body-sm">
            Khusus anggota lama Fritzy Force. Kolom bertanda <span className="field-required">*</span> wajib
            diisi dan pengajuan akan direview admin.
          </p>

          <Field
            id="ru-email"
            label="Email"
            required
            help="Email ini akan dipakai untuk registrasi & login akun, dan menerima kabar hasil review."
            error={errors.email}
          >
            <input className="input" type="email" placeholder="Dipakai untuk login akun" autoComplete="email" {...bind("email")} />
          </Field>

          <div className="grid gap-[18px] lg:grid-cols-2 lg:gap-5">
            <Field id="ru-fullName" label="Nama Lengkap" required error={errors.fullName}>
              <input className="input" type="text" placeholder="Sesuai identitas resmi" autoComplete="name" {...bind("fullName")} />
            </Field>
            <Field id="ru-nickname" label="Nickname" required error={errors.nickname}>
              <input className="input" type="text" placeholder="Nama panggilan" autoComplete="nickname" {...bind("nickname")} />
            </Field>
            <Field id="ru-lineId" label="ID Line" required error={errors.lineId}>
              <input className="input" type="text" placeholder="ID Line aktif" {...bind("lineId")} />
            </Field>
            <Field id="ru-domicile" label="Domisili" required error={errors.domicile}>
              <input className="input" type="text" placeholder="Kota / kabupaten tempat tinggal" {...bind("domicile")} />
            </Field>
          </div>

          <Field
            id="ru-oldMemberNumber"
            label="Nomor Anggota Lama"
            required
            help={
              oldCheck?.status === "ok" && oldCheck.value === values.oldMemberNumber.trim()
                ? `Ditemukan: nomor anggota lama ${oldCheck.number}. Belum registrasi ulang.`
                : "Isi nomor anggota lamamu. Jika nomor tidak ditemukan, coba masukkan display name Line (bukan ID Line). Jika masih terjadi kesalahan, silakan hubungi admin."
            }
            error={errors.oldMemberNumber}
          >
            <input
              className="input"
              type="text"
              placeholder="Nomor anggota lama atau display name Line"
              autoComplete="off"
              {...bind("oldMemberNumber")}
              onBlur={verifyOldNumber}
            />
          </Field>

          <fieldset className="stack m-0 gap-[18px] border-0 p-0 lg:gap-5">
            <legend className="text-label p-0 text-gold-100">Data tambahan (opsional)</legend>

            <div className="grid gap-[18px] lg:grid-cols-2 lg:gap-5">
              <Field id="ru-birthDate" label="Tanggal Lahir" error={errors.birthDate}>
                <input className="input" type="date" max={todayIso()} autoComplete="bday" {...bind("birthDate")} />
              </Field>
            </div>

            <Field id="ru-address" label="Alamat Lengkap" error={errors.address}>
              <textarea className="input" rows={2} maxLength={300} placeholder="Alamat lengkap" autoComplete="street-address" {...bind("address")} />
            </Field>

          </fieldset>

          <fieldset className="stack m-0 gap-[10px] border-0 p-0">
            <legend className="field-label p-0">
              Sosial Media <span className="field-required">*</span>
            </legend>
            <div className="input-help">Isi minimal salah satu: X, Instagram, atau TikTok.</div>
            <div className="grid gap-[18px] lg:grid-cols-3 lg:gap-5">
              <Field id="ru-socialX" label="X (Twitter)">
                <input className="input" type="text" maxLength={60} placeholder="@username" {...bind("socialX")} />
              </Field>
              <Field id="ru-socialInstagram" label="Instagram">
                <input className="input" type="text" maxLength={60} placeholder="@username" {...bind("socialInstagram")} />
              </Field>
              <Field id="ru-socialTiktok" label="TikTok">
                <input className="input" type="text" maxLength={60} placeholder="@username" {...bind("socialTiktok")} />
              </Field>
            </div>
            {errors.social && (
              <div className="input-error" role="alert">
                {errors.social}
              </div>
            )}
          </fieldset>

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
