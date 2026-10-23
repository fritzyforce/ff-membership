"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { IconCheck } from "@/components/ui/icons";
import { Badge, Loading, Notice, QrisImage } from "@/components/ui/primitives";
import UploadBox from "@/components/ui/upload-box";
import { getRecruitmentStatus, submitRecruitmentPayment } from "@/lib/data/recruitment";
import { RECRUITMENT_STATUS, formatRupiah } from "@/lib/format";
import { useData } from "@/lib/hooks";
import { rememberRegisterEmail } from "@/lib/register-prefill";
import type { RecruitmentPublicStatus } from "@/lib/types";

/** Kode pendaftaran anggota baru berformat REG-XXXX-XXXX (spasi/huruf kecil ditoleransi). */
export function isRecruitmentCode(query: string) {
  return /^REG-/i.test(query.trim());
}

/** Hasil cek status pendaftaran anggota baru (data minimal dari RPC publik) + pembayaran setelah pre-approved. */
export default function RecruitmentStatusCard({ code, onBack }: { code: string; onBack: () => void }) {
  const [version, setVersion] = useState(0);
  const { data, error } = useData(() => getRecruitmentStatus(code), [code, version]);
  const approvedEmail = data?.status === "approved" ? data.email : null;
  useEffect(() => rememberRegisterEmail(approvedEmail), [approvedEmail]);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (data === undefined) return <Loading label="Mencari pendaftaran…" />;
  if (data === null) {
    return (
      <>
        <Notice tone="error">
          Pendaftaran dengan kode <strong>{code}</strong> tidak ditemukan. Periksa kembali penulisannya.
        </Notice>
        <button type="button" onClick={onBack} className="btn btn-secondary btn-block">
          Coba Lagi
        </button>
      </>
    );
  }
  return <Body data={data} onChanged={() => setVersion((v) => v + 1)} />;
}

function Body({ data, onChanged }: { data: RecruitmentPublicStatus; onChanged: () => void }) {
  const status = RECRUITMENT_STATUS[data.status];
  // pendaftar tidak perlu tahu istilah internal "pre-approved": tampilkan sebagai "Diterima"
  const statusLabel = data.status === "pre_approved" ? "Diterima" : status.label;
  return (
    <>
      <div className="card stack gap-[10px]">
        <div className="row items-center justify-between">
          <div className="text-caption">{data.code}</div>
          <Badge tone={status.badge} dot={data.status === "rejected"}>
            {statusLabel}
          </Badge>
        </div>
        <h1 className="text-h2 text-[20px]">
          {data.status === "approved" ? "Selamat" : "Halo"}, {data.firstName}
          {data.status === "approved" ? "!" : ""}
        </h1>
        <div className="text-body-sm">
          {data.status === "pending" && "Pendaftaranmu sedang direview admin. Kamu akan menerima email bila pendaftaranmu diterima."}
          {data.status === "pre_approved" &&
            "Pendaftaranmu sudah diterima. Selesaikan pembayaran uang kas pertama di bawah, lalu unggah bukti pembayarannya."}
          {data.status === "payment_submitted" && "Bukti pembayaran sudah kami terima dan sedang diverifikasi admin."}
          {data.status === "approved" && "Pembayaran terverifikasi. Kamu resmi menjadi anggota Fritzy Force."}
          {data.status === "rejected" && "Mohon maaf, pendaftaranmu belum dapat kami terima."}
        </div>
      </div>

      {data.status === "pre_approved" && <Payment data={data} onSent={onChanged} />}

      {data.status === "approved" && data.memberNumber && (
        <>
          <div className="card flex flex-col items-center gap-2 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gold-100 text-surface-page">
              <IconCheck size={26} />
            </div>
            <div className="text-caption">Nomor Anggota</div>
            <div className="text-h1 text-[26px] tracking-[0.04em]">{data.memberNumber}</div>
          </div>
          <p className="text-body-sm text-center">
            Buat akun menggunakan email yang kamu daftarkan untuk mengakses profil dan riwayat pembayaran.
          </p>
          <Link href="/register/" className="btn btn-primary btn-block">
            Registrasi Akun
          </Link>
        </>
      )}

      {data.status === "rejected" && (
        <Link href="/join-us/" className="btn btn-secondary btn-block">
          Daftar Ulang
        </Link>
      )}
    </>
  );
}

/** Pembayaran uang kas pertama (QRIS) + unggah bukti. Hanya muncul saat pre-approved. */
function Payment({ data, onSent }: { data: RecruitmentPublicStatus; onSent: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!file) {
      setError("Upload bukti pembayaran terlebih dahulu.");
      return;
    }
    setSending(true);
    setError(undefined);
    try {
      await submitRecruitmentPayment(data.code, file);
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengirim bukti.");
      setSending(false);
    }
  };

  return (
    <>
      {data.paymentNote && (
        <Notice tone="error">
          Bukti pembayaran sebelumnya ditolak: <strong>{data.paymentNote}</strong>. Silakan unggah bukti yang baru.
        </Notice>
      )}
      <section className="stack gap-3">
        <h2 className="text-h2 text-[18px]">Pembayaran Uang Kas Pertama</h2>
        <div className="card flex flex-col items-center gap-3">
          <QrisImage />
          <div className="text-label text-gold-100">QRIS Fritzy Force</div>
          <div className="text-body-sm text-center">Scan untuk membayar uang kas pertama</div>
          <div className="text-h1 text-[22px]">{formatRupiah(data.amount)}</div>
          <div className="text-caption text-center">Pembayaran ini dihitung sebagai uang kas pertamamu (bulan ini).</div>
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
