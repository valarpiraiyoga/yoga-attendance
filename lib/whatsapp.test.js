// Run with `npm test` (Node's built-in test runner).
//
// The receipt's "Send WhatsApp" link must stay correct now that a phone has a
// stored calling code: with a code, the link is code + national digits (so a
// non-Indian 10-digit number is not mistaken for an Indian one); without one
// (a legacy number), the old India-default convention is unchanged.

import test from "node:test";
import assert from "node:assert/strict";
import { buildWhatsAppUrl, normalizeWhatsAppNumber } from "./whatsapp.js";

test("a stored calling code is put in front of the national digits", () => {
  assert.equal(normalizeWhatsAppNumber("9876543210", "+91"), "919876543210");
  assert.equal(normalizeWhatsAppNumber("7911123456", "+44"), "447911123456");
});

test("a non-Indian 10-digit number with its code is not given +91", () => {
  assert.equal(normalizeWhatsAppNumber("2025550123", "+1"), "12025550123");
});

test("a leading zero on the national number is dropped", () => {
  assert.equal(normalizeWhatsAppNumber("07911123456", "+44"), "447911123456");
});

test("a code with no number, or an over-long result, gives no link", () => {
  assert.equal(normalizeWhatsAppNumber("", "+91"), null);
  assert.equal(normalizeWhatsAppNumber("1".repeat(15), "+91"), null);
});

test("legacy numbers (no stored code) keep the old convention", () => {
  assert.equal(normalizeWhatsAppNumber("9876543210"), "919876543210");
  assert.equal(normalizeWhatsAppNumber("9876543210", null), "919876543210");
  assert.equal(normalizeWhatsAppNumber("919876543210", ""), "919876543210");
  assert.equal(normalizeWhatsAppNumber("12345"), null);
  assert.equal(normalizeWhatsAppNumber(""), null);
});

test("buildWhatsAppUrl uses the code when given and encodes the message", () => {
  assert.equal(buildWhatsAppUrl("7911123456", "Hi there", "+44"), "https://wa.me/447911123456?text=Hi%20there");
  assert.equal(buildWhatsAppUrl("9876543210", "Hi"), "https://wa.me/919876543210?text=Hi");
  assert.equal(buildWhatsAppUrl("", "Hi", "+91"), null);
});
