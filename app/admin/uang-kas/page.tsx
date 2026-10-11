import type { Metadata } from "next";

import { AdminDuesView } from "@/components/views/admin-dues-view";

export const metadata: Metadata = { title: "Uang Kas" };

export default function Page() {
  return <AdminDuesView />;
}
