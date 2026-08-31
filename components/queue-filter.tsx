"use client";

import { formatNumber } from "@/lib/format";
import { QUEUE_META, QUEUE_ORDER, type QueueKind } from "@/lib/queue";

/**
 * The urgency chips above each follow-up list.
 *
 * Two dashboards hand-rolled this row and drifted — one built its "ทั้งหมด"
 * chip inline while the other folded it into the options list, and only one of
 * them formatted its counts. The third reached for a dropdown instead, which
 * hid the counts the chips exist to show. One row, one order, one set of
 * labels, everywhere.
 */
export function QueueFilterGroup({
  label,
  value,
  counts,
  total,
  onChange,
}: {
  label: string;
  value: QueueKind | "all";
  counts: Record<QueueKind, number>;
  total: number;
  onChange: (next: QueueKind | "all") => void;
}) {
  return (
    <div className="queue-filter-group" role="group" aria-label={label}>
      <button
        className={`queue-filter-button ${value === "all" ? "is-active" : ""}`}
        type="button"
        aria-pressed={value === "all"}
        onClick={() => onChange("all")}
      >
        ทั้งหมด<strong>{formatNumber(total)}</strong>
      </button>
      {QUEUE_ORDER.map((kind) => (
        <button
          className={`queue-filter-button ${value === kind ? "is-active" : ""}`}
          key={kind}
          type="button"
          aria-pressed={value === kind}
          // Pressing the active chip again clears it, so the row never traps
          // the reader in one bucket.
          onClick={() => onChange(value === kind ? "all" : kind)}
        >
          {QUEUE_META[kind].label}<strong>{formatNumber(counts[kind])}</strong>
        </button>
      ))}
    </div>
  );
}
