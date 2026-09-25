// Run with `npm test` (Node's built-in test runner).
//
// The sign-in page's design: a centred card on a soft leaf background, the brand mark above it, a
// show / hide control on the password, and the copyright below. Signing in itself is unchanged, and
// the controls the product does not define stay out (Google Sign-In, Remember me, a role switch).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "");

test("the sign-in page uses the centred card layout; the other auth screens keep theirs", () => {
  const page = code("../../app/login/page.js");
  assert.match(page, /import AuthCardLayout from "@\/components\/auth\/AuthCardLayout"/);
  assert.match(page, /<AuthCardLayout>/);
  assert.match(page, /Welcome Back/);
  assert.match(page, /Sign in to your account/);
  assert.match(page, /Need help\? Contact your administrator\./);
  for (const path of ["forgot-password/page.js", "reset-password/page.js"]) {
    assert.match(code(`../../app/${path}`), /import AuthLayout from "@\/components\/auth\/AuthLayout"/, path);
  }
  // The error codes and their fixed messages are unchanged.
  assert.match(page, /invite:\s*"Your invitation link is invalid or has expired\./);
  assert.match(page, /recovery: "Your password reset link is invalid or has expired\./);
});

test("the layout is a card on a leaf background with the brand mark and the copyright line", () => {
  const layout = code("../../components/auth/AuthCardLayout.js");
  assert.match(layout, /<Leaf className=/);
  assert.match(layout, /aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10"/, "decoration is hidden from assistive technology");
  assert.match(layout, /rounded-card border border-border bg-surface/);
  assert.match(layout, /Yoga Center/);
  assert.match(layout, /Attendance System/);
  assert.match(layout, /new Date\(\)\.getFullYear\(\)/);
  assert.match(layout, /brand/, "built from the brand colour token, no raw colours");
  assert.doesNotMatch(layout, /#[0-9a-fA-F]{3,6}\b/, "no raw hex values");
});

test("signing in is unchanged: same action and fields, plus a show / hide control on the password", () => {
  const form = code("../../app/login/login-form.js");
  assert.match(form, /import \{ signIn \} from "@\/lib\/auth\/actions"/);
  assert.match(form, /useActionState\(\s*signIn,/);
  assert.match(form, /name="email"/);
  assert.match(form, /name="password"/);
  assert.match(form, /autoComplete="current-password"/);
  // The show / hide control is the shared PasswordInput (also used by Settings -> Reset Password).
  assert.match(form, /import PasswordInput from "@\/components\/ui\/password-input"/);
  assert.match(form, /<PasswordInput\s+id="password"/);
  const input = code("../../components/ui/password-input.js");
  assert.match(input, /type=\{shown \? "text" : "password"\}/);
  assert.match(input, /aria-label=\{shown \? "Hide password" : "Show password"\}/);
  assert.match(input, /aria-pressed=\{shown\}/);
  assert.match(input, /<button\s+type="button"/, "the control never submits the form");
  assert.match(form, /href="\/forgot-password"/);
  assert.match(form, /Sign In\s*<ArrowRight/);
});

test("nothing the product does not define is added: no Google Sign-In, Remember me, theme toggle or role switch", () => {
  const all = [code("../../app/login/page.js"), code("../../app/login/login-form.js"), code("../../components/auth/AuthCardLayout.js")].join("\n");
  assert.doesNotMatch(all, /google/i);
  assert.doesNotMatch(all, /remember me/i);
  assert.doesNotMatch(all, /dark mode|theme/i);
  assert.doesNotMatch(all, />\s*Instructor\s*</);
  assert.doesNotMatch(all, /role=["']tab/);
});
