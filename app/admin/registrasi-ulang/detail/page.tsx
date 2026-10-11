import type { Metadata } from "next";
import { Suspense } from "react";

import { AdminReRegistrationDetailView } from "@/components/views/admin-reregistration-detail-view";

export const metadata: Metadata = { title: "Detail Registrasi Ulang" };

export default function Page() {
  return (
    <Suspense>
      <AdminReRegistrationDetailView />
    </Suspense>
  );
}
