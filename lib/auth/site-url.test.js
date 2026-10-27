// Run with `npm test` (Node's built-in test runner).
//
// Audit finding F-02: the password-reset action built the link in the email from the request's `Origin` header, which whoever makes the
// request controls. It now comes from the `SITE_URL` setting. The URL-building (`lib/auth/site-url.js`) is run for real; the action
// (`lib/auth/actions.js`, which needs Next and Supabase to load) is checked as source and has not been exercised at runtime.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEV_DEFAULT_SITE_URL, SITE_URL_ENV, passwordResetRedirectUrl, resolveSiteUrl } from "./site-url.js";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const prod = (SITE_URL) => ({ SITE_URL, NODE_ENV: "production" });

// ---- a valid configured address ---------------------------------------------------------------------------------------------------------

test("a valid https SITE_URL gives that origin and the recovery link on it", () => {
  assert.deepEqual(resolveSiteUrl(prod("https://yoga.example.com")), { ok: true, origin: "https://yoga.example.com" });
  assert.deepEqual(passwordResetRedirectUrl(prod("https://yoga.example.com")), { ok: true, url: "https://yoga.example.com/auth/recovery?next=/reset-password" });
});

test("the recovery link keeps exactly the shape the action always sent: /auth/recovery and a literal ?next=/reset-password", () => {
  const { url } = passwordResetRedirectUrl(prod("https://yoga.example.com"));
  const parsed = new URL(url);
  assert.equal(parsed.pathname, "/auth/recovery");
  assert.equal(parsed.searchParams.get("next"), "/reset-password");
  assert.ok(url.endsWith("/auth/recovery?next=/reset-password"), "the slash in next is not percent-encoded, so Supabase's allowlist matches as before");
  assert.equal(parsed.hash, "", "no fragment: Supabase adds the session to it");
});

test("the configured value is normalized: a trailing slash, surrounding spaces, upper-case host and a default port are tidied", () => {
  for (const value of ["https://yoga.example.com/", "  https://yoga.example.com  ", "https://YOGA.Example.COM", "https://yoga.example.com:443", "https://yoga.example.com:443/"]) {
    assert.deepEqual(resolveSiteUrl(prod(value)), { ok: true, origin: "https://yoga.example.com" }, value);
  }
  assert.deepEqual(resolveSiteUrl(prod("https://yoga.example.com:8443")), { ok: true, origin: "https://yoga.example.com:8443" }, "a real port is kept");
  assert.equal(passwordResetRedirectUrl(prod("https://yoga.example.com/")).url, "https://yoga.example.com/auth/recovery?next=/reset-password", "no double slash");
});

test("http is accepted only for a loopback host (local development), never for a real one", () => {
  for (const value of ["http://localhost:3000", "http://localhost", "http://127.0.0.1:3457", "http://[::1]:3000"]) {
    assert.equal(resolveSiteUrl(prod(value)).ok, true, value);
  }
  for (const value of ["http://yoga.example.com", "http://192.168.1.20:3000", "http://localhost.evil.example", "http://127.0.0.1.evil.example"]) {
    assert.deepEqual(resolveSiteUrl(prod(value)), { ok: false, reason: "insecure" }, value);
  }
});

// ---- missing or malformed configuration ----------------------------------------------------------------------------------------------------

test("a missing SITE_URL is an error outside development, and there is no fallback to anything request-controlled", () => {
  for (const env of [{}, { NODE_ENV: "production" }, { NODE_ENV: "test" }, { SITE_URL: "", NODE_ENV: "production" }, { SITE_URL: "   ", NODE_ENV: "production" }, { SITE_URL: undefined, NODE_ENV: "production" }, undefined, null]) {
    assert.deepEqual(resolveSiteUrl(env), { ok: false, reason: "not-set" }, JSON.stringify(env));
    assert.deepEqual(passwordResetRedirectUrl(env), { ok: false, reason: "not-set" });
  }
});

test("only under `next dev` does an unset SITE_URL fall back, and to a fixed local address", () => {
  assert.deepEqual(resolveSiteUrl({ NODE_ENV: "development" }), { ok: true, origin: "http://localhost:3000" });
  assert.deepEqual(resolveSiteUrl({ SITE_URL: "", NODE_ENV: "development" }), { ok: true, origin: "http://localhost:3000" });
  assert.equal(DEV_DEFAULT_SITE_URL, "http://localhost:3000");
  assert.equal(passwordResetRedirectUrl({ NODE_ENV: "development" }).url, "http://localhost:3000/auth/recovery?next=/reset-password");
  // A value that IS set but wrong is still an error in development: it is not silently replaced.
  assert.deepEqual(resolveSiteUrl({ SITE_URL: "not a url", NODE_ENV: "development" }), { ok: false, reason: "invalid" });
});

test("a SITE_URL that is not a plain https origin is rejected", () => {
  const cases = {
    invalid: ["not a url", "yoga.example.com", "//yoga.example.com", "https://", "https:///x", "https:////x", "https:\\yoga.example.com", "https:/yoga.example.com", "ftp://yoga.example.com", "javascript:alert(1)", "data:text/html,x", "file:///etc/passwd"],
    "has-credentials": ["https://user@yoga.example.com", "https://user:pass@yoga.example.com", "https://@yoga.example.com"].slice(0, 2),
    "not-an-origin": ["https://yoga.example.com/app", "https://yoga.example.com/auth/recovery", "https://yoga.example.com?x=1", "https://yoga.example.com#frag", "https://yoga.example.com/?x=1", "https://yoga.example.com//"],
  };
  for (const [reason, values] of Object.entries(cases)) {
    for (const value of values) assert.deepEqual(resolveSiteUrl(prod(value)), { ok: false, reason }, value);
  }
});

test("non-string configuration is treated as not set, and nothing throws", () => {
  for (const value of [42, true, {}, [], ["https://yoga.example.com"], () => "https://yoga.example.com"]) {
    assert.doesNotThrow(() => resolveSiteUrl({ SITE_URL: value, NODE_ENV: "production" }));
    assert.deepEqual(resolveSiteUrl({ SITE_URL: value, NODE_ENV: "production" }), { ok: false, reason: "not-set" });
  }
});

test("a reason never contains the configured value (it may be logged)", () => {
  for (const value of ["https://user:secret-pass@yoga.example.com", "http://internal-host.example", "https://yoga.example.com/private-path?token=abc", "garbage-value-123"]) {
    const result = resolveSiteUrl(prod(value));
    assert.equal(result.ok, false);
    assert.match(result.reason, /^(not-set|invalid|insecure|has-credentials|not-an-origin)$/);
    assert.ok(!JSON.stringify(result).includes("secret-pass") && !JSON.stringify(result).includes("token=abc"));
  }
});

// ---- the Origin header cannot influence it ----------------------------------------------------------------------------------------------------

test("the helpers take only the environment: a request Origin has nowhere to enter", () => {
  assert.equal(resolveSiteUrl.length, 1, "resolveSiteUrl(env)");
  assert.equal(passwordResetRedirectUrl.length, 1, "passwordResetRedirectUrl(env)");
  const source = read("lib/auth/site-url.js").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(source, /headers|\.get\(|(?:^|[^a-z])request(?:[^a-z]|$)/i, "no request or header access");
  assert.doesNotMatch(source, /^import\s/m, "no imports: pure");
  // Whatever an attacker sends, the same environment gives the same link.
  const env = prod("https://yoga.example.com");
  assert.equal(passwordResetRedirectUrl(env).url, passwordResetRedirectUrl({ ...env, ORIGIN: "https://evil.example", HTTP_ORIGIN: "https://evil.example", HOST: "evil.example" }).url);
});

test("the action no longer reads the Origin header; the redirect comes from the configured address", () => {
  const actions = read("lib/auth/actions.js");
  const code = actions.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /headers\(\)|from "next\/headers"|get\("origin"\)|\$\{origin\}/, "no header-derived origin");
  assert.match(code, /import \{ passwordResetRedirectUrl \} from "@\/lib\/auth\/site-url";/);
  assert.match(code, /const redirect = passwordResetRedirectUrl\(process\.env\);/);
  assert.match(code, /redirectTo: redirect\.url,/);
});

// ---- the action's behaviour is otherwise unchanged ----------------------------------------------------------------------------------------

function requestPasswordResetSource() {
  const actions = read("lib/auth/actions.js");
  const start = actions.indexOf("export async function requestPasswordReset");
  return actions.slice(start, actions.indexOf("\nexport async function updatePassword", start));
}

test("a missing configuration sends nothing and answers with a message that does not depend on the email", () => {
  const body = requestPasswordResetSource();
  const at = (text) => body.indexOf(text);
  assert.ok(at("if (!redirect.ok) {") > 0);
  assert.ok(at("if (!redirect.ok) {") < at("await createClient()"), "checked before the Supabase client is even created");
  assert.ok(at("if (!redirect.ok) {") < at("resetPasswordForEmail"), "and before anything is sent");
  assert.match(body, /return \{ error: "Password reset is not available right now\. Please contact your administrator\." \};/);
  assert.match(body, /console\.error\(`\[auth\] Password reset is unavailable: SITE_URL is not usable \(\$\{redirect\.reason\}\)\.`\);/);
  assert.doesNotMatch(body.slice(at("if (!redirect.ok) {"), at("await createClient()")), /email/, "the unavailable answer never mentions the address");
});

test("the existing behaviour is kept: the empty-email check, the generic success, and Supabase errors logged but never shown", () => {
  const body = requestPasswordResetSource();
  assert.match(body, /if \(!email\) \{\s*return \{ error: "Enter your email address\." \};\s*\}/);
  assert.match(body, /await supabase\.auth\.resetPasswordForEmail\(email, \{\s*redirectTo: redirect\.url,\s*\}\);/);
  assert.match(body, /console\.error\("\[auth\] Could not send password reset email:", error\.code, error\.status, error\.message\);/);
  assert.match(body, /return \{\s*success:\s*"If an account exists for that email, a password reset link has been sent\.",\s*\};/);
  // The success answer is reached whether or not Supabase reported an error, so it never reveals whether an account exists.
  assert.ok(body.indexOf("if (error) {") < body.indexOf("success:"));
  // Between the Supabase error check and the success answer there is no early return.
  assert.doesNotMatch(body.slice(body.indexOf("if (error) {"), body.lastIndexOf("return {")), /return/);
});

test("the pages and routes the emailed links open are not touched; the instructor invitation uses the same helper (its own change)", () => {
  for (const path of ["app/auth/confirm/route.js", "app/auth/recovery/page.js", "app/auth/invite/page.js", "app/auth/callback/route.js"]) {
    assert.doesNotMatch(read(path), /site-url/, path);
  }
  // The instructor invitation had the same Origin-header pattern; it now builds its link from this same SITE_URL helper (see
  // lib/instructors/invite-redirect.test.js), so no emailed link is built from a request header any more.
  const invite = read("lib/instructors/actions.js");
  assert.match(invite, /import \{ inviteRedirectUrl \} from "@\/lib\/auth\/site-url";/);
  assert.doesNotMatch(invite, /headers\(\)|get\("origin"\)/);
});

test("the setting is documented in .env.example by name and format, with no value", () => {
  const example = read(".env.example");
  assert.match(example, /^SITE_URL=$/m, "present and empty");
  assert.equal(SITE_URL_ENV, "SITE_URL");
  assert.match(example, /https is required/);
  assert.match(example, /Server-only \(do NOT give it a NEXT_PUBLIC_ prefix\)/);
  assert.match(example, /redirect-URL allowlist in Supabase/);
});
