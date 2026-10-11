import type { Metadata } from "next";

import { RegisterView } from "@/components/views/auth-views";

export const metadata: Metadata = { title: "Registrasi Akun" };

export default function Page() {
  return <RegisterView />;
}
