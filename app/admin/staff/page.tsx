import type { Metadata } from "next";

import { AdminStaffView } from "@/components/views/admin-staff-view";

export const metadata: Metadata = { title: "Akun Staf" };

export default function Page() {
  return <AdminStaffView />;
}
