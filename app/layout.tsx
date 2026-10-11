import type { Metadata, Viewport } from "next";

import { THEME_INIT_SCRIPT } from "@/components/ui/theme-toggle";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Fritzy Force — Recruitment & Member Portal",
    template: "%s — Fritzy Force",
  },
  description:
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Portal rekrutmen & anggota Fritzy Force.",
  applicationName: "Fritzy Force Member Portal",
  icons: { icon: "/logo.jpg" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbf6fa" },
    { media: "(prefers-color-scheme: dark)", color: "#100615" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="bg-surface-page antialiased">{children}</body>
    </html>
  );
}
