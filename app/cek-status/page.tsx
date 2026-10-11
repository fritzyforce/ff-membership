import type { Metadata } from "next";
import { Suspense } from "react";

import CheckStatusView from "@/components/views/check-status-view";

export const metadata: Metadata = { title: "Cek Status Pendaftaran" };

export default function Page() {
  return (
    <Suspense>
      <CheckStatusView />
    </Suspense>
  );
}
