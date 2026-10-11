import type { Metadata } from "next";

import ReRegistrationView from "@/components/views/re-registration-view";

export const metadata: Metadata = { title: "Registrasi Ulang" };

export default function Page() {
  return <ReRegistrationView />;
}
