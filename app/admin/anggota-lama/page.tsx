import type { Metadata } from "next";

import { AdminLegacyMembersView } from "@/components/views/admin-legacy-members-view";

export const metadata: Metadata = { title: "Nomor Anggota Lama" };

export default function Page() {
  return <AdminLegacyMembersView />;
}
