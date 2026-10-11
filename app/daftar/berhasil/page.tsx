import type { Metadata } from "next";
import { Suspense } from "react";

import RegistrationCodeView from "@/components/views/registration-code-view";

export const metadata: Metadata = { title: "Pendaftaran Terkirim" };

export default function Page() {
  return (
    <Suspense>
      <RegistrationCodeView />
    </Suspense>
  );
}
