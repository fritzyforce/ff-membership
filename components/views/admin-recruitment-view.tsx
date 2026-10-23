"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import AdminShell, { AdminTopbar } from "@/components/layout/admin-shell";
import { IconBack } from "@/components/ui/icons";
import { Badge, Loading, Notice, Pagination } from "@/components/ui/primitives";
import ProofCard from "@/components/ui/proof-card";
import { FINANCE_ONLY_NOTICE, canReviewFinance } from "@/lib/auth";
import {
  approveRecruitment,
  getRecruitment,
  listRecruitments,
  preApproveRecruitment,
  rejectRecruitment,
  rejectRecruitmentPayment,
} from "@/lib/data/recruitment";
import { notifyRecruitmentReviewed } from "@/lib/email/notify";
import { RECRUITMENT_STATUS, formatDateShort, socialsOf } from "@/lib/format";
import { useData } from "@/lib/hooks";
import type { Recruitment, RecruitmentStatus } from "@/lib/types";

const PAGE_SIZE = 10;

function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function formatDateTime(iso: string) {
  const time = new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  return `${formatDateShort(iso)}, ${time}`;
}

/* ------------------------------------------------------------------ */
/* Daftar                                                               */
/* ------------------------------------------------------------------ */

/** Admin: daftar pendaftar anggota baru (Join Us). */
export function AdminRecruitmentView() {
  return <AdminShell>{() => <RecruitmentList />}</AdminShell>;
}

/** Antrean default: yang perlu ditindaklanjuti admin = menunggu review atau bukti bayar sudah masuk. */
type Filter = RecruitmentStatus | "all";

function RecruitmentList() {
  const [status, setStatus] = useState<Filter>("pending");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const search = useDebounced(query, 300);

  const { data, error } = useData(
    () => listRecruitments({ page, pageSize: PAGE_SIZE, status, query: search }),
    [page, status, search],
  );
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));
  const current = Math.min(page, pages);

  return (
    <>
      <AdminTopbar
        title="Recruitment Management"
        subtitle={
          <p className="text-body-sm">
            Pendaftar anggota baru: pre-approve → pembayaran → approve.
          </p>
        }
        actions={
          <>
            <select
              className="input w-full md:w-auto"
              aria-label="Filter status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as Filter);
                setPage(1);
              }}
            >
              <option value="pending">Menunggu Review</option>
              <option value="payment_submitted">Verifikasi Bayar</option>
              <option value="pre_approved">Pre-approved (menunggu bayar)</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="all">Semua status</option>
            </select>
            <input
              className="input w-full md:w-[260px]"
              type="search"
              aria-label="Cari pendaftar"
              placeholder="Cari nama / email / kode"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
          </>
        }
      />

      {error && <Notice tone="error">{error}</Notice>}
      {!data && !error && <Loading />}
      {data && (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Kode</th>
                  <th>Nama</th>
                  <th>Email</th>
                  <th className="hidden xl:table-cell">Domisili</th>
                  <th>Diajukan</th>
                  <th>Status</th>
                  <th aria-label="Aksi" />
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center">
                      {status === "pending" && !search ? "Tidak ada pendaftar yang menunggu review." : "Tidak ada pendaftar yang cocok."}
                    </td>
                  </tr>
                )}
                {data.rows.map((r) => {
                  const s = RECRUITMENT_STATUS[r.status];
                  const needsAction = r.status === "pending" || r.status === "payment_submitted";
                  return (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap font-semibold" style={{ color: "var(--gold-100)" }}>
                        {r.code}
                      </td>
                      <td className="whitespace-nowrap">{r.fullName || r.nickname}</td>
                      <td>{r.email}</td>
                      <td className="hidden xl:table-cell">{r.domicile}</td>
                      <td className="whitespace-nowrap">{formatDateShort(r.createdAt)}</td>
                      <td>
                        <Badge tone={s.badge} dot={r.status === "rejected"}>
                          {s.label}
                        </Badge>
                      </td>
                      <td>
                        <Link
                          href={`/admin/recruitment/detail/?id=${r.id}`}
                          className={`btn btn-sm ${needsAction ? "btn-primary" : "btn-secondary"}`}
                        >
                          {r.status === "pending" ? "Review" : r.status === "payment_submitted" ? "Verifikasi" : "Detail"}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {pages > 1 && <Pagination page={current} pages={pages} onChange={setPage} />}
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Detail                                                               */
/* ------------------------------------------------------------------ */

/** Admin: detail pendaftar + aksi (pre-approve, tolak, tolak bukti bayar, approve). */
export function AdminRecruitmentDetailView() {
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

function Detail({ canReview }: { canReview: boolean }) {
  const id = useSearchParams().get("id") ?? "";
  const [version, setVersion] = useState(0);
  const { data: item, error } = useData(() => getRecruitment(id), [id, version]);

  return (
    <>
      <Link href="/admin/recruitment/" className="text-body-sm mb-4 inline-flex items-center gap-[6px]">
        <IconBack size={14} />
        Kembali ke Recruitment Management
      </Link>
      {error && <Notice tone="error">{error}</Notice>}
      {item === undefined && !error && <Loading />}
      {item === null && <Notice tone="error">Pendaftar tidak ditemukan.</Notice>}
      {item && <DetailBody item={item} canReview={canReview} onChanged={() => setVersion((v) => v + 1)} />}
    </>
  );
}

function DetailBody({ item, canReview, onChanged }: { item: Recruitment; canReview: boolean; onChanged: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const status = RECRUITMENT_STATUS[item.status];
  const name = item.fullName || item.nickname;
  const canAct = canReview && item.status !== "approved" && item.status !== "rejected";

  /** Jalankan aksi; kegagalan email tidak membatalkan keputusan. `mail` = kirim email setelah berhasil. */
  const run = async (action: () => Promise<string | void>, opts: { mail?: boolean; done: string }) => {
    setBusy(true);
    setActionError(null);
    setResult(null);
    try {
      const extra = await action();
      setNote("");
      setResult(`${opts.done}${typeof extra === "string" ? ` ${extra}` : ""}`);
      onChanged();
      if (opts.mail) {
        try {
          await notifyRecruitmentReviewed(item.id);
          setResult((r) => `${r ?? opts.done} Email pemberitahuan terkirim ke ${item.email}.`);
        } catch (e) {
          setActionError(e instanceof Error ? e.message : "Email ke pendaftar gagal dikirim.");
        }
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Aksi gagal.");
      onChanged(); // muat ulang: mungkin sudah diproses admin lain
    } finally {
      setBusy(false);
    }
  };

  const preApprove = () => {
    if (!window.confirm(`Pre-approve pendaftaran ${name}? Pendaftar akan menerima email untuk membayar.`)) return;
    void run(() => preApproveRecruitment(item.id), { mail: true, done: "Pre-approved." });
  };
  const reject = () => {
    if (!window.confirm(`Tolak pendaftaran ${name}?`)) return;
    void run(() => rejectRecruitment(item.id, note.trim()), { done: "Pendaftaran ditolak." });
  };
  const rejectPayment = () => {
    if (!note.trim()) {
      setActionError("Catatan wajib diisi saat menolak bukti bayar — catatan ini dilihat pendaftar.");
      return;
    }
    if (!window.confirm(`Tolak bukti bayar ${name}? Pendaftar bisa mengunggah bukti baru.`)) return;
    void run(() => rejectRecruitmentPayment(item.id, note.trim()), { done: "Bukti bayar ditolak; pendaftar bisa mengunggah ulang." });
  };
  const approve = () => {
    if (!window.confirm(`Approve ${name}? Anggota baru dibuat dan pembayaran dicatat sebagai uang kas pertama.`)) return;
    void run(async () => `Nomor anggota: ${await approveRecruitment(item.id)}.`, { mail: true, done: "Disetujui." });
  };
  const resend = () =>
    void run(async () => {
      await notifyRecruitmentReviewed(item.id);
    }, { done: `Email dikirim ulang ke ${item.email}.` });

  return (
    <>
      <AdminTopbar
        title={name}
        subtitle={
          <Badge tone={status.badge} dot={item.status === "rejected"}>
            {item.code} · {status.label}
          </Badge>
        }
        actions={
          canReview && (
            <>
              {(item.status === "pre_approved" || item.status === "approved") && (
                <button type="button" className="btn btn-secondary" disabled={busy} onClick={resend}>
                  Kirim ulang email
                </button>
              )}
              {item.status === "pending" && (
                <>
                  <button type="button" className="btn btn-outline-magenta" disabled={busy} onClick={reject}>
                    Reject
                  </button>
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={preApprove}>
                    {busy ? "Memproses…" : "Pre-approve"}
                  </button>
                </>
              )}
              {item.status === "pre_approved" && (
                <button type="button" className="btn btn-outline-magenta" disabled={busy} onClick={reject}>
                  Reject
                </button>
              )}
              {item.status === "payment_submitted" && (
                <>
                  <button type="button" className="btn btn-outline-magenta" disabled={busy} onClick={reject}>
                    Reject
                  </button>
                  <button type="button" className="btn btn-secondary" disabled={busy} onClick={rejectPayment}>
                    Tolak Bukti
                  </button>
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={approve}>
                    {busy ? "Memproses…" : "Approve"}
                  </button>
                </>
              )}
            </>
          )
        }
      />

      {!canReview && item.status !== "approved" && item.status !== "rejected" && (
        <div className="mb-6">
          <Notice>{FINANCE_ONLY_NOTICE}</Notice>
        </div>
      )}
      {result && (
        <div className="mb-6">
          <Notice tone="success">{result}</Notice>
        </div>
      )}
      {item.status === "pre_approved" && (
        <div className="mb-6">
          <Notice>
            Menunggu pendaftar membayar{item.paymentNote ? ` (bukti sebelumnya ditolak: ${item.paymentNote})` : ""}. Pre-approved pada{" "}
            {item.preApprovedAt ? formatDateTime(item.preApprovedAt) : "—"}.
          </Notice>
        </div>
      )}
      {item.status === "approved" && (
        <div className="mb-6">
          <Notice tone="success">
            Disetujui pada {item.reviewedAt ? formatDateTime(item.reviewedAt) : "—"}. Nomor anggota: <strong>{item.memberNumber}</strong>. Pembayaran
            dicatat sebagai uang kas pertama.
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
          {socialsOf(item).map((s) => (
            <Info key={s.label} label={s.long} value={s.value} />
          ))}
          <Info label="Alasan Join Fritzy Force" value={item.reason} />
          <Info label="Diajukan" value={formatDateTime(item.createdAt)} />
          {item.paymentSubmittedAt && <Info label="Bukti bayar dikirim" value={formatDateTime(item.paymentSubmittedAt)} />}
        </section>
        {item.proofPath && <ProofCard path={item.proofPath} title="Bukti Pembayaran Uang Kas Pertama" />}
      </div>

      {canAct && (item.status === "pending" || item.status === "pre_approved" || item.status === "payment_submitted") && (
        <section className="stack mt-6 gap-3">
          <h2 className="text-h2 text-[18px]">
            <label htmlFor="review-note">
              {item.status === "payment_submitted" ? "Catatan (wajib bila Tolak Bukti; dilihat pendaftar)" : "Catatan Review (opsional, hanya admin)"}
            </label>
          </h2>
          <textarea
            id="review-note"
            className="input"
            rows={3}
            maxLength={500}
            placeholder={
              item.status === "payment_submitted"
                ? "Mis. nominal kurang / bukti buram. Tampil ke pendaftar bila bukti ditolak."
                : "Opsional. Tidak ditampilkan ke pendaftar."
            }
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
