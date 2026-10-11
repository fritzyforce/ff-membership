import type { Metadata } from "next";

import AccountView from "@/components/views/account-view";

export const metadata: Metadata = { title: "Akun Saya" };

export default function Page() {
  return <AccountView />;
}
