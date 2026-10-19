"use client";

import { useEffect, useState, type FormEvent } from "react";

import AdminShell, { AdminTopbar } from "@/components/layout/admin-shell";
import { Badge, Field, Loading, Notice, Pagination } from "@/components/ui/primitives";
import {
  addLegacyMembers,
  getLegacyCounts,
  listLegacyMembers,
  parseLegacyRows,
  type AddLegacyResult,
  type LegacyFilter,
} from "@/lib/data/legacy-members";
import { formatDateShort } from "@/lib/format";
import { useData } from "@/lib/hooks";

const PAGE_SIZE = 20;

/** Admin: cek daftar nomor anggota lama (sudah / belum registrasi ulang) dan tambah nomor baru. */
export function AdminLegacyMembersView() {
  return <AdminShell>{() => <LegacyList />}</AdminShell>;
}

function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function LegacyList() {
  const [filter, setFilter] = useState<LegacyFilter>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  const [adding, setAdding] = useState(false);
  const search = useDebounced(query, 300);

  const { data, error } = useData(
    () => listLegacyMembers({ page, pageSize: PAGE_SIZE, filter, query: search }),
    [page, filter, search, version],
  );
  const { data: counts } = useData(() => getLegacyCounts(), [version]);

  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));
  const current = Math.min(page, pages);

  return (
    <>
      <AdminTopbar
        title="Nomor Anggota Lama"
        subtitle={
          <p className="text-body-sm">
            Daftar nomor anggota lama yang boleh registrasi ulang. Nomor berstatus{" "}
            <em>sudah registrasi ulang</em> setelah admin menyetujui pengajuannya.
          </p>
        }
        actions={
          <>
            <select
              className="input w-full md:w-auto"
              aria-label="Filter status registrasi ulang"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value as LegacyFilter);
                setPage(1);
              }}
            >
              <option value="all">Semua</option>
              <option value="unregistered">Belum registrasi ulang</option>
              <option value="registered">Sudah registrasi ulang</option>
            </select>
            <input
              className="input w-full md:w-[220px]"
              type="search"
              aria-label="Cari nomor anggota lama atau display Line"
              placeholder="Cari nomor / display Line"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
            <button type="button" className="btn btn-primary" onClick={() => setAdding((a) => !a)}>
              {adding ? "Tutup" : "Tambah Nomor"}
            </button>
          </>
        }
      />

      {counts && (
        <div className="mb-6 grid grid-cols-3 gap-3">
          <Stat label="Total nomor" value={counts.total} />
          <Stat label="Sudah registrasi ulang" value={counts.registered} />
          <Stat label="Belum registrasi ulang" value={counts.unregistered} />
        </div>
      )}

      {adding && (
        <AddForm
          onDone={() => {
            setPage(1);
            setVersion((v) => v + 1);
          }}
        />
      )}

      {error && <Notice tone="error">{error}</Notice>}
      {!data && !error && <Loading />}
      {data && (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Nomor Anggota Lama</th>
                  <th>Display Line</th>
                  <th>Kelebihan Bayar Kas</th>
                  <th>Status</th>
                  <th>Anggota Baru</th>
                  <th>Registrasi Ulang</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center">
                      {counts?.total === 0 && !search && filter === "all"
                        ? "Daftar masih kosong. Klik Tambah Nomor untuk mengisi."
                        : "Tidak ada nomor yang cocok."}
                    </td>
                  </tr>
                )}
                {data.rows.map((r) => (
                  <tr key={r.oldMemberNumber}>
                    <td className="whitespace-nowrap font-semibold" style={{ color: "var(--gold-100)" }}>
                      {r.oldMemberNumber}
                    </td>
                    <td>{r.lineDisplayName || "—"}</td>
                    <td className="whitespace-nowrap">
                      {r.prepaidMonths > 0 ? `${r.prepaidMonths} bulan` : "—"}
                    </td>
                    <td>
                      <Badge tone={r.isRegistered ? "approved" : "pending"}>
                        {r.isRegistered ? "Sudah" : "Belum"}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap">
                      {r.member ? `${r.member.memberNumber} · ${r.member.fullName}` : "—"}
                    </td>
                    <td className="whitespace-nowrap">{formatDateShort(r.registeredAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && <Pagination page={current} pages={pages} onChange={setPage} />}
        </div>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="card-flat stack gap-1">
      <div className="text-caption">{label}</div>
      <div className="text-h2 text-[22px]">{value.toLocaleString("id-ID")}</div>
    </div>
  );
}

function AddForm({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AddLegacyResult | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    const rows = parseLegacyRows(text);
    if (rows.length === 0) return setError("Masukkan minimal satu nomor anggota lama.");
    setBusy(true);
    try {
      setResult(await addLegacyMembers(rows));
      setText("");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menambahkan nomor.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="card stack mb-6 gap-4">
      <Field
        id="legacy-numbers"
        label="Nomor anggota lama, kelebihan bayar kas, dan display name Line"
        help="Satu baris per anggota: NOMOR, kelebihan bayar (bulan, 0–12; boleh kosong), display name Line. Contoh: OLD-001, 2, Budi Santoso  /  OLD-002, , Siti Aminah. Bisa ditempel dari Excel/Sheets. Nomor yang sudah ada tetap ada; kelebihan bayar dan display name diperbarui hanya bila dicantumkan dan nomornya belum registrasi ulang. Display name dipakai anggota untuk mencari nomornya di form registrasi ulang."
      >
        <textarea
          id="legacy-numbers"
          className="input"
          rows={5}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </Field>
      {error && <Notice tone="error">{error}</Notice>}
      {result && (
        <Notice tone={result.invalid > 0 ? "error" : "success"}>
          {result.added} nomor ditambahkan, {result.updated} kelebihan bayar diperbarui, {result.duplicate} tidak berubah
          {result.invalid > 0 ? `, ${result.invalid} dilewati karena tidak valid (nomor: huruf, angka, . _ / -, maks. 30 karakter; kelebihan bayar: angka 0–12)` : ""}.
        </Notice>
      )}
      <button type="submit" className="btn btn-primary self-start" disabled={busy}>
        {busy ? "Menyimpan…" : "Simpan Nomor"}
      </button>
    </form>
  );
}
