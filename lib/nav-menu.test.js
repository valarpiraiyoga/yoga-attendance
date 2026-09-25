// Run with `npm test` (Node's built-in test runner).
//
// The primary menu is a two-column grid of cards (a neutral icon tile and the
// label; the current page is the solid brand card; an odd last item spans both
// columns). Icons are one quiet style - there are no per-item colours.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

test("the menu keeps the active-page rule, the two-column grid and the spanning last item", () => {
  const list = source("../components/global/NavList.js");
  assert.match(list, /grid grid-cols-2/);
  assert.match(list, /aria-current=\{isActive \? "page" : undefined\}/);
  assert.match(list, /pathname === href \|\| pathname\.startsWith\(`\$\{href\}\/`\)/);
  assert.match(list, /items\.length % 2 === 1/);
  assert.match(list, /col-span-2/);
  assert.match(list, /border-brand bg-brand text-surface/);
});

test("every icon has the same neutral style - no per-item accent colours", () => {
  const list = code("../components/global/NavList.js");
  assert.match(list, /"bg-background text-text-secondary"/);
  assert.doesNotMatch(list, /batch-(blue|green|purple|orange|red|slate|teal)/);
  assert.doesNotMatch(list, /TONES|tone/);
  assert.doesNotMatch(code("../app/data/navigation.js"), /tone:/);
});

test("the cards carry no arrow or corner decoration", () => {
  const list = code("../components/global/NavList.js");
  assert.doesNotMatch(list, /Chevron|rounded-full|-right-5/);
});

test("both the desktop sidebar and the mobile menu render the same list", () => {
  assert.match(source("../components/global/Sidebar.js"), /<NavList /);
  assert.match(source("../components/global/MobileMenu.js"), /<NavList /);
});

test("no KPI tile draws a decorative bar chart (the app keeps no history to chart)", async () => {
  const { readdirSync } = await import("node:fs");
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(new URL(`${dir}/`, import.meta.url), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (/\.jsx?$/.test(entry.name) && /decorativeChart|stat-tile-chart/.test(source(path))) found.push(path);
    }
  };
  ["../app", "../components"].forEach(walk);
  assert.deepEqual(found.filter((path) => !path.endsWith("nav-menu.test.js")), []);
});

test("the centre logo sits on a white padded tile in both the sidebar and the mobile menu", () => {
  const logo = readFileSync(new URL("../components/global/CenterLogo.js", import.meta.url), "utf8");
  assert.match(logo, /size-12 shrink-0 rounded-lg border border-border\/60 bg-surface object-contain p-2/);
  // One component draws it in both places, so the two can never drift apart.
  for (const path of ["../components/global/Sidebar.js", "../components/global/MobileMenu.js"]) {
    assert.match(readFileSync(new URL(path, import.meta.url), "utf8"), /<CenterLogo url=\{logoUrl\} \/>/, path);
  }
});
