import type { Metadata } from "next";

import { ForgotPasswordView } from "@/components/views/auth-views";

export const metadata: Metadata = { title: "Lupa Password" };

export default function Page() {
  return <ForgotPasswordView />;
}
