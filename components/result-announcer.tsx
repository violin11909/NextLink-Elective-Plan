"use client";

import { useEffect, useState } from "react";

/**
 * Announces how many rows survived the filters, once the user has stopped
 * changing them.
 *
 * The chip row this replaces was itself a live region, so every keystroke in
 * the search box re-announced the entire row — count, active filters and all.
 * Holding for a beat and announcing only the count keeps the useful signal.
 */
export function ResultAnnouncer({ message }: { message: string }) {
  const [announced, setAnnounced] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setAnnounced(message), 700);
    return () => window.clearTimeout(timer);
  }, [message]);

  return <p className="sr-only" role="status" aria-live="polite">{announced}</p>;
}
