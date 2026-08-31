"use client";

/**
 * An empty list is nearly always the result of a filter, so the way out
 * belongs right here. Without the action the reader has to hunt back up the
 * page to work out which control emptied the view.
 */
export function EmptyResult({ message, hasFilters, onClear }: { message: string; hasFilters: boolean; onClear: () => void }) {
  return (
    <div className="empty-state">
      <p>{message}</p>
      {hasFilters ? (
        <button className="secondary-button" type="button" onClick={onClear}>ล้างตัวกรองทั้งหมด</button>
      ) : null}
    </div>
  );
}
