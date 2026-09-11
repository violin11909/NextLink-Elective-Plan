import coursesJson from "@/data/plan-courses.json";
import roomsJson from "@/data/plan-rooms.json";
import termIndexJson from "@/data/terms/index.json";
import term25682Json from "@/data/terms/2568-2.json";
import term25681Json from "@/data/terms/2568-1.json";
import term25672Json from "@/data/terms/2567-2.json";
import { ALL_SLOTS, isSlotId, slotRank, type SlotId } from "./slots.ts";
import type {
  ArchivedSession,
  ArchivedTerm,
  Contact,
  PlanCourse,
  PlanPayload,
  PlanRoom,
  TermMeta,
  TermSeason,
} from "./plan-types.ts";

/**
 * The one place that knows where plan data comes from.
 *
 * The JSON imports use the `@/` alias, which only Next resolves — this module
 * is therefore the one file in lib/ that plain node cannot load. Everything the
 * scheduler tests need (slots, types, scheduler, conflicts) imports its
 * siblings relatively so `node --experimental-strip-types` can run them
 * directly, with no bundler and no loader shim.
 *
 * Today it is JSON files bundled with the app: `data/plan-courses.json` and
 * `data/plan-rooms.json` for the term being planned, and one file per finished
 * term under `data/terms/`. When this moves to a database, only this file
 * changes — every component above it takes a `PlanPayload` or an
 * `ArchivedTerm` and has no opinion about its origin.
 */

/**
 * The shape a course has on disk, in either the current file or an archive.
 *
 * Written out rather than taken from one of the imports, because the two
 * differ in what they carry: an archive has no `coordinator` (whoever the
 * company had on the line two years ago is not who to call today). Reading
 * both through one function is what keeps a past term's row identical to a
 * current one everywhere it is shown.
 */
type RawCourse = {
  id: string;
  courseCode: string;
  title: string;
  category: string;
  provider: string;
  instructor: string;
  coordinator?: Contact | null;
  deliveryMode: string;
  availability: unknown;
  sessionsPerWeek: number;
  minSeats: number;
  capacity: number;
  weeks: number;
  notes?: string | null;
};

type RawArchive = {
  term: { id: string; academicYear: number; season: string; label: string; shortLabel: string; status: string };
  dataset: string;
  lastUpdated: string;
  isMock: boolean;
  courses: RawCourse[];
  sessions: Array<{ courseId: string; slotId: string; roomName: string | null }>;
};

/**
 * Every finished term, newest first.
 *
 * Listed by hand because the imports are static: the bundler has to see each
 * path as a literal, so a directory scan is not available here. Adding a term
 * is a file, a line in this list, and an entry in `data/terms/index.json` —
 * and the reader below fails loudly if the last of those three is forgotten.
 */
const ARCHIVE_FILES: RawArchive[] = [term25682Json, term25681Json, term25672Json];

/** ต้น → ปลาย → ฤดูร้อน, so terms of one year sort in the order they happened. */
const SEASON_RANK: Record<TermSeason, number> = { FIRST: 0, SECOND: 1, SUMMER: 2 };

/**
 * Reject an unknown slot id at load time rather than at render time.
 *
 * A typo like "WED_MORNING" in the seed file is invisible until a grid tries
 * to look it up and quietly shows the course nowhere at all. Failing here
 * names the file, the course and the value.
 */
function readSlots(where: string, values: unknown): SlotId[] {
  if (!Array.isArray(values)) throw new Error(`${where}: availability must be an array`);
  const slots: SlotId[] = [];
  for (const value of values) {
    if (typeof value !== "string" || !isSlotId(value)) {
      throw new Error(`${where}: unknown slot "${String(value)}" (expected one of ${ALL_SLOTS.join(", ")})`);
    }
    if (!slots.includes(value)) slots.push(value);
  }
  // Sorted so two courses offering the same periods in different order behave
  // identically — the scheduler's tie-breaks read this list in order.
  return slots.sort((a, b) => slotRank(a) - slotRank(b));
}

function readRoom(raw: (typeof roomsJson)["rooms"][number]): PlanRoom {
  return {
    id: raw.id,
    name: raw.name,
    building: raw.building,
    floor: raw.floor,
    seats: raw.seats,
    seatsIsEstimated: raw.seatsIsEstimated,
    tier: raw.tier === "NEEDS_APPROVAL" ? "NEEDS_APPROVAL" : "READY",
    blockedSlots: raw.blockedSlots.map((blocked) => {
      if (!isSlotId(blocked.slotId)) {
        throw new Error(`room ${raw.id}: unknown blocked slot "${blocked.slotId}"`);
      }
      return { slotId: blocked.slotId, reason: blocked.reason };
    }),
  };
}

function readCourse(raw: RawCourse): PlanCourse {
  const availability = readSlots(`course ${raw.courseCode}`, raw.availability);
  if (raw.sessionsPerWeek > availability.length) {
    throw new Error(
      `course ${raw.courseCode}: needs ${raw.sessionsPerWeek} periods a week but only offers ${availability.length}`,
    );
  }
  return {
    id: raw.id,
    courseCode: raw.courseCode,
    title: raw.title,
    category: raw.category,
    provider: raw.provider,
    instructor: raw.instructor,
    coordinator: raw.coordinator ?? null,
    deliveryMode: raw.deliveryMode === "ONLINE" ? "ONLINE" : raw.deliveryMode === "HYBRID" ? "HYBRID" : "ON_SITE",
    availability,
    sessionsPerWeek: raw.sessionsPerWeek,
    minSeats: raw.minSeats,
    capacity: raw.capacity,
    weeks: raw.weeks,
    notes: raw.notes ?? null,
  };
}

function readSeason(where: string, value: string): TermSeason {
  if (value === "FIRST" || value === "SECOND" || value === "SUMMER") return value;
  throw new Error(`${where}: unknown season "${value}" (expected FIRST, SECOND or SUMMER)`);
}

function readTermMeta(raw: (typeof termIndexJson)["terms"][number]): TermMeta {
  return {
    id: raw.id,
    academicYear: raw.academicYear,
    season: readSeason(`term ${raw.id}`, raw.season),
    label: raw.label,
    shortLabel: raw.shortLabel,
    status: raw.status === "CURRENT" ? "CURRENT" : "ARCHIVED",
  };
}

export function getPlanPayload(): PlanPayload {
  const rooms = roomsJson.rooms.map(readRoom);
  const courses = coursesJson.courses.map(readCourse);

  const roomIds = new Set(rooms.map((room) => room.id));
  if (roomIds.size !== rooms.length) throw new Error("data/plan-rooms.json: duplicate room id");
  const courseIds = new Set(courses.map((course) => course.id));
  if (courseIds.size !== courses.length) throw new Error("data/plan-courses.json: duplicate course id");

  return {
    term: getCurrentTerm(),
    seedRevision: seedFingerprint(JSON.stringify([coursesJson, roomsJson])),
    dataset: coursesJson.dataset,
    lastUpdated: coursesJson.lastUpdated,
    timezone: coursesJson.timezone,
    isMock: coursesJson.isMock,
    courses,
    rooms,
  };
}

/** Changes whenever bundled facts change, independently of human timestamps. */
function seedFingerprint(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16);
}

/**
 * Every term the system knows about, newest first — the current one included.
 *
 * The index is the single list of terms; the archive files carry a copy of
 * their own metadata only so a file can be read on its own, and the reader
 * below checks the two agree rather than picking a winner.
 */
export function getTermIndex(): TermMeta[] {
  const terms = termIndexJson.terms.map(readTermMeta);
  const ids = new Set(terms.map((term) => term.id));
  if (ids.size !== terms.length) throw new Error("data/terms/index.json: duplicate term id");

  const current = terms.filter((term) => term.status === "CURRENT");
  if (current.length !== 1) {
    throw new Error(`data/terms/index.json: expected exactly one CURRENT term, found ${current.length}`);
  }
  if (current[0].id !== termIndexJson.currentTermId) {
    throw new Error(
      `data/terms/index.json: currentTermId is "${termIndexJson.currentTermId}" but "${current[0].id}" is the term marked CURRENT`,
    );
  }

  return terms.sort((a, b) =>
    b.academicYear - a.academicYear || SEASON_RANK[b.season] - SEASON_RANK[a.season],
  );
}

/** The term `data/plan-courses.json` describes — the one the planner edits. */
export function getCurrentTerm(): TermMeta {
  const current = getTermIndex().find((term) => term.status === "CURRENT");
  if (!current) throw new Error("data/terms/index.json: no CURRENT term");
  return current;
}

/**
 * Read one finished term, checking the things that would otherwise show up as
 * a quietly wrong history: a period nobody offered, two classes in one room at
 * one time, a course that ran fewer times than it was supposed to.
 *
 * An archive is a record, so these are not warnings to show in the UI — there
 * is no one left to fix a term that ended. They are build-time errors about
 * the seed file itself.
 */
function readArchive(raw: RawArchive, index: Map<string, TermMeta>): ArchivedTerm {
  const where = `data/terms/${raw.term.id}.json`;
  const meta = index.get(raw.term.id);
  if (!meta) throw new Error(`${where}: term "${raw.term.id}" is not listed in data/terms/index.json`);
  if (meta.status !== "ARCHIVED") throw new Error(`${where}: term "${raw.term.id}" is not marked ARCHIVED in the index`);
  if (meta.label !== raw.term.label) {
    throw new Error(`${where}: label "${raw.term.label}" disagrees with the index's "${meta.label}"`);
  }

  const courses = raw.courses.map(readCourse);
  const byId = new Map(courses.map((course) => [course.id, course]));
  if (byId.size !== courses.length) throw new Error(`${where}: duplicate course id`);

  const held = new Map<string, string>();
  const counted = new Map<string, number>();
  const sessions: ArchivedSession[] = raw.sessions.map((session) => {
    const course = byId.get(session.courseId);
    if (!course) throw new Error(`${where}: session for unknown course "${session.courseId}"`);
    if (!isSlotId(session.slotId)) {
      throw new Error(`${where}: course ${course.courseCode} taught in unknown slot "${session.slotId}"`);
    }
    if (!course.availability.includes(session.slotId)) {
      throw new Error(`${where}: course ${course.courseCode} taught in ${session.slotId}, which it never offered`);
    }
    if (session.roomName) {
      const key = `${session.roomName}@${session.slotId}`;
      const other = held.get(key);
      if (other) {
        throw new Error(`${where}: ${session.roomName} holds both ${other} and ${course.courseCode} in ${session.slotId}`);
      }
      held.set(key, course.courseCode);
    }
    counted.set(course.id, (counted.get(course.id) ?? 0) + 1);
    return { courseId: session.courseId, slotId: session.slotId, roomName: session.roomName };
  });

  for (const course of courses) {
    const ran = counted.get(course.id) ?? 0;
    if (ran !== course.sessionsPerWeek) {
      throw new Error(`${where}: course ${course.courseCode} ran ${ran} period(s) a week, expected ${course.sessionsPerWeek}`);
    }
  }

  return { term: meta, dataset: raw.dataset, lastUpdated: raw.lastUpdated, isMock: raw.isMock, courses, sessions };
}

/**
 * Every finished term, newest first.
 *
 * All of them are read at once because there are a handful and they are
 * bundled anyway; the list page hands the whole set to the client so switching
 * terms is a state change rather than a round trip. The day this becomes a
 * database, this is the function that grows a term id argument.
 */
export function getArchivedTerms(): ArchivedTerm[] {
  const index = new Map(getTermIndex().map((term) => [term.id, term]));
  const archives = ARCHIVE_FILES.map((raw) => readArchive(raw, index));

  const listed = [...index.values()].filter((term) => term.status === "ARCHIVED").map((term) => term.id);
  const loaded = new Set(archives.map((archive) => archive.term.id));
  const missing = listed.filter((id) => !loaded.has(id));
  if (missing.length) {
    throw new Error(`data/terms/index.json lists ${missing.join(", ")} but lib/plan-data.ts does not import the file(s)`);
  }

  return archives.sort((a, b) =>
    b.term.academicYear - a.term.academicYear || SEASON_RANK[b.term.season] - SEASON_RANK[a.term.season],
  );
}
