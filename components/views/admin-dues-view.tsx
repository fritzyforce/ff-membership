"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import AdminShell, { AdminTopbar } from "@/components/layout/admin-shell";
import { Badge, Loading, Notice, Pagination } from "@/components/ui/primitives";
import { listDues } from "@/lib/data/dues";
import { DUES_STATUS, formatDateShort, formatPeriodRange, formatRupiah } from "@/lib/format";
import { useData } from "@/lib/hooks";
import type { DuesStatus } from "@/lib/types";

const PAGE_SIZE = 10;

/** Daftar pembayaran uang kas semua anggota; admin mengecek bukti lalu approve / reject. */
export function AdminDuesView() {
  return <AdminShell>{() => <DuesList />}</AdminShell>;
}

function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function DuesList() {
  // default ke antrean yang perlu diverifikasi
  const [status, setStatus] = useState<DuesStatus | "all">("processing");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const search = useDebounced(query, 300);

  const { data, error } = useData(
    () => listDues({ page, pageSize: PAGE_SIZE, status, query: search }),
    [page, status, search],
  );
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));
  const current = Math.min(page, pages);

  return (
    <>
      <AdminTopbar
        title="Uang Kas"
        subtitle={<p className="text-body-sm">Verifikasi pembayaran uang kas anggota: cek bukti, lalu Approve atau Reject.</p>}
        actions={
          <>
            <select
              className="input w-full md:w-auto"
              aria-label="Filter status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as DuesStatus | "all");
                setPage(1);
              }}
            >
              <option value="processing">Menunggu Verifikasi</option>
              <option value="paid">Lunas</option>
              <option value="rejected">Ditolak</option>
              <option value="all">Semua status</option>
            </select>
            <input
              className="input w-full md:w-[260px]"
              type="search"
              aria-label="Cari pembayaran"
              placeholder="Cari nama / email / no. anggota"
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
                  <th>Anggota</th>
                  <th>Periode</th>
                  <th>Nominal</th>
                  <th className="hidden xl:table-cell">Diajukan</th>
                  <th>Status</th>
                  <th aria-label="Aksi" />
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center">
                      {status === "processing" && !search
                        ? "Tidak ada pembayaran yang menunggu verifikasi."
                        : "Tidak ada pembayaran yang cocok."}
                    </td>
                  </tr>
                )}
                {data.rows.map((d) => {
                  const s = DUES_STATUS[d.status];
                  return (
                    <tr key={d.id}>
                      <td>
                        <div className="whitespace-nowrap font-semibold" style={{ color: "var(--gold-100)" }}>
                          {d.member?.fullName}
                        </div>
                        <div className="text-caption">{d.member?.memberNumber}</div>
                      </td>
                      <td className="whitespace-nowrap">
                        {formatPeriodRange(d.periodFrom, d.periodTo)}
                        <div className="text-caption">{d.months} bulan</div>
                      </td>
                      <td className="whitespace-nowrap">{formatRupiah(d.amount)}</td>
                      <td className="hidden whitespace-nowrap xl:table-cell">{formatDateShort(d.createdAt)}</td>
                      <td>
                        <Badge tone={s.badge} dot={d.status === "rejected"}>
                          {s.label}
                        </Badge>
                      </td>
                      <td>
                        <Link
                          href={`/admin/uang-kas/detail/?id=${d.id}`}
                          className={`btn btn-sm ${d.status === "processing" ? "btn-primary" : "btn-secondary"}`}
                        >
                          {d.status === "processing" ? "Review" : "Detail"}
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
