// Run with `npm test` (Node's built-in test runner).
//
// Admin-generated temporary passwords: strong, random, readable, and drawn from the CSPRNG. The generator is pure, so it is tested by running it.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MIN_PASSWORD_LENGTH } from "./password-rules.js";
import { TEMPORARY_PASSWORD_LENGTH, generateTemporaryPassword } from "./temporary-password.js";

const HAS_UPPER = /[A-Z]/;
const HAS_LOWER = /[a-z]/;
const HAS_DIGIT = /[0-9]/;
const HAS_SYMBOL = /[!@#$%&*?]/;

test("a temporary password is 16 characters and meets the application's password rule", () => {
  const password = generateTemporaryPassword();
  assert.equal(password.length, TEMPORARY_PASSWORD_LENGTH);
  assert.equal(TEMPORARY_PASSWORD_LENGTH, 16);
  assert.ok(password.length >= MIN_PASSWORD_LENGTH);
});

test("every password has an upper-case letter, a lower-case letter, a digit and a symbol - over many draws", () => {
  for (let index = 0; index < 2000; index += 1) {
    const password = generateTemporaryPassword();
    assert.ok(HAS_UPPER.test(password) && HAS_LOWER.test(password) && HAS_DIGIT.test(password) && HAS_SYMBOL.test(password), password);
  }
});

test("look-alike characters are never used (0 O 1 l I), nor any space or quote", () => {
  for (let index = 0; index < 2000; index += 1) {
    assert.doesNotMatch(generateTemporaryPassword(), /[0O1lI\s'"`\\]/);
  }
});

test("passwords differ from one call to the next", () => {
  const seen = new Set();
  for (let index = 0; index < 1000; index += 1) seen.add(generateTemporaryPassword());
  assert.equal(seen.size, 1000);
});

test("positions are shuffled: the guaranteed character classes do not always lead the password", () => {
  const firstIsSymbol = Array.from({ length: 500 }, () => HAS_SYMBOL.test(generateTemporaryPassword()[0]));
  assert.ok(firstIsSymbol.some(Boolean) && firstIsSymbol.some((value) => !value));
});

test("the random source is injectable and every draw is in range (so the CSPRNG's bounds are honoured)", () => {
  const draws = [];
  const random = (max) => {
    assert.ok(Number.isInteger(max) && max > 0);
    draws.push(max);
    return 0;
  };
  const password = generateTemporaryPassword({ random });
  assert.equal(password.length, TEMPORARY_PASSWORD_LENGTH);
  assert.ok(draws.length >= TEMPORARY_PASSWORD_LENGTH, "one draw per character at least");
});

test("a length below the application's minimum is raised to it", () => {
  assert.ok(generateTemporaryPassword({ length: 3 }).length >= MIN_PASSWORD_LENGTH);
});

test("it draws from Node's CSPRNG, never Math.random", () => {
  const source = readFileSync(new URL("./temporary-password.js", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "");
  assert.match(source, /from "node:crypto"/);
  assert.ok(source.includes("randomInt"));
  assert.ok(!source.includes("Math.random"));
});
