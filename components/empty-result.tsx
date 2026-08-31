"use client";

/**
 * An empty list is nearly always the result of a filter, so the way out
 * belongs right here. Without the action the reader has to hunt back up the
 * page to work out which control emptied the view.
 *
 * `onClear` is optional: where the filters sit directly above the empty list
 * and are all visible at once, the button is a second way to do something the
 * reader can already see how to undo.
 */
export function EmptyResult({
  message,
  hasFilters,
  onClear,
}: {
  message: string;
  hasFilters: boolean;
  onClear?: () => void;
}) {
  return (
    <div className="empty-state">
      <p>{message}</p>
      {hasFilters && onClear ? (
        <button className="secondary-button" type="button" onClick={onClear}>ล้างตัวกรองทั้งหมด</button>
      ) : null}
    </div>
  );
}
