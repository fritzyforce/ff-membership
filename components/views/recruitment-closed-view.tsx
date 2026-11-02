import PageTopbar from "@/components/layout/page-topbar";
import { Logo } from "@/components/ui/primitives";

/** Ditampilkan di /join-us/ saat periode Open Member ditutup (lihat RECRUITMENT_OPEN di lib/config). */
export default function RecruitmentClosedView() {
  return (
    <div className="flex min-h-screen flex-col">
      <PageTopbar title="Join Us" backHref="/" />
      <main className="mx-auto flex w-full max-w-[440px] flex-col items-center gap-5 px-8 py-10 text-center">
        <Logo size={72} />
        <h1 className="text-h1 text-[24px]">Open Member Ditutup</h1>
        <p className="text-body-sm">
          Periode Open Member sudah ditutup. Silahkan tunggu open member selanjutnya dari Fritzy Force!
        </p>
      </main>
    </div>
  );
}
