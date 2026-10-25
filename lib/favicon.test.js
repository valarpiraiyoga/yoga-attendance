// Run with `npm test` (Node's built-in test runner).
//
// The app's favicon is the YogaSync symbol (the A with the yogi and infinity loop) cropped from the existing logo - not the wide
// wordmark, which is unreadable at 16px - using the Next.js App Router file conventions (app/favicon.ico, app/icon.png,
// app/apple-icon.png), so the layout's metadata needs no `icons` entry. Checked against the real files' bytes.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const bytes = (path) => readFileSync(new URL(`../${path}`, import.meta.url));
const text = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngSize = (buffer) => ({ width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), colorType: buffer[25] });

test("icon.png: a square PNG large enough to be scaled down, with transparency (RGBA)", () => {
  const icon = bytes("app/icon.png");
  assert.deepEqual(icon.subarray(0, 8), PNG_SIGNATURE);
  const { width, height, colorType } = pngSize(icon);
  assert.equal(width, height, "square: the symbol is not squeezed into a different aspect ratio");
  assert.ok(width >= 192, "big enough for high-DPI tabs and for browsers that scale it");
  assert.equal(colorType, 6, "RGBA: the symbol keeps its transparent background");
});

test("apple-icon.png: a square 180px PNG, opaque (iOS fills transparency with black)", () => {
  const icon = bytes("app/apple-icon.png");
  assert.deepEqual(icon.subarray(0, 8), PNG_SIGNATURE);
  const { width, height, colorType } = pngSize(icon);
  assert.deepEqual([width, height], [180, 180]);
  assert.equal(colorType, 2, "RGB, no alpha channel");
});

test("favicon.ico: a real ICO holding 16, 32 and 48 pixel frames (the default Next.js icon is replaced)", () => {
  const ico = bytes("app/favicon.ico");
  assert.deepEqual([ico.readUInt16LE(0), ico.readUInt16LE(2)], [0, 1], "ICO header: reserved 0, type 1 (icon)");
  const count = ico.readUInt16LE(4);
  const frames = Array.from({ length: count }, (_, i) => {
    const entry = 6 + i * 16;
    const size = ico[entry] || 256;
    const length = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    return { width: size, height: ico[entry + 1] || 256, length, offset, data: ico.subarray(offset, offset + length) };
  });
  assert.deepEqual(frames.map((frame) => frame.width), [16, 32, 48]);
  for (const frame of frames) {
    assert.equal(frame.width, frame.height, `${frame.width}px frame is square`);
    assert.deepEqual(frame.data.subarray(0, 8), PNG_SIGNATURE, `${frame.width}px frame is a PNG`);
    assert.deepEqual(pngSize(frame.data), { width: frame.width, height: frame.height, colorType: 6 }, `${frame.width}px frame is RGBA at its own size`);
    assert.ok(frame.offset + frame.length <= ico.length, `${frame.width}px frame lies inside the file`);
  }
  assert.ok(ico.length > 1000, "not the 1x1 placeholder");
});

test("the layout's metadata is untouched: no `icons` override that would fight the file conventions", () => {
  const layout = text("app/layout.js");
  assert.match(layout, /title: "YogaSync-Management"/);
  assert.match(layout, /description: "Attendance management for yoga center students, batches, and classes\."/);
  assert.doesNotMatch(layout.replace(/\/\*[\s\S]*?\*\//g, ""), /\bicons\s*:/);
});

test("the logo files it was cut from are untouched and still the ones the login screens use", () => {
  assert.ok(bytes("public/yogasync.png").length > 100000);
  assert.match(text("components/auth/AuthLayout.js"), /src="\/yogasync\.png"/);
  assert.match(text("components/auth/AuthCardLayout.js"), /src="\/yogasync\.png"/);
});
