"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Jalankan loader async dan ulangi saat `deps` berubah. `data` bernilai `undefined` selama loading pertama.
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
    return () => {
      alive = false;
    };
  }, [load]);

  return { data, error };
}
