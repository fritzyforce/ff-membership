"use client";

import { useCallback, useEffect, useState } from "react";

import { DB_CHANGE_EVENT } from "@/lib/data/store";

/**
 * Jalankan loader async dan ulangi otomatis setiap data berubah
 * (event dari store). `data` bernilai `undefined` selama loading pertama.
 */
export function useData<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(loader, deps);

  useEffect(() => {
    let alive = true;
    const run = () => {
      load()
        .then((value) => {
          if (alive) {
            setData(value);
            setError(null);
          }
        })
        .catch((err: unknown) => {
          if (alive) setError(err instanceof Error ? err.message : String(err));
        });
    };
    run();
    window.addEventListener(DB_CHANGE_EVENT, run);
    window.addEventListener("storage", run);
    return () => {
      alive = false;
      window.removeEventListener(DB_CHANGE_EVENT, run);
      window.removeEventListener("storage", run);
    };
  }, [load]);

  return { data, error };
}
