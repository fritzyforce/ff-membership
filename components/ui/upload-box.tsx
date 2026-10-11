"use client";

import { useId, useRef } from "react";

import { IconFile, IconUpload } from "@/components/ui/icons";

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Upload bukti bayar. Versi dummy hanya menyimpan nama file;
 * nanti diganti upload ke Supabase Storage.
 */
export default function UploadBox({
  file,
  onChange,
  error,
  onError,
}: {
  file: File | null;
  onChange: (file: File | null) => void;
  error?: string;
  onError?: (msg: string) => void;
}) {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);

  return (
    <div className="stack gap-[6px]">
      <label htmlFor={id} className="upload-box">
        {file ? (
          <>
            <IconFile size={28} style={{ color: "var(--gold-300)" }} />
            <span className="text-body-sm font-semibold" style={{ color: "var(--gold-100)" }}>
              {file.name}
            </span>
            <span className="text-caption">Klik untuk ganti file</span>
          </>
        ) : (
          <>
            <IconUpload size={28} style={{ color: "var(--gold-300)" }} />
            <span className="text-body-sm font-semibold" style={{ color: "var(--gold-100)" }}>
              Klik untuk upload bukti pembayaran
            </span>
            <span className="text-caption">JPG / PNG, maks 5MB</span>
          </>
        )}
      </label>
      <input
        ref={ref}
        id={id}
        type="file"
        accept="image/jpeg,image/png"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          if (f && !["image/jpeg", "image/png"].includes(f.type)) {
            onError?.("Format file harus JPG atau PNG.");
            e.target.value = "";
            return;
          }
          if (f && f.size > MAX_BYTES) {
            onError?.("Ukuran file maksimal 5MB.");
            e.target.value = "";
            return;
          }
          onChange(f);
        }}
      />
      {error && (
        <div className="input-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
