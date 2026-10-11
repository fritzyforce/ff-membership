import type { Metadata } from "next";

import { AdminMembersView } from "@/components/views/admin-members-view";

export const metadata: Metadata = { title: "Member Management" };

export default function Page() {
  return <AdminMembersView />;
}
