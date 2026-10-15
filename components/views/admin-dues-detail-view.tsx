"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useRef, useState } from "react";

import AdminShell, { AdminTopbar } from "@/components/layout/admin-shell";
import { IconBack } from "@/components/ui/icons";
import { Badge, Loading, Notice } from "@/components/ui/primitives";
import ProofCard from "@/components/ui/proof-card";
import { FINANCE_ONLY_NOTICE, canReviewFinance } from "@/lib/auth";
import { approveDues, getDues, rejectDues } from "@/lib/data/dues";
import { DUES_STATUS, formatDateShort, formatPeriodRange, formatRupiah } from "@/lib/format";
import { useData } from "@/lib/hooks";
import type { DuesPayment } from "@/lib/types";

/** Admin: cek bukti pembayaran uang kas, lalu Approve / Reject. */
export function AdminDuesDetailView() {
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
  const { data: item, error } = useData(() => getDues(id), [id, version]);

  return (
    <>
      <Link href="/admin/uang-kas/" className="text-body-sm mb-4 inline-flex items-center gap-[6px]">
        <IconBack size={14} />
        Kembali ke Uang Kas
      </Link>
      {error && <Notice tone="error">{error}</Notice>}
      {item === undefined && !error && <Loading />}
      {item === null && <Notice tone="error">Pembayaran tidak ditemukan.</Notice>}
      {item && <DetailBody item={item} canReview={canReview} onChanged={() => setVersion((v) => v + 1)} />}
    </>
  );
}

function DetailBody({ item, canReview, onChanged }: { item: DuesPayment; canReview: boolean; onChanged: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const status = DUES_STATUS[item.status];
  const processing = item.status === "processing" && canReview;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Gagal memproses.");
    } finally {
      setBusy(false);
      onChanged(); // muat ulang: mungkin sudah direview admin lain
    }
  };

  const approve = () => {
    if (!window.confirm(`Approve pembayaran ${formatPeriodRange(item.periodFrom, item.periodTo)} dari ${item.member?.fullName}?`)) return;
    void run(() => approveDues(item.id));
  };

  const reject = () => {
    if (!note.trim()) {
      setActionError("Catatan wajib diisi saat Reject — catatan ini bisa dilihat anggota.");
      noteRef.current?.focus();
      return;
    }
    if (!window.confirm(`Reject pembayaran ${formatPeriodRange(item.periodFrom, item.periodTo)} dari ${item.member?.fullName}?`)) return;
    void run(() => rejectDues(item.id, note.trim()));
  };

  return (
    <>
      <AdminTopbar
        title={`${formatPeriodRange(item.periodFrom, item.periodTo)} — ${item.member?.fullName ?? ""}`}
        subtitle={
          <Badge tone={status.badge} dot={item.status === "rejected"}>
            {status.label}
          </Badge>
        }
        actions={
          processing && (
            <>
              <button type="button" className="btn btn-outline-magenta" disabled={busy} onClick={reject}>
                Reject
              </button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={approve}>
                {busy ? "Memproses…" : "Approve"}
              </button>
            </>
          )
        }
      />

      {item.status === "processing" && !canReview && (
        <div className="mb-6">
          <Notice>{FINANCE_ONLY_NOTICE}</Notice>
        </div>
      )}
      {item.status === "paid" && (
        <div className="mb-6">
          <Notice tone="success">
            Disetujui pada {item.reviewedAt ? formatDateTime(item.reviewedAt) : "—"}. Tercatat lunas {formatDateShort(item.paidAt)}.
          </Notice>
        </div>
      )}
      {item.status === "rejected" && (
        <div className="mb-6">
          <Notice tone="error">
            Ditolak pada {item.reviewedAt ? formatDateTime(item.reviewedAt) : "—"}. Catatan: {item.reviewNote}
          </Notice>
        </div>
      )}

      <div className="flex flex-col items-start gap-6 xl:flex-row">
        <section className="card grid w-full gap-5 xl:flex-1">
          <div className="stack gap-1">
            <div className="text-caption">Anggota</div>
            <Link href={`/admin/members/detail/?id=${item.memberId}`} className="text-body text-gold-100 underline">
              {item.member?.memberNumber} · {item.member?.fullName}
            </Link>
          </div>
          <Info label="Email" value={item.member?.email ?? ""} />
          <Info label="Periode" value={formatPeriodRange(item.periodFrom, item.periodTo)} />
          <Info label="Jumlah bulan" value={`${item.months} bulan`} />
          <Info label="Nominal" value={formatRupiah(item.amount)} />
          <Info label="Diajukan" value={formatDateTime(item.createdAt)} />
        </section>
        <ProofCard path={item.proofPath} title="Bukti Pembayaran" />
      </div>

      {processing && (
        <section className="stack mt-6 gap-3">
          <h2 className="text-h2 text-[18px]">
            <label htmlFor="review-note">Catatan Review</label>
          </h2>
          <textarea
            id="review-note"
            ref={noteRef}
            className="input"
            rows={3}
            maxLength={500}
            placeholder="Wajib diisi bila Reject (dilihat anggota). Opsional bila Approve."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </section>
      )}
      {actionError && (
        <div className="mt-4">
          <Notice tone="error">{actionError}</Notice>
        </div>
      )}
    </>
  );
}
