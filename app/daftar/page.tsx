import type { Metadata } from "next";

import RecruitmentFormView from "@/components/views/recruitment-form-view";

export const metadata: Metadata = { title: "Formulir Pendaftaran" };

export default function Page() {
  return <RecruitmentFormView />;
}
