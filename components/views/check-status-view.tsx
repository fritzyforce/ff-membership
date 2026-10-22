"use client";

import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";

import PageTopbar from "@/components/layout/page-topbar";
import { Field, Logo, Notice } from "@/components/ui/primitives";
import RecruitmentStatusCard, { isRecruitmentCode } from "@/components/views/recruitment-status";
import ReRegistrationStatusCard, { isReRegistrationCode } from "@/components/views/re-registration-status";

/** Cek status pendaftaran anggota baru (REG-…) atau registrasi ulang (RU-…) dengan kode. */
export default function CheckStatusView() {
  // Kode boleh lewat URL (?kode=), mis. dari tautan di email.
  const initialCode = useSearchParams().get("kode") ?? "";
  const [input, setInput] = useState(initialCode);
  const [query, setQuery] = useState(initialCode);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    setQuery(input.trim());
  };

  if (query) return <StatusResult query={query} onBack={() => setQuery("")} />;

  return (
    <div className="flex min-h-screen flex-col">
      <PageTopbar title="Cek Status Pendaftaran" backHref="/" />
      <main className="mx-auto flex w-full max-w-[480px] flex-col gap-5 px-6 pb-8 pt-6">
        <Logo size={72} className="self-center" />
        <p className="text-body text-center">Masukkan kode pendaftaran yang kamu dapatkan setelah mendaftar.</p>
        <form onSubmit={onSubmit} className="stack gap-5">
          <Field id="f-check" label="Kode Pendaftaran">
            <input
              id="f-check"
              className="input"
              type="text"
              placeholder="REG-XXXX-XXXX atau RU-XXXX-XXXX"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              autoComplete="off"
            />
          </Field>
          <button type="submit" className="btn btn-primary btn-block" disabled={!input.trim()}>
            Cek Status
          </button>
        </form>
      </main>
    </div>
  );
}

function StatusResult({ query, onBack }: { query: string; onBack: () => void }) {
  return (
    <div className="flex min-h-screen flex-col">
      <PageTopbar title="Status Pendaftaran" onBack={onBack} />
      <main className="mx-auto flex w-full max-w-[480px] flex-col gap-5 px-6 pb-8 pt-2">
        {isReRegistrationCode(query) ? (
          <ReRegistrationStatusCard code={query} onBack={onBack} />
        ) : isRecruitmentCode(query) ? (
          <RecruitmentStatusCard code={query} onBack={onBack} />
        ) : (
          <>
            <Notice tone="error">
              Kode <strong>{query}</strong> tidak dikenali. Kode pendaftaran berawalan <strong>REG-</strong> (anggota baru) atau{" "}
              <strong>RU-</strong> (registrasi ulang).
            </Notice>
            <button type="button" onClick={onBack} className="btn btn-secondary btn-block">
              Coba Lagi
            </button>
          </>
        )}
      </main>
    </div>
  );
}
