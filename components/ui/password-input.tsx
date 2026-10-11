"use client";

import { useState, type InputHTMLAttributes } from "react";

import { IconEye, IconEyeOff } from "@/components/ui/icons";

/** Input password dengan tombol tampil/sembunyikan. */
export default function PasswordInput({
  className = "",
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input {...rest} type={shown ? "text" : "password"} className={`input pr-12 ${className}`} />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-label={shown ? "Sembunyikan password" : "Tampilkan password"}
        aria-pressed={shown}
        className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-sm text-gold-500 hover:text-gold-100"
      >
        {shown ? <IconEyeOff size={20} /> : <IconEye size={20} />}
      </button>
    </div>
  );
}
