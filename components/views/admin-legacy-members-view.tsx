"use client";

import { useEffect, useState, type FormEvent } from "react";

import AdminShell, { AdminTopbar } from "@/components/layout/admin-shell";
import { Badge, Field, Loading, Notice, Pagination } from "@/components/ui/primitives";
import {
  addLegacyMembers,
  getLegacyCounts,
  listLegacyMembers,
  parseLegacyNumbers,
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
              aria-label="Cari nomor anggota lama"
              placeholder="Cari nomor anggota lama"
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
                  <th>Status</th>
                  <th>Anggota Baru</th>
                  <th>Registrasi Ulang</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="text-center">
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
    const numbers = parseLegacyNumbers(text);
    if (numbers.length === 0) return setError("Masukkan minimal satu nomor anggota lama.");
    setBusy(true);
    try {
      setResult(await addLegacyMembers(numbers));
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
        label="Nomor anggota lama"
        help="Satu nomor per baris (atau pisahkan dengan koma). Spasi dibuang, huruf dijadikan kapital, nomor yang sudah ada dilewati."
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
          {result.added} nomor ditambahkan, {result.duplicate} sudah ada
          {result.invalid > 0 ? `, ${result.invalid} dilewati karena formatnya tidak valid (hanya huruf, angka, . _ / -; maks. 30 karakter)` : ""}.
        </Notice>
      )}
      <button type="submit" className="btn btn-primary self-start" disabled={busy}>
        {busy ? "Menyimpan…" : "Simpan Nomor"}
      </button>
    </form>
  );
}
