import type { Metadata } from "next";

import JoinUsView from "@/components/views/join-us-view";

export const metadata: Metadata = { title: "Join Us" };

export default function Page() {
  return <JoinUsView />;
}
