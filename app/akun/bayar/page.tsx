import type { Metadata } from "next";

import PaymentView from "@/components/views/payment-view";

export const metadata: Metadata = { title: "Bayar Uang Kas" };

export default function Page() {
  return <PaymentView />;
}
