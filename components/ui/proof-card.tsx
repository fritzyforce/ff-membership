"use client";

import { useEffect, useState } from "react";

import { Loading, Notice } from "@/components/ui/primitives";
import { getProofUrl } from "@/lib/data/proofs";

/** Kartu bukti pembayaran (bucket privat -> URL sementara). Dipakai halaman review admin. */
export default function ProofCard({ path, title = "Bukti Pembayaran" }: { path: string; title?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setUrl(null);
    setError(null);
    getProofUrl(path)
      .then((u) => alive && setUrl(u))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : "Gagal memuat bukti."));
    return () => {
      alive = false;
    };
  }, [path]);

  return (
    <section className="card stack w-full gap-3 xl:w-[420px] xl:shrink-0">
      <h2 className="text-h2 text-[18px]">{title}</h2>
      {error && <Notice tone="error">{error}</Notice>}
      {!url && !error && <Loading label="Memuat bukti…" />}
      {url && (
        <a href={url} target="_blank" rel="noopener noreferrer" className="stack gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt="Bukti pembayaran"
            className="max-h-[420px] w-full rounded-md border border-surface-200 bg-white object-contain"
          />
          <span className="text-body-sm underline">Buka gambar ukuran penuh</span>
        </a>
      )}
    </section>
  );
}
