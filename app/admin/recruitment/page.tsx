import type { Metadata } from "next";

import { AdminRecruitmentView } from "@/components/views/admin-recruitment-view";

export const metadata: Metadata = { title: "Recruitment Management" };

export default function Page() {
  return <AdminRecruitmentView />;
}
