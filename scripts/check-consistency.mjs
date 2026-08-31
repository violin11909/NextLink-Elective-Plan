#!/usr/bin/env node
/**
 * Cross-page checks the type-checker and the CSS check cannot make.
 *
 * The v1 dashboards were three copies of one layout, so every rule here
 * compared the three against each other. The planner is not that shape — the
 * overview carries the KPI row and the follow-up queue, the room pages carry a
 * grid, the course page carries a form. A rule that demanded all four look
 * alike would be a rule everyone routes around, so the rules below are scoped
 * to the pages they actually mean something for.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";

/** Every top-level page component, in nav order. */
const PAGES = ["plan-overview", "course-list", "room-list", "room-schedule", "availability-editor"];
/** The page that leads with the KPI row and the follow-up queue. */
const OVERVIEW = "plan-overview";
/**
 * Every page renders through the one shell, which is what guarantees the header
 * and nav are identical on all of them. Listing AppNav here instead would be
 * the weaker rule: a page could satisfy it and still build its own header
 * around the nav, which is exactly how the v1 dashboards drifted.
 */
const SHARED = ["PlanShell"];
/** ...and the shell has to be the thing that actually carries the nav. */
const SHELL = { file: "components/plan-shell.tsx", uses: "<AppNav" };
/**
 * The KPI row's tone order, checked against a declared list rather than against
 * another page: there is only one KPI page now, and a cross-page rule with one
 * page in it checks nothing. `red` comes from <PriorityKpi>, which hard-codes it.
 */
const KPI_TONE_ORDER = ["red", "blue", "green", "purple", "orange"];

const path = (name) => `components/${name}.tsx`;
const built = PAGES.filter((name) => existsSync(path(name)));
const read = (name) => readFileSync(path(name), "utf8");
const failures = [];

if (built.length === 0) {
  console.error("components: no page components exist yet — nothing to check");
  process.exit(1);
}

// 1. KPI tone order. A reader learns "the red one is what needs me" by
//    position; a row that reshuffles between releases teaches nothing.
if (built.includes(OVERVIEW)) {
  const source = read(OVERVIEW);
  const tones = [...source.matchAll(/className="kpi-card ([a-z]+)"/g)].map((m) => m[1]);
  const order = [source.includes("<PriorityKpi") ? "red" : "(no PriorityKpi)", ...tones];
  if (order.join(" ") !== KPI_TONE_ORDER.join(" ")) {
    failures.push(`${OVERVIEW} KPI row is ${order.join(" ")}, expected ${KPI_TONE_ORDER.join(" ")}`);
  }
}

// 2. An eyebrow line above a heading only earns its space by saying something
//    else than the heading it sits on.
for (const name of built) {
  for (const m of read(name).matchAll(/section-kicker">([^<]*)<\/p><h[1-4][^>]*>([^<]*)/g)) {
    if (m[1].trim() === m[2].trim()) {
      failures.push(`${name} repeats itself: kicker and heading are both "${m[1].trim()}"`);
    }
  }
}

// 3. The shared building blocks are only shared if every page actually uses
//    them. Kept deliberately short — see the header comment.
for (const name of built) {
  const source = read(name);
  const missing = SHARED.filter((component) => !source.includes(`<${component}`));
  if (missing.length) failures.push(`${name} does not use ${missing.join(", ")}`);
}
if (!readFileSync(SHELL.file, "utf8").includes(SHELL.uses)) {
  failures.push(`${SHELL.file} no longer renders ${SHELL.uses} — the nav is not shared any more`);
}

/**
 * 4. Rules nothing can match any more.
 *
 * Every rewrite leaves some behind, and a rule that matches nothing is exactly
 * what a welded selector turns into — the phone layout rendered every row twice
 * for as long as one of those went unnoticed. Searching the components as plain
 * text catches class names built at runtime too.
 */
const componentSource = [
  ...readdirSync("components").filter((f) => f.endsWith(".tsx")).map((f) => `components/${f}`),
  ...readdirSync("app").filter((f) => f.endsWith(".tsx")).map((f) => `app/${f}`),
].map((f) => readFileSync(f, "utf8")).join("\n");

const stylesheet = readFileSync("app/globals.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");
const declared = new Set();
for (const m of stylesheet.matchAll(/(^|[};])\s*([^{};@][^{}]*?)\s*\{/g)) {
  for (const cls of m[2].matchAll(/\.([A-Za-z][A-Za-z0-9_-]*)/g)) declared.add(cls[1]);
}
// Composed at runtime from data, so the class name never appears whole.
const COMPOSED = /^(tone|queue|is|has|kpi-progress-fill|readiness-fill|bar-fill|skeleton)/;
const unused = [...declared].filter((cls) => !COMPOSED.test(cls) && !componentSource.includes(cls)).sort();
if (unused.length) {
  failures.push(`app/globals.css styles ${unused.length} class(es) nothing carries any more:\n${unused.map((c) => `      .${c}`).join("\n")}`);
}

if (failures.length) {
  console.error(`components: ${failures.length} inconsistency(ies)\n`);
  for (const f of failures) console.error(`  ${f}\n`);
  process.exit(1);
}
console.log(`components: ok (${built.length}/${PAGES.length} pages built, 4 checks)`);
