import type { ReactNode } from "react";

import { initials } from "@/lib/format";

/* eslint-disable @next/next/no-img-element */

export const LOGO_SRC = "/logo.jpg";

export function Logo({ size, className = "" }: { size: number; className?: string }) {
  return (
    <img
      src={LOGO_SRC}
      alt="Fritzy Force"
      width={size}
      height={size}
      className={`shrink-0 object-contain ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

export function Badge({
  tone,
  dot,
  children,
}: {
  tone: "approved" | "pending" | "reject";
  /** Titik crimson kecil, dipakai design pada status "Rejected". */
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={`badge badge-${tone}`}>
      {children}
      {dot && <span className="badge-dot" />}
    </span>
  );
}

export function Field({
  id,
  label,
  required,
  help,
  error,
  children,
}: {
  id?: string;
  label: string;
  required?: boolean;
  help?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      {id ? (
        <label className="field-label" htmlFor={id}>
          {label} {required && <span className="field-required">*</span>}
        </label>
      ) : (
        <div className="field-label">
          {label} {required && <span className="field-required">*</span>}
        </div>
      )}
      {children}
      {error ? (
        <div className="input-error" role="alert">
          {error}
        </div>
      ) : (
        help && <div className="input-help">{help}</div>
      )}
    </div>
  );
}

/** Baris label–nilai di kartu profil. */
export function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="row justify-between gap-4">
      <span className="text-body-sm shrink-0">{label}</span>
      <span className="text-body-sm max-w-[200px] text-right" style={{ color: "var(--gold-100)" }}>
        {value || "—"}
      </span>
    </div>
  );
}

/** Kotak inisial bulat (avatar). */
export function Avatar({ name, size = 64 }: { name: string; size?: number }) {
  const letters = initials(name);
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-gold-100 font-bold text-surface-page"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}
      aria-hidden="true"
    >
      {letters}
    </div>
  );
}

export const QRIS_SRC = "/qris.jpg";

/** Poster QRIS resmi (A01) — dipakai di semua halaman pembayaran. */
export function QrisImage({ className = "" }: { className?: string }) {
  return (
    <img
      src={QRIS_SRC}
      alt="Kode QRIS Fritzy Force"
      width={1136}
      height={1600}
      className={`h-auto w-full rounded-md bg-white ${className}`}
    />
  );
}

export function Pagination({
  page,
  pages,
  onChange,
}: {
  page: number;
  pages: number;
  onChange: (p: number) => void;
}) {
  return (
    <nav className="pagination px-5 py-4" aria-label="Pagination">
      <button
        type="button"
        className="page-btn"
        aria-label="Sebelumnya"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        ‹
      </button>
      {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
        <button
          key={p}
          type="button"
          className={`page-btn ${p === page ? "active" : ""}`}
          aria-current={p === page ? "page" : undefined}
          onClick={() => onChange(p)}
        >
          {p}
        </button>
      ))}
      <button
        type="button"
        className="page-btn"
        aria-label="Selanjutnya"
        disabled={page >= pages}
        onClick={() => onChange(page + 1)}
      >
        ›
      </button>
    </nav>
  );
}

export function Loading({ label = "Memuat data…" }: { label?: string }) {
  return (
    <div className="text-body-sm py-10 text-center" role="status">
      {label}
    </div>
  );
}

export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "error" | "success";
  children: ReactNode;
}) {
  const border =
    tone === "error"
      ? "var(--accent-magenta)"
      : tone === "success"
        ? "var(--gold-500)"
        : "var(--surface-200)";
  return (
    <div
      className="card-flat text-body-sm"
      role={tone === "error" ? "alert" : "status"}
      style={{ border: `1px solid ${border}`, color: "var(--gold-100)" }}
    >
      {children}
    </div>
  );
}
