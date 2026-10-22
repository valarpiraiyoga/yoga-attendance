// Temporary passwords (Admin-generated instructor access). Server-side only: it uses Node's CSPRNG (`crypto.randomInt`, which is unbiased), never
// Math.random. Pure otherwise (relative imports only), and the random source can be injected so tests are deterministic.
//
// The password is shown to the Admin once, to be handed to the instructor, and is never stored, logged or returned again. It must be changed at the
// instructor's first sign-in (lib/auth/password-change-required.js).

import { randomInt } from "node:crypto";
import { MIN_PASSWORD_LENGTH } from "./password-rules.js";

// No look-alike characters (0/O, 1/l/I) so a password read out or typed from a note is not misread. Symbols are limited to ones that survive
// chat apps and keyboards.
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%&*?";
const ALPHABET = UPPER + LOWER + DIGITS + SYMBOLS;

export const TEMPORARY_PASSWORD_LENGTH = 16;

/**
 * A new random temporary password: TEMPORARY_PASSWORD_LENGTH characters with at least one upper-case letter, one lower-case letter, one digit
 * and one symbol, in an unpredictable order (a Fisher-Yates shuffle driven by the same CSPRNG).
 *
 * @param {{ random?: (maxExclusive: number) => number, length?: number }} [options]
 * @returns {string}
 */
export function generateTemporaryPassword({ random = randomInt, length = TEMPORARY_PASSWORD_LENGTH } = {}) {
  const size = Math.max(length, MIN_PASSWORD_LENGTH, 4);
  const pick = (set) => set[random(set.length)];

  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < size) chars.push(pick(ALPHABET));

  for (let index = chars.length - 1; index > 0; index -= 1) {
    const other = random(index + 1);
    [chars[index], chars[other]] = [chars[other], chars[index]];
  }
  return chars.join("");
}
