"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import AdminShell, { AdminTopbar } from "@/components/layout/admin-shell";
import { IconBack } from "@/components/ui/icons";
import { Badge, Loading, Notice } from "@/components/ui/primitives";
import ProofCard from "@/components/ui/proof-card";
import {
  approveReRegistration,
  getReRegistration,
  rejectReRegistration,
} from "@/lib/data/re-registrations";
import { FINANCE_ONLY_NOTICE, canReviewFinance } from "@/lib/auth";
import { notifyReRegistrationReviewed } from "@/lib/email/notify";
import { RE_REGISTRATION_STATUS, formatDateShort, socialsOf } from "@/lib/format";
import { useData } from "@/lib/hooks";
import type { ReRegistration } from "@/lib/types";

/** Admin: cek detail + bukti bayar, lalu Approve / Reject registrasi ulang. */
export function AdminReRegistrationDetailView() {
  return <AdminShell>{(session) => <Detail canReview={canReviewFinance(session.role)} />}</AdminShell>;
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="stack gap-1">
      <div className="text-caption">{label}</div>
      <div className="text-body break-words text-gold-100">{value || "—"}</div>
    </div>
  );
}

function formatDateTime(iso: string) {
  const time = new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  return `${formatDateShort(iso)}, ${time}`;
}

function Detail({ canReview }: { canReview: boolean }) {
  const id = useSearchParams().get("id") ?? "";
  const [version, setVersion] = useState(0);
  const { data: item, error } = useData(() => getReRegistration(id), [id, version]);

  return (
    <>
      <Link href="/admin/registrasi-ulang/" className="text-body-sm mb-4 inline-flex items-center gap-[6px]">
        <IconBack size={14} />
        Kembali ke Registrasi Ulang
      </Link>
      {error && <Notice tone="error">{error}</Notice>}
      {item === undefined && !error && <Loading />}
      {item === null && <Notice tone="error">Registrasi ulang tidak ditemukan.</Notice>}
      {item && <DetailBody item={item} canReview={canReview} onChanged={() => setVersion((v) => v + 1)} />}
    </>
  );
}

function DetailBody({ item, canReview, onChanged }: { item: ReRegistration; canReview: boolean; onChanged: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const status = RE_REGISTRATION_STATUS[item.status];
  const pending = item.status === "pending" && canReview;

  const approve = async () => {
    if (!window.confirm(`Approve registrasi ulang ${item.fullName || item.nickname}? Anggota baru akan dibuat.`)) return;
    setBusy(true);
    setActionError(null);
    try {
      const number = await approveReRegistration(item.id);
      setResult(`Disetujui. Nomor anggota: ${number}. Mengirim email ke pendaftar…`);
      onChanged();
      // Kegagalan email tidak membatalkan approve; admin bisa kirim ulang dari halaman ini.
      try {
        await notifyReRegistrationReviewed(item.id);
        setResult(`Disetujui. Nomor anggota: ${number}. Email pemberitahuan terkirim ke ${item.email}.`);
      } catch (e) {
        setResult(`Disetujui. Nomor anggota: ${number}.`);
        setActionError(e instanceof Error ? e.message : "Email ke pendaftar gagal dikirim.");
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Gagal approve.");
      onChanged(); // muat ulang: mungkin sudah direview admin lain
    } finally {
      setBusy(false);
    }
  };

  const resendEmail = async () => {
    setBusy(true);
    setActionError(null);
    setResult(null);
    try {
      await notifyReRegistrationReviewed(item.id);
      setResult(`Email pemberitahuan dikirim ulang ke ${item.email}.`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Email gagal dikirim.");
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (!window.confirm(`Reject registrasi ulang ${item.fullName || item.nickname}?`)) return;
    setBusy(true);
    setActionError(null);
    try {
      await rejectReRegistration(item.id, note.trim());
      // Email penolakan belum dikirim otomatis (permintaan saat ini hanya untuk approve).
      onChanged(); // banner "Ditolak" muncul dari status terbaru
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Gagal reject.");
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <AdminTopbar
        title={item.fullName || item.nickname}
        subtitle={
          <Badge tone={status.badge} dot={item.status === "rejected"}>
            {item.code} · {status.label}
          </Badge>
        }
        actions={
          <>
            {item.status === "approved" && canReview && (
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={resendEmail}>
                {busy ? "Mengirim…" : "Kirim ulang email"}
              </button>
            )}
            {pending && (
              <>
                <button type="button" className="btn btn-outline-magenta" disabled={busy} onClick={reject}>
                  Reject
                </button>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={approve}>
                  {busy ? "Memproses…" : "Approve"}
                </button>
              </>
            )}
          </>
        }
      />

      {item.status === "pending" && !canReview && (
        <div className="mb-6">
          <Notice>{FINANCE_ONLY_NOTICE}</Notice>
        </div>
      )}
      {result && (
        <div className="mb-6">
          <Notice tone="success">{result}</Notice>
        </div>
      )}
      {item.status === "approved" && !result && (
        <div className="mb-6">
          <Notice tone="success">
            Disetujui pada {item.reviewedAt ? formatDateTime(item.reviewedAt) : "—"}. Nomor anggota:{" "}
            <strong>{item.memberNumber}</strong>
          </Notice>
        </div>
      )}
      {item.status === "rejected" && (
        <div className="mb-6">
          <Notice tone="error">
            Ditolak pada {item.reviewedAt ? formatDateTime(item.reviewedAt) : "—"}. {item.reviewNote ? `Catatan: ${item.reviewNote}` : "Tanpa catatan."}
          </Notice>
        </div>
      )}

      <div className="flex flex-col items-start gap-6 xl:flex-row">
        <section className="card grid w-full gap-5 xl:flex-1">
          <Info label="Email" value={item.email} />
          <Info label="Nama Lengkap" value={item.fullName} />
          <Info label="Nickname" value={item.nickname} />
          <Info label="ID Line" value={item.lineId} />
          <Info label="Domisili" value={item.domicile} />
          <Info label="Nomor Anggota Lama" value={item.oldMemberNumber ?? ""} />
          {socialsOf(item).map((s) => (
            <Info key={s.label} label={s.long} value={s.value} />
          ))}
          <Info label="Diajukan" value={formatDateTime(item.createdAt)} />
        </section>
        <ProofCard path={item.proofPath} title="Bukti Pembayaran Uang Kas" />
      </div>

      {pending && (
        <section className="stack mt-6 gap-3">
          <h2 className="text-h2 text-[18px]">
            <label htmlFor="review-note">Catatan Review (opsional)</label>
          </h2>
          <textarea
            id="review-note"
            className="input"
            rows={3}
            maxLength={500}
            placeholder="Opsional. Hanya dilihat admin, tidak ditampilkan ke pendaftar."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {actionError && <Notice tone="error">{actionError}</Notice>}
        </section>
      )}
      {!pending && actionError && (
        <div className="mt-6">
          <Notice tone="error">{actionError}</Notice>
        </div>
      )}
    </>
  );
}
