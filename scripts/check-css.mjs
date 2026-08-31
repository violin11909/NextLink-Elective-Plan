#!/usr/bin/env node
/**
 * Static checks for the failure shapes this stylesheet has actually produced.
 *
 * `tsc` and `next build` both pass happily on broken CSS — neither one parses a
 * selector. Every rule below exists because a real bug shipped in that shape.
 */
import { readFileSync } from "node:fs";

const FILE = "app/globals.css";
const css = readFileSync(FILE, "utf8");
const failures = [];
const lineOf = (index) => css.slice(0, index).split("\n").length;
const fail = (index, rule, detail) => failures.push({ line: lineOf(index), rule, detail });

// Comments would otherwise be read as selectors and declarations.
const bare = css.replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length));

// 1. Braces. A regex edit that eats one brace silently merges two rules.
if ((bare.match(/{/g) || []).length !== (bare.match(/}/g) || []).length) {
  failures.push({ line: 0, rule: "unbalanced-braces", detail: "{ and } counts differ" });
}

// 2. A selector naming the same class twice matches nothing. This is what a
//    regex that deletes half of `.a.b { ... }` leaves behind, and it silenced
//    two layout rules for a full release.
for (const m of bare.matchAll(/(^|[};])\s*([^{};@][^{}]*?)\s*{/g)) {
  for (const part of m[2].split(",")) {
    const classes = part.match(/\.[A-Za-z0-9_-]+/g) || [];
    if (classes.length !== new Set(classes).size) {
      fail(m.index, "repeated-class-in-selector", part.trim().slice(0, 80));
    }
  }
}

// 3. A height derived from the viewport cannot know how tall its siblings are.
//    Sizing a scroll body this way let it claim more room than its container
//    had; the surplus was clipped and the save button became unreachable.
for (const m of bare.matchAll(/max-height:\s*calc\([^)]*\dvh[^)]*[-+][^)]*px[^)]*\)/g)) {
  fail(m.index, "viewport-minus-pixels-height", m[0]);
}

// 4. A focus ring is a state indicator and owes the page 3:1. Below ~0.8 alpha
//    this palette's blue washes out under that on white.
for (const m of bare.matchAll(/outline:[^;]*rgba\(([^)]*)\)/g)) {
  const alpha = Number(m[1].split(",")[3]);
  if (Number.isFinite(alpha) && alpha < 0.8) fail(m.index, "faint-focus-ring", m[0].slice(0, 70));
}

// 5. Every rule in this file sits on its own line with single spaces. A
//    combinator followed by a run of whitespace means a regex edit ate a line
//    ending and welded two selectors together — which is how
//    `.internship-shell .table-wrap { display: none }` stopped applying and the
//    phone layout started rendering every row twice, table and cards at once.
for (const m of bare.matchAll(/(^|[};])\s*([^{};@][^{}]*?)\s*{/g)) {
  if (/[>+~]\s{2,}/.test(m[2])) fail(m.index, "welded-selector", m[2].trim().slice(0, 80));
}

// 5. A horizontal scroll container is always a vertical one too, so it captures
//    every sticky descendant. Putting one around a table whose header is meant
//    to stick to the page stops the header sticking at all.
const stickyOwners = [...bare.matchAll(/([^{}]*){[^}]*position:\s*sticky[^}]*}/g)]
  .flatMap((m) => m[1].split(",").map((s) => s.trim()));
if (stickyOwners.length) {
  for (const m of bare.matchAll(/([^{}]*){[^}]*overflow(-x)?:\s*(auto|scroll)[^}]*}/g)) {
    const selector = m[1].trim().split(",")[0].trim();
    if (/table-panel|app-shell|page-content/.test(selector)) {
      fail(m.index, "scroll-container-over-sticky", `${selector} captures sticky: ${stickyOwners.join(", ")}`);
    }
  }
}

if (failures.length) {
  console.error(`${FILE}: ${failures.length} problem(s)\n`);
  for (const f of failures) console.error(`  ${FILE}:${f.line}  ${f.rule}\n    ${f.detail}`);
  process.exit(1);
}
console.log(`${FILE}: ok (${css.split("\n").length} lines, 6 checks)`);
