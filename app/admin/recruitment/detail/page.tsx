import type { Metadata } from "next";
import { Suspense } from "react";

import { AdminRecruitmentDetailView } from "@/components/views/admin-recruitment-view";

export const metadata: Metadata = { title: "Detail Pendaftar" };

export default function Page() {
  return (
    <Suspense>
      <AdminRecruitmentDetailView />
    </Suspense>
  );
}
