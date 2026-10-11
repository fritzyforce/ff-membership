"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import AdminShell, { AdminTopbar } from "@/components/layout/admin-shell";
import { IconBack } from "@/components/ui/icons";
import { Badge, Loading, Notice, Pagination } from "@/components/ui/primitives";
import { approveApplicant, getApplicant, getApplicants, rejectApplicant } from "@/lib/data/store";
import { APPLICANT_STATUS, birthLine, formatDateShort, socialsOf } from "@/lib/format";
import { useData } from "@/lib/hooks";
import type { Applicant, ApplicantStatus } from "@/lib/types";

const PAGE_SIZE = 6;

/** Label tombol approve mengikuti tahap pendaftar. */
function approveLabel(status: ApplicantStatus) {
  if (status === "pending") return "Approve";
  if (status === "payment_submitted") return "Verifikasi Bayar";
  return null;
}

function canReject(status: ApplicantStatus) {
  return status !== "approved" && status !== "rejected";
}

async function confirmReject(a: Applicant, note?: string) {
  if (!window.confirm(`Reject pendaftaran ${a.fullName} (${a.code})?`)) return false;
  await rejectApplicant(a.id, note);
  return true;
}

function StatusBadge({ status }: { status: ApplicantStatus }) {
  const s = APPLICANT_STATUS[status];
  return (
    <Badge tone={s.badge} dot={status === "rejected"}>
      {s.label}
    </Badge>
  );
}

/* ------------------------------------------------------------------ */
/* Artboard: AdminRecruitmentList                                       */
/* ------------------------------------------------------------------ */

export function AdminRecruitmentView() {
  return <AdminShell>{() => <RecruitmentList />}</AdminShell>;
}

function RecruitmentList() {
  const { data: applicants } = useData(getApplicants, []);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ApplicantStatus | "all">("all");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (applicants ?? []).filter(
      (a) =>
        (status === "all" || a.status === status) &&
        (!q ||
          a.fullName.toLowerCase().includes(q) ||
          a.code.toLowerCase().includes(q) ||
          a.email.toLowerCase().includes(q)),
    );
  }, [applicants, query, status]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  return (
    <>
      <AdminTopbar
        title="Recruitment Management"
        subtitle={<p className="text-body-sm">Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>}
        actions={
          <>
            <select
              className="input w-full md:w-auto"
              aria-label="Filter status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as ApplicantStatus | "all");
                setPage(1);
              }}
            >
              <option value="all">Semua status</option>
              {(Object.keys(APPLICANT_STATUS) as ApplicantStatus[]).map((s) => (
                <option key={s} value={s}>
                  {APPLICANT_STATUS[s].label}
                </option>
              ))}
            </select>
            <input
              className="input w-full md:w-[260px]"
              type="search"
              aria-label="Cari pendaftar"
              placeholder="Cari nama / ID rekrutmen"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
          </>
        }
      />
      {applicants === undefined ? (
        <Loading />
      ) : (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>ID Rekrutmen</th>
                  <th>Nama</th>
                  <th>Email</th>
                  <th className="hidden xl:table-cell">ID Line</th>
                  <th className="hidden xl:table-cell">Sosmed</th>
                  <th className="w-[300px]" aria-label="Aksi" />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center">
                      Tidak ada pendaftar yang cocok.
                    </td>
                  </tr>
                )}
                {rows.map((a) => {
                  const approve = approveLabel(a.status);
                  const social = socialsOf(a)[0];
                  return (
                    <tr key={a.id}>
                      <td className="whitespace-nowrap font-semibold" style={{ color: "var(--gold-100)" }}>
                        {a.code}
                      </td>
                      <td className="whitespace-nowrap">{a.fullName}</td>
                      <td>{a.email}</td>
                      <td className="hidden xl:table-cell">{a.lineId}</td>
                      <td className="hidden whitespace-nowrap xl:table-cell">{social ? `${social.label} ${social.value}` : "—"}</td>
                      <td>
                        <div className="row items-center gap-2">
                          {a.status !== "approved" && (
                            <Link href={`/admin/recruitment/detail/?id=${a.id}`} className="btn btn-secondary btn-sm">
                              Detail
                            </Link>
                          )}
                          {approve && (
                            <button type="button" className="btn btn-primary btn-sm whitespace-nowrap" onClick={() => approveApplicant(a.id)}>
                              {approve}
                            </button>
                          )}
                          {approve && canReject(a.status) && (
                            <button type="button" className="btn btn-outline-magenta btn-sm" onClick={() => confirmReject(a)}>
                              Reject
                            </button>
                          )}
                          {!approve && <StatusBadge status={a.status} />}
                        </div>
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
/* Artboard: AdminRecruitmentDetail                                     */
/* ------------------------------------------------------------------ */

export function AdminRecruitmentDetailView() {
  return <AdminShell>{() => <RecruitmentDetail />}</AdminShell>;
}

function Info({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`stack gap-1 ${wide ? "md:col-span-2" : ""}`}>
      <div className="text-caption">{label}</div>
      <div className="text-body break-words text-gold-100">{value || "—"}</div>
    </div>
  );
}

function RecruitmentDetail() {
  const id = useSearchParams().get("id") ?? "";
  const { data: a } = useData(() => getApplicant(id), [id]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (a) setNote(a.reviewNote);
  }, [a?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memproses.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Link href="/admin/recruitment/" className="text-body-sm mb-4 inline-flex items-center gap-[6px]">
        <IconBack size={14} />
        Kembali ke Recruitment Management
      </Link>
      {a === undefined ? (
        <Loading />
      ) : a === null ? (
        <Notice tone="error">Pendaftaran tidak ditemukan.</Notice>
      ) : (
        <>
          <AdminTopbar
            title={a.fullName}
            subtitle={
              <Badge tone={APPLICANT_STATUS[a.status].badge}>
                {a.code} · {APPLICANT_STATUS[a.status].label}
              </Badge>
            }
            actions={
              <>
                {canReject(a.status) && (
                  <button
                    type="button"
                    className="btn btn-outline-magenta"
                    disabled={busy}
                    onClick={() => run(() => confirmReject(a, note))}
                  >
                    Reject
                  </button>
                )}
                {approveLabel(a.status) && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() => run(() => approveApplicant(a.id, note))}
                  >
                    {approveLabel(a.status)}
                  </button>
                )}
              </>
            }
          />

          {a.status === "pre_approved" && (
            <div className="mb-6">
              <Notice>Pendaftar sudah di-approve dan sedang menunggu pembayaran uang kas.</Notice>
            </div>
          )}
          {a.status === "approved" && a.memberNumber && (
            <div className="mb-6">
              <Notice tone="success">Resmi menjadi anggota dengan nomor {a.memberNumber}.</Notice>
            </div>
          )}

          <section className="card grid gap-x-8 gap-y-5 md:grid-cols-2">
            <Info label="Nama Lengkap" value={a.fullName} />
            <Info label="Tempat, Tanggal Lahir" value={birthLine(a)} />
            <Info label="Alamat Domisili" value={a.address} wide />
            <Info label="Email" value={a.email} />
            <Info label="No. HP" value={a.phone} />
            <Info label="ID Line" value={a.lineId} />
            <Info label="Sosial Media" value={socialsOf(a).map((s) => `${s.long}: ${s.value}`).join(" · ")} />
            <Info label="Tanggal Daftar" value={formatDateShort(a.createdAt)} />
            <Info label="Bukti Bayar Uang Kas" value={a.paymentProof ?? "Belum ada"} />
          </section>

          <section className="stack mt-6 gap-3">
            <h2 className="text-h2 text-[18px]">
              <label htmlFor="review-note">Catatan Review</label>
            </h2>
            <textarea
              id="review-note"
              className="input"
              rows={3}
              placeholder="Tambahkan catatan sebelum approve/reject (opsional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={a.status === "approved" || a.status === "rejected"}
            />
            {error && <Notice tone="error">{error}</Notice>}
          </section>
        </>
      )}
    </>
  );
}
