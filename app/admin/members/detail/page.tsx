import type { Metadata } from "next";
import { Suspense } from "react";

import { AdminMemberDetailView } from "@/components/views/admin-members-view";

export const metadata: Metadata = { title: "Detail Anggota" };

export default function Page() {
  return (
    <Suspense>
      <AdminMemberDetailView />
    </Suspense>
  );
}
