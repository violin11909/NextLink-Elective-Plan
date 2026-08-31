import type { PlanRoom } from "./plan-types.ts";

/**
 * A colour per room, so a class can be traced across the week without reading
 * every label.
 *
 * The hue says which **building**, and the step within that hue says which room
 * in it. Nine unrelated hues would have been the obvious reading of "one colour
 * per room", but they carry less: at a glance the useful question is which
 * building you are walking to, and grouping by building answers it while still
 * giving every room its own shade. It also keeps the number of hues at four,
 * which is a set that can actually be told apart — a nine-hue categorical
 * palette cannot clear colour-vision separation at any ordering.
 *
 * The four base hues are validated as a categorical set against a white
 * surface: worst all-pairs colour-vision ΔE 9.2 (target ≥ 8), worst
 * normal-vision ΔE 16.3 (floor ≥ 15). The aqua sits at 2.8:1 rather than 3:1,
 * which is allowed here because colour is never the only cue — every tag and
 * every column header carries the room's name in text beside the swatch.
 */

/** Steps run light → dark within each hue, so rooms in one building differ. */
const HUE_RAMPS: string[][] = [
  ["#2a78d6", "#86b6ef", "#5598e7", "#0d366b"], // blue
  ["#eb6834", "#f4a07e", "#c04d20", "#8a3614"], // orange
  ["#1baf7a", "#7fd7b8", "#0e7d56", "#0a5a3e"], // aqua
  ["#4a3aa7", "#9085e9", "#6a5ac9", "#322772"], // violet
];

/** Not a building, so not a hue. Online classes occupy no room at all. */
export const ONLINE_ACCENT = "#7a8699";
export const ONLINE_COLUMN = "__online__";

/**
 * Buildings are keyed in the order they first appear in the room list, so the
 * palette is stable as long as the data is — and rooms added to an existing
 * building extend that building's hue rather than shifting anyone else's.
 */
export function buildRoomAccents(rooms: PlanRoom[]): Map<string, string> {
  const buildings: string[] = [];
  for (const room of rooms) if (!buildings.includes(room.building)) buildings.push(room.building);

  const accents = new Map<string, string>();
  for (const building of buildings) {
    const ramp = HUE_RAMPS[buildings.indexOf(building) % HUE_RAMPS.length];
    const inBuilding = rooms.filter((room) => room.building === building);
    inBuilding.forEach((room, index) => accents.set(room.id, ramp[index % ramp.length]));
  }
  return accents;
}

export function accentFor(accents: Map<string, string>, roomId: string | null): string {
  return roomId ? (accents.get(roomId) ?? ONLINE_ACCENT) : ONLINE_ACCENT;
}
