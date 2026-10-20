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
        title="Anggota Lama"
        subtitle={
          <p className="text-body-sm">
            Daftar anggota lama yang boleh registrasi ulang. Berstatus <em>sudah registrasi ulang</em> setelah admin
            menyetujui pengajuannya.
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
              aria-label="Cari anggota lama"
              placeholder="Cari display Line / nama / nomor"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
            <button type="button" className="btn btn-primary" onClick={() => setAdding((a) => !a)}>
              {adding ? "Tutup" : "Tambah Data"}
            </button>
          </>
        }
      />

      {counts && (
        <div className="mb-6 grid grid-cols-3 gap-3">
          <Stat label="Total anggota lama" value={counts.total} />
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
                  <th>Display Line</th>
                  <th>Nama</th>
                  <th>Nomor Anggota Lama</th>
                  <th>Catatan</th>
                  <th>Lebih Bayar</th>
                  <th>Status</th>
                  <th>Anggota Baru</th>
                  <th>Registrasi Ulang</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center">
                      {counts?.total === 0 && !search && filter === "all"
                        ? "Daftar masih kosong. Klik Tambah Data untuk mengisi."
                        : "Tidak ada data yang cocok."}
                    </td>
                  </tr>
                )}
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="font-semibold" style={{ color: "var(--gold-100)" }}>
                      {r.lineDisplayName}
                    </td>
                    <td>{r.memberName || "—"}</td>
                    <td className="whitespace-nowrap">{r.oldMemberNumber ?? "—"}</td>
                    <td className="whitespace-nowrap">{r.note || "—"}</td>
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
        label="Data anggota lama (tempel dari Excel / Sheets)"
        help="Satu baris per anggota, kolom dipisah tab: Nama Anggota | Display Line (wajib) | Nomor Anggota Lama | Lebih Bayar (mis. 2 bulan). Nomor boleh kosong; tulisan seperti reset / ex admin di kolom nomor dijadikan catatan. Baris judul boleh ikut ditempel. Baris yang display name-nya sudah ada hanya diperbarui pada kolom yang terisi dan selama belum registrasi ulang. Display name (bukan ID Line) dipakai anggota untuk mencari datanya di form registrasi ulang."
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
          {result.added} baris ditambahkan, {result.updated} diperbarui, {result.duplicate} tidak berubah
          {result.invalid > 0 ? `, ${result.invalid} dilewati karena tidak valid (display name kosong/ganda, nomor tidak valid atau sudah dipakai baris lain, atau lebih bayar bukan angka 0–12)` : ""}.
        </Notice>
      )}
      <button type="submit" className="btn btn-primary self-start" disabled={busy}>
        {busy ? "Menyimpan…" : "Simpan Data"}
      </button>
    </form>
  );
}
