import type { Metadata } from "next";
import { Suspense } from "react";

import RegistrationCodeView from "@/components/views/registration-code-view";

export const metadata: Metadata = { title: "Registrasi Ulang Terkirim" };

export default function Page() {
  return (
    <Suspense>
      <RegistrationCodeView variant="re_registration" />
    </Suspense>
  );
}
