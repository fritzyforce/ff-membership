import type { Metadata } from "next";
import { Suspense } from "react";

import { LoginView } from "@/components/views/auth-views";

export const metadata: Metadata = { title: "Login" };

export default function Page() {
  return (
    <Suspense>
      <LoginView />
    </Suspense>
  );
}
