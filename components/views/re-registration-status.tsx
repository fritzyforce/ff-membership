"use client";

import Link from "next/link";
import { useEffect } from "react";

import { Badge, Loading, Notice } from "@/components/ui/primitives";
import { getReRegistrationStatus } from "@/lib/data/re-registrations";
import { RE_REGISTRATION_STATUS } from "@/lib/format";
import { useData } from "@/lib/hooks";
import { rememberRegisterEmail } from "@/lib/register-prefill";

/** Kode registrasi ulang berformat RU-XXXX-XXXX (spasi/huruf kecil ditoleransi). */
export function isReRegistrationCode(query: string) {
  return /^RU-/i.test(query.trim());
}

/** Hasil cek status registrasi ulang (data minimal dari RPC publik). */
export default function ReRegistrationStatusCard({
  code,
  onBack,
}: {
  code: string;
  onBack: () => void;
}) {
  const { data, error } = useData(() => getReRegistrationStatus(code), [code]);
  const approvedEmail = data?.status === "approved" ? data.email : null;
  useEffect(() => rememberRegisterEmail(approvedEmail), [approvedEmail]);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (data === undefined) return <Loading label="Mencari registrasi ulang…" />;
  if (data === null) {
    return (
      <>
        <Notice tone="error">
          Registrasi ulang dengan kode <strong>{code}</strong> tidak ditemukan. Periksa kembali
          penulisannya.
        </Notice>
        <button type="button" onClick={onBack} className="btn btn-secondary btn-block">
          Coba Lagi
        </button>
      </>
    );
  }

  const status = RE_REGISTRATION_STATUS[data.status];
  return (
    <>
      <div className="card stack gap-[10px]">
        <div className="row items-center justify-between">
          <div className="text-caption">{data.code}</div>
          <Badge tone={status.badge} dot={data.status === "rejected"}>
            {status.label}
          </Badge>
        </div>
        <h1 className="text-h2 text-[20px]">
          {data.status === "approved" ? "Selamat" : "Halo"}, {data.firstName}
          {data.status === "approved" ? "!" : ""}
        </h1>
        <div className="text-body-sm">
          {data.status === "pending" &&
            "Registrasi ulangmu sedang direview admin."}
          {data.status === "approved" &&
            "Registrasi ulangmu disetujui. Kamu kembali resmi menjadi anggota Fritzy Force."}
          {data.status === "rejected" &&
            "Mohon maaf, registrasi ulangmu belum dapat kami setujui. Kamu bisa mengajukan kembali."}
        </div>
      </div>

      {data.status === "approved" && data.memberNumber && (
        <>
          <div className="card flex flex-col items-center gap-2 text-center">
            <div className="text-caption">Nomor Anggota</div>
            <div className="text-h1 text-[26px] tracking-[0.04em]">{data.memberNumber}</div>
          </div>
          <p className="text-body-sm text-center">
            Buat akun menggunakan email yang kamu daftarkan untuk mengakses profil dan riwayat
            pembayaran.
          </p>
          <Link href="/register/" className="btn btn-primary btn-block">
            Registrasi Akun
          </Link>
        </>
      )}

      {data.status === "rejected" && (
        <>
          <Link href="/registrasi-ulang/" className="btn btn-secondary btn-block">
            Ajukan Ulang
          </Link>
        </>
      )}
    </>
  );
}
