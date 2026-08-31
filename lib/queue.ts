/**
 * The follow-up queue's shared vocabulary.
 *
 * All three dashboards sort outstanding work into the same three buckets and
 * present them identically — same wording, same glyph, same tint, same order.
 * That presentation reached three copies and changes for one reason, so it
 * lives here.
 *
 * What does NOT live here is the classifier. Deciding which bucket a row falls
 * into is domain work: the elective page reads workflow task statuses, the
 * internship page weighs case, acceptance and MOU statuses together, and the
 * MOU page reads the document status. Each has its own `queueKind`, and each
 * changes when its own source data does.
 */

export type QueueKind = "BLOCKED" | "WAITING" | "IN_PROGRESS";

export const QUEUE_META: Record<QueueKind, { label: string; icon: string; className: string }> = {
  BLOCKED: { label: "ติดปัญหา", icon: "!", className: "queue-blocked" },
  WAITING: { label: "รอข้อมูล", icon: "?", className: "queue-waiting" },
  IN_PROGRESS: { label: "กำลังทำ", icon: "↻", className: "queue-progress" },
};

/** Most urgent first — the order the queue is always listed in. */
export const QUEUE_ORDER: QueueKind[] = ["BLOCKED", "WAITING", "IN_PROGRESS"];

export function queueRank(kind: QueueKind) {
  return QUEUE_ORDER.indexOf(kind);
}
