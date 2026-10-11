import type { Metadata } from "next";
import { Suspense } from "react";

import { AdminDuesDetailView } from "@/components/views/admin-dues-detail-view";

export const metadata: Metadata = { title: "Detail Uang Kas" };

export default function Page() {
  return (
    <Suspense>
      <AdminDuesDetailView />
    </Suspense>
  );
}
