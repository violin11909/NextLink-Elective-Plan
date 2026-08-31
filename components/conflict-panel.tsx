"use client";

import { QUEUE_META, type QueueKind } from "@/lib/queue";
import { slotLabel } from "@/lib/slots.ts";
import type { Conflict } from "@/lib/conflicts.ts";
import type { PlanGap } from "@/lib/use-plan-state";
import type { Suggestion } from "@/lib/plan-types.ts";

/**
 * What needs attention, and what to do about it.
 *
 * A planner that reports "3 courses could not be scheduled" has handed the
 * problem back along with none of what it learned while failing to solve it.
 * Every row here names the course or room in the way, and a course that could
 * not be placed carries buttons that act on the obstruction rather than
 * describing it.
 */
export function ConflictPanel({
  conflicts,
  gaps,
  filter,
  onSuggestion,
}: {
  conflicts: Conflict[];
  gaps: PlanGap[];
  filter: QueueKind | "all";
  onSuggestion?: (suggestion: Suggestion) => void;
}) {
  const shown = filter === "all" ? conflicts : conflicts.filter((item) => item.severity === filter);
  const gapById = new Map(gaps.map((gap) => [gap.course.id, gap]));

  if (shown.length === 0) {
    return <p className="panel-caption">ไม่มีรายการค้างในกลุ่มนี้</p>;
  }

  return (
    <ul className="conflict-list">
      {shown.slice(0, 40).map((conflict) => {
        const gap = conflict.code === "UNDER_SCHEDULED" ? gapById.get(conflict.courseIds[0]) : null;
        return (
          <li className="conflict-row" key={conflict.id}>
            <span className={`follow-up-icon ${QUEUE_META[conflict.severity].className}`} aria-hidden="true">
              {QUEUE_META[conflict.severity].icon}
            </span>
            <div className="conflict-copy">
              <strong>{conflict.title}</strong>
              <small>{conflict.detail}</small>
              {gap ? (
                <ul className="conflict-slot-list">
                  {gap.reason.perSlot.map((slot) => (
                    <li key={slot.slotId}>
                      <span className="conflict-slot-name">{slotLabel(slot.slotId)}</span>
                      {slot.detail}
                    </li>
                  ))}
                </ul>
              ) : null}
              {gap && onSuggestion ? (
                <span className="conflict-actions">
                  {gap.reason.suggestions.map((suggestion) => (
                    <button
                      className="selection-chip"
                      key={suggestion.label}
                      type="button"
                      onClick={() => onSuggestion(suggestion)}
                    >
                      {suggestion.label}
                    </button>
                  ))}
                </span>
              ) : null}
            </div>
            <span className={`follow-up-severity ${QUEUE_META[conflict.severity].className}`}>
              {QUEUE_META[conflict.severity].label}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
