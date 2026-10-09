// Run with `npm test` (Node's built-in test runner).
//
// Popup and modal viewport safety (06-ui-implementation-rules.md §12 "Viewport safety"). The shared
// dialog primitive keeps every dialog inside the screen; ConfirmDialog and ReviewDialog keep their
// header and footer in view and scroll only their body; popovers fit the space available. The class
// merging the wrappers rely on is tested for real with the project's own `cn`.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cn } from "./utils.js";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8").replace(/\r\n/g, "\n");
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const DIALOG = stripComments(read("components/ui/dialog.jsx"));
const CONFIRM = stripComments(read("components/ui/confirm-dialog.jsx"));
const REVIEW = stripComments(read("components/ui/review-dialog.js"));
const POPOVER = stripComments(read("components/ui/popover.jsx"));

const CONTENT_CLASSES = DIALOG.match(/data-slot="dialog-content"[\s\S]*?cn\(\s*"([^"]+)"/)[1];
const BODY_CLASSES = DIALOG.match(/data-slot="dialog-body"[\s\S]*?cn\(\s*"([^"]+)"/)[1];

// ---- the primitive -----------------------------------------------------------------------------------------------------

test("DialogContent keeps a 16px gutter and never exceeds the dynamic viewport height", () => {
  const classes = CONTENT_CLASSES.split(" ");
  assert.ok(classes.includes("w-[calc(100%-2rem)]"), "16px each side");
  assert.ok(classes.includes("max-h-[calc(100dvh-2rem)]"), "dynamic viewport, less the gutter");
  assert.ok(classes.includes("max-w-md"), "the default width is unchanged");
  assert.ok(!classes.includes("w-full"), "no full-width dialog on a phone");
  assert.ok(classes.includes("flex") && classes.includes("flex-col"), "header, body and footer stack");
  // Still centred, so short dialogs look exactly as before.
  assert.ok(["fixed", "top-1/2", "left-1/2", "-translate-x-1/2", "-translate-y-1/2"].every((c) => classes.includes(c)));
});

test("on its own, a dialog scrolls instead of overflowing, and its scroll never chains to the page", () => {
  const classes = CONTENT_CLASSES.split(" ");
  assert.ok(classes.includes("overflow-y-auto"));
  assert.ok(classes.includes("overscroll-contain"));
});

test("DialogBody is the scrolling middle: it takes the height left, scrolls, and keeps focus rings visible", () => {
  const classes = BODY_CLASSES.split(" ");
  for (const c of ["min-h-0", "flex-1", "overflow-y-auto", "overscroll-contain"]) assert.ok(classes.includes(c), c);
  // Reaches the popup's side edges (DialogContent is p-6) and keeps 4px above and below for 3px rings.
  for (const c of ["-mx-6", "px-6", "-my-1", "py-1"]) assert.ok(classes.includes(c), c);
  assert.match(DIALOG, /export \{[\s\S]*DialogBody,[\s\S]*\}/);
  assert.match(read("components/ui/input.jsx"), /focus-visible:ring-3/, "the ring the padding is sized for");
});

test("popovers fit the space available on screen and scroll", () => {
  const popup = POPOVER.match(/data-slot="popover-content"[\s\S]*?cn\(\s*"([^"]+)"/)[1].split(" ");
  assert.ok(popup.includes("max-h-(--available-height)"));
  assert.ok(popup.includes("overflow-y-auto"));
  assert.ok(popup.includes("max-w-[calc(100vw-2rem)]"), "the existing width cap is kept");
  // The same cap the select and dropdown menus already use.
  assert.match(read("components/ui/select.jsx"), /max-h-\(--available-height\)/);
  assert.match(read("components/ui/dropdown-menu.jsx"), /max-h-\(--available-height\)/);
});

// ---- the wrappers ------------------------------------------------------------------------------------------------------

test("ConfirmDialog: header, then one scrolling body (context, note, children), then the footer", () => {
  const header = CONFIRM.indexOf("</DialogHeader>");
  const bodyOpen = CONFIRM.indexOf("<DialogBody");
  const bodyClose = CONFIRM.indexOf("</DialogBody>");
  const footer = CONFIRM.indexOf("<DialogFooter");
  assert.ok(header > 0 && header < bodyOpen && bodyOpen < bodyClose && bodyClose < footer, "header / body / footer");
  for (const slot of ["{context}", "{note}", "{children}"]) {
    const at = CONFIRM.indexOf(slot);
    assert.ok(at > bodyOpen && at < bodyClose, `${slot} scrolls with the body`);
  }
  assert.ok(CONFIRM.indexOf("{context}") < CONFIRM.indexOf("{note}") && CONFIRM.indexOf("{note}") < CONFIRM.indexOf("{children}"), "slot order unchanged");
  // Only the body scrolls: the popup itself is overflow-hidden, so the header, close button and footer stay put.
  assert.match(CONFIRM, /<DialogContent className=\{cn\("overflow-hidden", SIZE_CLASSES\[size\] \?\? SIZE_CLASSES\.default\)\}>/);
  // No body at all when there is nothing to put in it.
  assert.match(CONFIRM, /const hasBody = Boolean\(context \|\| note \|\| children\)/);
});

test("ConfirmDialog keeps its pending, dismissal and button behaviour", () => {
  assert.equal((CONFIRM.match(/disabled=\{isPending\}/g) ?? []).length, 2, "both buttons disabled while pending");
  assert.match(CONFIRM, /onClick=\{\(\) => onOpenChange\(false\)\}/);
  assert.match(CONFIRM, /\{isPending \? pendingLabel : confirmLabel\}/);
  assert.match(CONFIRM, /<Dialog open=\{open\} onOpenChange=\{onOpenChange\}>/);
});

test("ReviewDialog: one scrolling body holding the context and the panel; no second scrollbar; footer outside", () => {
  assert.doesNotMatch(REVIEW, /55vh/);
  assert.equal((REVIEW.match(/overflow-y-auto/g) ?? []).length, 0, "the panel no longer scrolls on its own");
  assert.match(REVIEW, /<DialogContent className="max-w-lg gap-5 overflow-hidden p-6 sm:p-7">/);
  // The body matches the dialog's own padding at sm (p-7).
  assert.match(REVIEW, /<DialogBody className="flex flex-col gap-5 sm:-mx-7 sm:px-7">/);
  const bodyOpen = REVIEW.indexOf("<DialogBody");
  const bodyClose = REVIEW.indexOf("</DialogBody>");
  assert.ok(REVIEW.indexOf("<DialogTitle") < bodyOpen, "header above");
  assert.ok(REVIEW.indexOf("{context}") > bodyOpen && REVIEW.indexOf("{children ? (") < bodyClose, "context and panel scroll");
  assert.ok(REVIEW.indexOf("{context}") < REVIEW.indexOf("{children ? ("), "context before the panel");
  assert.ok(REVIEW.indexOf('{isPending ? "Saving…" : confirmLabel}') > bodyClose, "actions below");
  assert.equal((REVIEW.match(/disabled=\{isPending\}/g) ?? []).length, 2);
});

// ---- sizing ------------------------------------------------------------------------------------------------------------

test("ConfirmDialog sizes: the default keeps max-w-md; lg widens to max-w-lg; both keep the gutter and the height cap", () => {
  assert.match(CONFIRM, /size = "default",/);
  assert.match(CONFIRM, /default: "",/);
  assert.match(CONFIRM, /lg: "max-w-lg",/);

  // Merged exactly as DialogContent merges them, with the project's own cn.
  const merged = (extra) => cn(CONTENT_CLASSES, extra).split(" ");
  const standard = merged(cn("overflow-hidden", ""));
  const wide = merged(cn("overflow-hidden", "max-w-lg"));
  assert.ok(standard.includes("max-w-md") && !standard.includes("max-w-lg"));
  assert.ok(wide.includes("max-w-lg") && !wide.includes("max-w-md"));
  for (const classes of [standard, wide]) {
    assert.ok(classes.includes("w-[calc(100%-2rem)]") && classes.includes("max-h-[calc(100dvh-2rem)]"));
    assert.ok(classes.includes("overflow-hidden") && !classes.includes("overflow-y-auto"), "only the body scrolls");
  }
  const review = cn(CONTENT_CLASSES, "max-w-lg gap-5 overflow-hidden p-6 sm:p-7").split(" ");
  assert.ok(review.includes("max-h-[calc(100dvh-2rem)]") && review.includes("overflow-hidden") && !review.includes("overflow-y-auto"));
});

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : /\.(js|jsx)$/.test(name) ? [path] : [];
  });
}

/** The opening tag of every ConfirmDialog in a file (up to the line that closes it). */
const confirmTags = (source) => source.match(/<ConfirmDialog\b[\s\S]*?\n\s*\/?>\n/g) ?? [];

test("only Record Payment and the bank account form use the wide size", () => {
  const appDir = fileURLToPath(new URL("app/", root));
  const relative = (path) => path.slice(fileURLToPath(root).length).replace(/\\/g, "/");
  const wide = walk(appDir)
    .map(relative)
    .filter((path) => confirmTags(read(path)).some((tag) => /\bsize="lg"/.test(tag)))
    .sort();
  assert.deepEqual(wide, ["app/memberships/[id]/record-payment.js", "app/settings/invoice-receipt/bank-accounts.js"]);

  const payment = read("app/memberships/[id]/record-payment.js");
  assert.match(payment, /<ConfirmDialog[\s\S]*?title="Record payment"\n\s*size="lg"/);
  const bank = read("app/settings/invoice-receipt/bank-accounts.js");
  const bankWide = confirmTags(bank).filter((tag) => /\bsize="lg"/.test(tag));
  assert.equal(bankWide.length, 1, "the editor only, not the status-change confirmation");
  assert.match(bank, /title=\{editing \? "Edit bank account" : "Add bank account"\}\n\s*size="lg"/);
});

test("the rule is documented", () => {
  const rules = read("docs/06-ui-implementation-rules.md");
  assert.match(rules, /### Viewport safety \(every dialog\)/);
  assert.match(rules, /A 16px gutter on each side/);
  assert.match(rules, /`size="lg"`/);
});
