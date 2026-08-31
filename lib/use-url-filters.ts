"use client";

import { useEffect, useRef } from "react";

/**
 * Mirror the active filters into the query string and restore them on load, so
 * a filtered view can be bookmarked or pasted to a colleague and survives a
 * refresh.
 *
 * This writes with `history.replaceState` rather than the Next router: two of
 * the three dashboards are statically rendered, and reaching for
 * `useSearchParams` would opt them out of that. It also keeps the URL out of
 * the back-stack, which is what you want for a filter that changes on
 * every keystroke.
 *
 * Pass an empty string for a filter that is at its default; those are left out
 * of the URL so a clean view has a clean address.
 */
export function useUrlFilters(values: Record<string, string>, onRestore: (found: Record<string, string>) => void) {
  const restoredRef = useRef(false);
  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;

  useEffect(() => {
    const found: Record<string, string> = {};
    new URLSearchParams(window.location.search).forEach((value, key) => {
      if (value) found[key] = value;
    });
    restoredRef.current = true;
    if (Object.keys(found).length > 0) onRestoreRef.current(found);
  }, []);

  // Serialised so the effect tracks the values rather than the object identity.
  const serialised = JSON.stringify(values);

  useEffect(() => {
    // Skip the first pass: writing before the restore has run would erase the
    // very query string we are about to read.
    if (!restoredRef.current) return;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(JSON.parse(serialised) as Record<string, string>)) {
      if (value) params.set(key, value);
    }
    const query = params.toString();
    window.history.replaceState(null, "", query ? `${window.location.pathname}?${query}` : window.location.pathname);
  }, [serialised]);
}
