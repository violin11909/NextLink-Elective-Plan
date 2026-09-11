"use client";

import { useEffect, useRef, useState } from "react";

/** Restore before writing, re-validate on Back/Forward, preserve Next's history state. */
export function useUrlFilters(values: Record<string, string>, onRestore: (found: Record<string, string>) => void) {
  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;
  const [restoreEpoch, setRestoreEpoch] = useState(0);

  useEffect(() => {
    const restore = () => {
      onRestoreRef.current(Object.fromEntries(new URLSearchParams(window.location.search)));
      setRestoreEpoch((epoch) => epoch + 1);
    };
    restore();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  const serialised = JSON.stringify(values);
  useEffect(() => {
    if (restoreEpoch === 0) return;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(JSON.parse(serialised) as Record<string, string>)) {
      if (value) params.set(key, value);
    }
    const query = params.toString();
    const url = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    window.history.replaceState(window.history.state, "", url);
  }, [serialised, restoreEpoch]);
}
