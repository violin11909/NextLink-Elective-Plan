import type { SlotId } from "./slots.ts";

export type DeliveryMode = "ON_SITE" | "HYBRID" | "ONLINE";

export type Contact = {
  name: string;
  email: string | null;
  lineId: string | null;
};

/**
 * How hard it is to get the room, which is the only thing that separates the
 * two buildings in this system.
 *
 * The department can put a class in a จุฬาพัฒน์ room today. A room in the
 * Faculty of Engineering buildings needs a request that goes through several
 * steps first, so those rooms are a fallback, never a first choice. See
 * `planSchedule` in lib/scheduler.ts for how that is enforced.
 */
export type RoomTier = "READY" | "NEEDS_APPROVAL";

export type PlanRoom = {
  id: string;
  name: string;
  building: string;
  floor: string;
  seats: number;
  /**
   * True when `seats` is what was observed from a class that used the room,
   * not a figure anyone confirmed. It is therefore a *lower bound*: the room
   * may hold more, but nothing here may assume it does.
   */
  seatsIsEstimated: boolean;
  tier: RoomTier;
  /** Periods already taken by something else, with the reason to show a reader. */
  blockedSlots: Array<{ slotId: SlotId; reason: string }>;
};

/**
 * A course a company has offered, and the terms it comes with.
 *
 * `availability` is the field this whole application exists for. The previous
 * data model stored a fixed `sessions[]` — the answer, already decided — which
 * could say when a class met but not where else it could have gone. Planning
 * needs the options, not the conclusion.
 */
export type PlanCourse = {
  id: string;
  courseCode: string;
  title: string;
  category: string;
  provider: string;
  instructor: string;
  coordinator: Contact | null;
  deliveryMode: DeliveryMode;
  /** Periods the company said it can teach. Order is not significant. */
  availability: SlotId[];
  /** How many periods a week this course needs. Usually 1. */
  sessionsPerWeek: number;
  /** Seats the room must have. Room *type* is deliberately not modelled: every
   *  class is taught with students on their own laptops. */
  minSeats: number;
  capacity: number;
  weeks: number;
  notes: string | null;
};

/**
 * One decision: this course, this period, this room.
 *
 * Kept apart from `PlanCourse` because a course is a fact from the company
 * while an assignment is a choice by the department. Separating them means
 * "plan it again" throws away choices without touching facts, and local
 * storage only ever holds what a person actually decided.
 */
export type Assignment = {
  id: string;
  courseId: string;
  slotId: SlotId;
  /** null for an ONLINE course, which occupies no room. */
  roomId: string | null;
  /** Real clock times. Default to the period's bounds; editable within reason. */
  startTime: string;
  endTime: string;
  /** Confirmed by a person. `planSchedule` must never move or drop these. */
  locked: boolean;
  source: "AUTO" | "MANUAL";
};

export type PlanPayload = {
  dataset: string;
  lastUpdated: string;
  timezone: string;
  isMock: boolean;
  courses: PlanCourse[];
  rooms: PlanRoom[];
};

/** Why one (slot, room) pair was rejected. Ordered roughly by how fixable it is. */
export type BlockerCode =
  | "OUTSIDE_AVAILABILITY"
  | "ROOM_BLOCKED"
  | "ROOM_DOUBLE_BOOKED"
  | "ROOM_TOO_SMALL"
  | "INSTRUCTOR_BUSY"
  | "PROVIDER_BUSY"
  | "NO_ROOM_AVAILABLE";

export type SlotFailure = {
  slotId: SlotId;
  blockers: BlockerCode[];
  detail: string;
};

export type Suggestion =
  | { kind: "UNLOCK_COURSE"; courseId: string; label: string }
  | { kind: "FREE_ROOM_SLOT"; roomId: string; slotId: SlotId; label: string }
  | { kind: "ASK_MORE_AVAILABILITY"; courseId: string; label: string }
  | { kind: "REDUCE_CAPACITY"; courseId: string; seats: number; label: string };

export type FailureReason = {
  perSlot: SlotFailure[];
  suggestions: Suggestion[];
};

export type Unassigned = {
  courseId: string;
  /** Which of the `sessionsPerWeek` periods could not be placed (1-based). */
  sessionIndex: number;
  reason: FailureReason;
};

export type ScheduleResult = {
  assignments: Assignment[];
  unassigned: Unassigned[];
};
