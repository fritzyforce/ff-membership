"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import AdminShell, { AdminTopbar } from "@/components/layout/admin-shell";
import { Badge, Loading, Notice, Pagination } from "@/components/ui/primitives";
import { listReRegistrations } from "@/lib/data/re-registrations";
import { RE_REGISTRATION_STATUS, formatDateShort } from "@/lib/format";
import { useData } from "@/lib/hooks";
import type { ReRegistrationStatus } from "@/lib/types";

const PAGE_SIZE = 10;

/** Daftar registrasi ulang anggota lama (data Supabase, review manual admin). */
export function AdminReRegistrationView() {
  return <AdminShell>{() => <ReRegistrationList />}</AdminShell>;
}

function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function ReRegistrationList() {
  // default ke antrean yang perlu di-review
  const [status, setStatus] = useState<ReRegistrationStatus | "all">("pending");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const search = useDebounced(query, 300);

  const { data, error } = useData(
    () => listReRegistrations({ page, pageSize: PAGE_SIZE, status, query: search }),
    [page, status, search],
  );

  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));
  const current = Math.min(page, pages);

  return (
    <>
      <AdminTopbar
        title="Registrasi Ulang"
        subtitle={
          <p className="text-body-sm">
            Review pengajuan registrasi ulang anggota lama, lalu Approve atau Reject.
          </p>
        }
        actions={
          <>
            <select
              className="input w-full md:w-auto"
              aria-label="Filter status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as ReRegistrationStatus | "all");
                setPage(1);
              }}
            >
              <option value="pending">Menunggu Review</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="all">Semua status</option>
            </select>
            <input
              className="input w-full md:w-[260px]"
              type="search"
              aria-label="Cari registrasi ulang"
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
                  <th className="hidden xl:table-cell">ID Line</th>
                  <th>Diajukan</th>
                  <th>Status</th>
                  <th aria-label="Aksi" />
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center">
                      {status === "pending" && !search
                        ? "Tidak ada registrasi ulang yang menunggu review."
                        : "Tidak ada registrasi ulang yang cocok."}
                    </td>
                  </tr>
                )}
                {data.rows.map((r) => {
                  const s = RE_REGISTRATION_STATUS[r.status];
                  return (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap font-semibold" style={{ color: "var(--gold-100)" }}>
                        {r.code}
                      </td>
                      <td className="whitespace-nowrap">{r.fullName}</td>
                      <td>{r.email}</td>
                      <td className="hidden xl:table-cell">{r.lineId}</td>
                      <td className="whitespace-nowrap">{formatDateShort(r.createdAt)}</td>
                      <td>
                        <Badge tone={s.badge} dot={r.status === "rejected"}>
                          {s.label}
                        </Badge>
                      </td>
                      <td>
                        <Link
                          href={`/admin/registrasi-ulang/detail/?id=${r.id}`}
                          className={`btn btn-sm ${r.status === "pending" ? "btn-primary" : "btn-secondary"}`}
                        >
                          {r.status === "pending" ? "Review" : "Detail"}
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
