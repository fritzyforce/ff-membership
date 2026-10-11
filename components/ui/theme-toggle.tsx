"use client";

import { useEffect, useState } from "react";

import { IconMoon, IconSun } from "@/components/ui/icons";

export const THEME_KEY = "ff-membership-theme";
export const THEME_EVENT = "ff-theme-change";

type Theme = "dark" | "light";

/**
 * Default mengikuti tema device (prefers-color-scheme). Pilihan manual dari
 * tombol toggle disimpan di localStorage hanya bila berbeda dari tema device;
 * kalau user kembali memilih tema yang sama dengan device, simpanan dihapus
 * sehingga situs kembali "ikut device".
 *
 * Script ini dipasang di <head> supaya tema terpasang sebelum paint (tanpa flash).
 */
export const THEME_INIT_SCRIPT = `(function(){var d=document.documentElement,m=window.matchMedia("(prefers-color-scheme: light)");function s(){var t=null;try{t=localStorage.getItem("${THEME_KEY}")}catch(e){}d.setAttribute("data-theme",t==="light"||t==="dark"?t:m.matches?"light":"dark")}s();m.addEventListener("change",function(){s();window.dispatchEvent(new Event("${THEME_EVENT}"))})})();`;

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function currentTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    if (theme === systemTheme()) window.localStorage.removeItem(THEME_KEY);
    else window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // diabaikan: pilihan hanya berlaku sampai reload
  }
  window.dispatchEvent(new Event(THEME_EVENT));
}

export default function ThemeToggle({
  variant = "icon",
}: {
  variant?: "icon" | "nav";
}) {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const sync = () => setTheme(currentTheme());
    sync();
    window.addEventListener(THEME_EVENT, sync);
    return () => window.removeEventListener(THEME_EVENT, sync);
  }, []);

  const next: Theme = theme === "dark" ? "light" : "dark";
  const label = next === "light" ? "Light Mode" : "Dark Mode";
  const Icon = next === "light" ? IconSun : IconMoon;

  const toggle = () => applyTheme(next);

  if (variant === "nav") {
    return (
      <button type="button" className="admin-nav-item" style={{ color: "var(--gold-500)" }} onClick={toggle}>
        <Icon />
        {label}
      </button>
    );
  }

  return (
    <button
      type="button"
      className="btn-icon"
      aria-label={`Ganti ke ${label}`}
      title={label}
      onClick={toggle}
    >
      <Icon />
    </button>
  );
}
