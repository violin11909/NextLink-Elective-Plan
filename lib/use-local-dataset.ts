"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type StoredDataset<T> = { items: T[]; editedAt: string };

function hasId(value: unknown): value is { id: string } {
  return Boolean(value) && typeof value === "object" && "id" in (value as object);
}

/**
 * Lay the saved rows over the bundled ones.
 *
 * The dashboards read nested fields directly (`course.workflow.some(...)`), so
 * a row saved before a field existed would throw the moment it rendered.
 * Starting from the bundled dataset and overlaying only what was saved fills in
 * anything the saved copy predates, keeps the original ordering, and lets rows
 * that are no longer in the dataset fall away.
 *
 * It also means storage need only hold the rows that changed.
 */
function reconcile<T extends { id: string }>(stored: unknown, bundled: T[]): T[] | null {
  if (!Array.isArray(stored) || stored.length === 0) return null;
  const overrides = new Map<string, T>();
  for (const row of stored) {
    if (!hasId(row)) return null;
    overrides.set(row.id, row as T);
  }
  return bundled.map((item) => {
    const saved = overrides.get(item.id);
    return saved ? { ...item, ...saved } : item;
  });
}

/**
 * Demo-mode overrides for a dashboard dataset, kept in this browser only.
 *
 * Two things the earlier per-dashboard copies of this logic got wrong:
 * it wrote to storage on first render, so merely opening a page froze the
 * dataset, and once written there was no way back to the bundled demo data.
 * Here nothing is stored until `update` runs, and `reset` clears the key.
 */
export function useLocalDataset<T extends { id: string }>(storageKey: string, bundled: T[]) {
  const [items, setItems] = useState<T[]>(bundled);
  const [editedAt, setEditedAt] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  // Read once at mount. Re-running on a new `bundled` identity would throw away
  // whatever the user has edited since.
  const bundledRef = useRef(bundled);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored) {
        const parsed: unknown = JSON.parse(stored);
        // v1 stored a bare array; v2 wraps it so the edit time survives a reload.
        const list = Array.isArray(parsed) ? parsed : (parsed as StoredDataset<T>)?.items;
        const at = Array.isArray(parsed) ? null : (parsed as StoredDataset<T>)?.editedAt ?? null;
        const healed = reconcile(list, bundledRef.current);
        if (healed) {
          setItems(healed);
          setEditedAt(at);
        }
      }
    } catch {
      // Ignore invalid local demo data and continue with the bundled dataset.
    } finally {
      setReady(true);
    }
  }, [storageKey]);

  useEffect(() => {
    if (!ready || !editedAt) return;
    try {
      // Store only what the user actually changed. Writing every row put ~2.5KB
      // per row into a 5MB quota shared with two other dashboards, most of it a
      // verbatim copy of data the bundle already ships.
      const bundledById = new Map(bundledRef.current.map((item) => [item.id, JSON.stringify(item)]));
      const changed = items.filter((item) => JSON.stringify(item) !== bundledById.get(item.id));
      window.localStorage.setItem(storageKey, JSON.stringify({ items: changed, editedAt } satisfies StoredDataset<T>));
    } catch {
      // Storage can be full or blocked; the in-memory edit still stands.
    }
  }, [editedAt, items, ready, storageKey]);

  const update = useCallback((updater: (current: T[]) => T[]) => {
    setItems(updater);
    setEditedAt(new Date().toISOString());
  }, []);

  const reset = useCallback(() => {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // Nothing to clean up if storage is unavailable.
    }
    setItems(bundled);
    setEditedAt(null);
  }, [bundled, storageKey]);

  return { items, update, reset, editedAt };
}
