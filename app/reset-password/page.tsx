import type { Metadata } from "next";

import { ResetPasswordView } from "@/components/views/auth-views";

export const metadata: Metadata = { title: "Reset Password" };

export default function Page() {
  return <ResetPasswordView />;
}
