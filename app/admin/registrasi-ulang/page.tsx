import type { Metadata } from "next";

import { AdminReRegistrationView } from "@/components/views/admin-reregistration-view";

export const metadata: Metadata = { title: "Registrasi Ulang" };

export default function Page() {
  return <AdminReRegistrationView />;
}
