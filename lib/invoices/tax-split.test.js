// Run with `npm test` (Node's built-in test runner).
//
// Invoice tax presentation (Phase 5A): the stored total tax shown as CGST and SGST. The
// helper only splits and labels what the invoice stored; the database's tax calculation is
// untouched. Whole-paise arithmetic, so the two halves always add up exactly.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { splitTax } from "./tax-split.js";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const paise = (decimalString) => Number(decimalString.replace(".", ""));

test("5% combined -> CGST 2.5% and SGST 2.5%", () => {
  assert.equal(splitTax(661.9, 5).rate, "2.5");
});

test("18% combined -> CGST 9% and SGST 9%", () => {
  assert.equal(splitTax(180, 18).rate, "9");
});

test("5.25% combined -> 2.625% each, with trailing zeros trimmed", () => {
  assert.equal(splitTax(100, 5.25).rate, "2.625");
  assert.equal(splitTax(100, "5.25").rate, "2.625");
  assert.equal(splitTax(100, 12.5).rate, "6.25");
  assert.equal(splitTax(100, 0.01).rate, "0.005");
  assert.equal(splitTax(100, 28).rate, "14");
  assert.equal(splitTax(100, 99.99).rate, "49.995");
});

test("an even tax amount splits into two equal halves", () => {
  const split = splitTax(661.9, 5);
  assert.equal(split.cgst, "330.95");
  assert.equal(split.sgst, "330.95");
  assert.equal(splitTax(152.54, 18).cgst, "76.27");
  assert.equal(splitTax(152.54, 18).sgst, "76.27");
});

test("an odd-paisa tax amount: CGST is the rounded half (a half rounds up), SGST is the rest", () => {
  const split = splitTax(9.09, 10);
  assert.equal(split.cgst, "4.55");
  assert.equal(split.sgst, "4.54");
  // The case floating point gets wrong: 4.545 * 100 is 454.49999999999994.
  assert.equal(split.cgstPaise, 455);
  assert.equal(split.sgstPaise, 454);
  assert.equal(splitTax(0.01, 5).cgst, "0.01");
  assert.equal(splitTax(0.01, 5).sgst, "0.00");
  assert.equal(splitTax(0.03, 5).cgst, "0.02");
  assert.equal(splitTax(0.03, 5).sgst, "0.01");
});

test("CGST + SGST equals the stored total tax exactly, for every amount", () => {
  for (let p = 1; p <= 5000; p += 1) {
    const stored = `${(p - (p % 100)) / 100}.${String(p % 100).padStart(2, "0")}`;
    const split = splitTax(stored, 18);
    assert.equal(split.cgstPaise + split.sgstPaise, p, stored);
    assert.equal(paise(split.cgst) + paise(split.sgst), p, stored);
    assert.ok(split.cgstPaise >= split.sgstPaise && split.cgstPaise - split.sgstPaise <= 1, stored);
  }
  // Large and typical amounts, given as numbers or as the stored text.
  for (const stored of [661.9, "661.90", 1234567.89, 99999999.99, 0.5, 13900]) {
    const split = splitTax(stored, 5);
    assert.equal(paise(split.cgst) + paise(split.sgst), Math.round(Number(stored) * 100), String(stored));
  }
});

test("no split for tax off, a zero tax amount, or a missing or zero rate", () => {
  for (const [amount, rate] of [[null, null], [undefined, undefined], [null, 18], [180, null], [0, 18], ["0.00", 18], [180, 0], [180, "0.00"]]) {
    assert.equal(splitTax(amount, rate), null, `${amount} / ${rate}`);
  }
});

test("values that are not a stored decimal produce no split instead of a guess", () => {
  for (const bad of ["abc", "", "1e3", "-5", "12.345", NaN, {}]) {
    assert.equal(splitTax(bad, 18), null, String(bad));
    assert.equal(splitTax(100, bad), null, String(bad));
  }
});

test("the helper never recalculates the tax: it takes the stored tax amount and the stored rate, nothing else", () => {
  assert.equal(splitTax.length, 2);
  // The rate only labels the halves; changing it does not change the amounts.
  assert.deepEqual([splitTax(661.9, 5).cgst, splitTax(661.9, 18).cgst], ["330.95", "330.95"]);
  // It has no access to the invoice total or the amount before tax, so it cannot recompute either.
  const helper = code("./tax-split.js");
  assert.doesNotMatch(helper, /taxable|total_amount|tax_name|taxName|invoice/i);
});

test("no floating-point arithmetic touches an amount or a rate", () => {
  const helper = code("./tax-split.js");
  assert.doesNotMatch(helper, /Math\./);
  assert.doesNotMatch(helper, /toFixed|parseFloat|toLocaleString|Intl\./);
  // Scaling by 100 / 1000 is whole-number arithmetic on integers; what must not appear is a decimal literal.
  assert.doesNotMatch(helper, /[^\w"'`.]\d+\.\d+/, "no decimal-number literals");
  assert.doesNotMatch(helper, /^\s*import\b/m, "pure: no imports");
});

test("existing invoices are not changed: the helper reads values and writes nothing", () => {
  const stored = Object.freeze({ tax_amount: 661.9, tax_rate: 5, taxable_amount: 13238.1, total_amount: 13900 });
  const before = JSON.stringify(stored);
  splitTax(stored.tax_amount, stored.tax_rate);
  assert.equal(JSON.stringify(stored), before);
  const helper = code("./tax-split.js");
  assert.doesNotMatch(helper, /supabase|\.from\(|\.rpc\(|\.update\(|fetch\(/);
});

test("the database, Settings and the tax model are untouched by this presentation", () => {
  // No tax code in SQL changed: the helper is not referenced from any migration, and Settings does not use it.
  for (const file of [
    "../invoice-settings/validation.js",
    "../invoice-settings/settings-core.js",
    "../invoice-settings/actions.js",
    "../../app/settings/invoice-receipt/invoice-receipt-form.js",
  ]) {
    assert.doesNotMatch(source(file), /tax-split|splitTax|CGST|SGST/, file);
  }
  // The Settings tax fields are still the single name and rate.
  const form = code("../../app/settings/invoice-receipt/invoice-receipt-form.js");
  assert.match(form, /name="tax_name"/);
  assert.match(form, /name="tax_rate"/);
  assert.doesNotMatch(form, /Add Tax|tax_components/);
});
