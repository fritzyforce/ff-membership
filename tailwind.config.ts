import type { Config } from "tailwindcss";

/**
 * Token warna diambil dari design system Fritzy Force (canvas
 * "Fritzy Force Recruitment & Member Portal"). Semua warna menunjuk ke CSS
 * custom property di `app/globals.css`, jadi light mode cukup me-remap
 * variabelnya lewat `html[data-theme="light"]`.
 */
const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx}",
  ],
  // dirakit dinamis lewat `badge-${tone}`
  safelist: ["badge-approved", "badge-pending", "badge-reject"],
  theme: {
    extend: {
      colors: {
        "surface-page": "var(--surface-page)",
        "surface-100": "var(--surface-100)",
        "surface-200": "var(--surface-200)",
        "gold-100": "var(--gold-100)",
        "gold-300": "var(--gold-300)",
        "gold-500": "var(--gold-500)",
        "accent-magenta": "var(--accent-magenta)",
        "accent-crimson": "var(--accent-crimson)",
      },
      borderRadius: {
        sm: "6px",
        md: "14px",
        lg: "28px",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
      },
    },
  },
  plugins: [],
};

export default config;
