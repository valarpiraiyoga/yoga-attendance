// Run with `npm test` (Node's built-in test runner).
//
// Add / Edit Batch -> Batch Identity: the Color select sits on a white field (the `surface` token) instead of showing the
// section's tint through it, and the Upload / Change Image button is the shared Button's `secondary` variant. Only these two
// visual details changed: the stacked photo card of Students, Instructors and the Center Logo keeps its own button style.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

test("the Color select is on a white field: the surface token, which is #ffffff", () => {
  const field = code("../../app/batches/batch-identity-field.js");
  assert.match(field, /<SelectTrigger \{\.\.\.field\} className="bg-surface">/);
  // The token is white; no raw colour was introduced.
  assert.match(source("../../app/globals.css"), /--surface:\s*#ffffff;/i);
  assert.doesNotMatch(field, /#[0-9a-f]{3,8}\b|bg-white/i);
});

test("the Color select otherwise keeps its trigger: dot, label, arrow, border, radius and height come from the shared SelectTrigger", () => {
  const field = code("../../app/batches/batch-identity-field.js");
  assert.match(field, /<BatchColorDot color=\{value\} \/>/);
  assert.match(field, /COLOR_ITEMS\.find\(\(item\) => item\.value === value\)\?\.label \?\? "Teal"/);
  // Only a background is passed: no size, border, radius or text override.
  assert.doesNotMatch(field, /<SelectTrigger[^>]*className="[^"]*\b(h-|w-|px-|py-|border|rounded|text-)/);
  // The shared trigger is transparent by default and takes a passed className last, so `bg-surface` replaces it.
  const select = source("../../components/ui/select.jsx");
  assert.match(select, /rounded-input border border-input bg-transparent/);
  assert.match(select, /cn\(\s*"[^"]*",\s*className\s*\)/);
});

test("the Batch image button is the shared Button's secondary variant, which exists and uses the brand tokens", () => {
  const photo = code("../../components/ui/profile-photo-field.js");
  assert.match(photo, /variant=\{stacked \? "outline" : "secondary"\}\s*size="sm"/);
  const button = source("../../components/ui/button.jsx");
  assert.match(button, /secondary:\s*"bg-primary\/10 text-primary hover:bg-primary\/15/);
  // No new button style was created for it.
  assert.doesNotMatch(photo, /variant="secondary"[\s\S]*className=\{[^}]*bg-/);
});

test("the Upload Image button keeps its icon, label and size", () => {
  const photo = code("../../components/ui/profile-photo-field.js");
  assert.match(photo, /<ImageUp className=\{stacked \? "size-5" : "size-4"\} aria-hidden="true" \/>/);
  assert.match(photo, /\{shownUrl \? `Change \$\{noun\}` : `Upload \$\{noun\}`\}/);
  assert.match(photo, /variant=\{stacked \? "outline" : "secondary"\}\s*size="sm"/);
  assert.match(code("../../app/batches/batch-identity-field.js"), /noun="Image"/);
});

test("only the Batch layout changes: the stacked photo card keeps its own button styling", () => {
  const photo = code("../../components/ui/profile-photo-field.js");
  assert.match(photo, /stacked \? "h-10 w-full border-brand\/30 bg-brand\/10 text-brand hover:bg-brand\/15 hover:text-brand" : undefined/);
  // The Remove button is untouched too.
  assert.match(photo, /variant=\{stacked \? "outline" : "ghost"\}/);
  // Students, Instructors and the Center Logo reach it only through the stacked card; Batch alone uses the plain layout.
  assert.match(code("../../components/ui/profile-photo-card.js"), /<ProfilePhotoField[\s\S]*?\bstacked\b/);
  assert.doesNotMatch(code("../../app/batches/batch-identity-field.js"), /\bstacked\b/);
});

test("nothing else about the field changed: the upload behaviour, validation and layout are as they were", () => {
  const field = code("../../app/batches/batch-identity-field.js");
  assert.match(field, /<fieldset className="flex flex-col gap-4 rounded-card border border-border bg-brand\/5 p-5">/);
  assert.match(field, /md:grid-cols-\[minmax\(0,1fr\)_auto_minmax\(0,1fr\)\]/);
  assert.match(field, /onChange=\{onImageChange\}/);
  const photo = code("../../components/ui/profile-photo-field.js");
  assert.match(photo, /onClick=\{\(\) => inputRef\.current\?\.click\(\)\}/);
  assert.match(photo, /type="file"/);
});
