// Run with `npm test` (Node's built-in test runner).
//
// The instructor invitation ("Provide Login Access") built its email link from the request's `Origin` header - and, when that header was
// absent, sent the invitation with no redirect at all. It now uses the trusted `SITE_URL` (lib/auth/site-url.js, the same helper as the
// password-reset link) and sends nothing without a valid one.
//
// `provideLoginAccess` itself needs Next and Supabase to load, so these tests take the REAL function's source text and run it with stubbed
// dependencies (the Admin check, the two Supabase clients, `revalidatePath`) and the REAL `inviteRedirectUrl`. No request is made and no
// email is sent. The wiring around it is checked as source.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inviteRedirectUrl, passwordResetRedirectUrl } from "../auth/site-url.js";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const ACTIONS = read("lib/instructors/actions.js");

const INSTRUCTOR = { id: "i-1", full_name: "Asha Rao", email: "asha@example.com", status: "active", user_id: null };
const INVITE_URL = "https://yoga.example.com/auth/invite?next=/reset-password";

// ---- the real function, with stand-ins for what it calls -------------------------------------------------------------------------------

function loadProvideLoginAccess() {
  const start = ACTIONS.indexOf("export async function provideLoginAccess(");
  const end = ACTIONS.indexOf("\n}\n", start) + 3;
  assert.ok(start > 0 && end > start, "found the function");
  const text = ACTIONS.slice(start, end).replace("export async function", "async function");
  return new Function(
    "deps",
    `const { requireRole, ROLES, createClient, createAdminClient, inviteRedirectUrl, revalidatePath, INSTRUCTORS_PATH, headers } = deps; return (${text});`
  );
}
const build = loadProvideLoginAccess();

/** Runs the function once with `instructor` found in the database; returns what happened. */
async function run({ env = {}, instructor = INSTRUCTOR, requireRole, inviteResult, forgedOrigin = "https://evil.example" } = {}) {
  const log = { adminClientMade: 0, invites: [], updates: [], reads: 0, headerReads: 0, errors: [], revalidated: [], roleChecks: 0 };

  const builder = (mode) => {
    const b = {
      select: () => b,
      eq: () => b,
      is: () => b,
      update: (values) => {
        log.updates.push(values);
        return builder("update");
      },
      maybeSingle: async () => {
        log.reads += 1;
        return { data: instructor, error: null };
      },
      then: (resolve) => resolve({ data: mode === "update" ? [{ id: INSTRUCTOR.id }] : null, error: null }),
    };
    return b;
  };

  const deps = {
    requireRole: requireRole ?? (async () => (log.roleChecks += 1, { role: "admin" })),
    ROLES: { ADMIN: "admin" },
    createClient: async () => ({ from: () => builder("read") }),
    createAdminClient: () => {
      log.adminClientMade += 1;
      return {
        auth: {
          admin: {
            inviteUserByEmail: async (email, options) => {
              log.invites.push({ email, options });
              return inviteResult ?? { data: { user: { id: "auth-user-1" } }, error: null };
            },
          },
        },
      };
    },
    inviteRedirectUrl, // the real helper
    revalidatePath: (path) => log.revalidated.push(path),
    INSTRUCTORS_PATH: "/settings/instructors",
    // A request header an attacker controls. The function must never read it.
    headers: async () => (log.headerReads += 1, { get: () => forgedOrigin }),
  };

  const saved = { SITE_URL: process.env.SITE_URL, NODE_ENV: process.env.NODE_ENV };
  const savedConsoleError = console.error;
  console.error = (...args) => log.errors.push(args.join(" "));
  for (const [key, value] of Object.entries(env)) value === undefined ? delete process.env[key] : (process.env[key] = value);
  if (!("SITE_URL" in env)) delete process.env.SITE_URL;
  try {
    const result = await build(deps)(INSTRUCTOR.id, {});
    return { result, log };
  } finally {
    console.error = savedConsoleError;
    for (const [key, value] of Object.entries(saved)) value === undefined ? delete process.env[key] : (process.env[key] = value);
  }
}

// ---- a valid configuration -------------------------------------------------------------------------------------------------------------

test("with a valid SITE_URL the invitation goes out with the redirect built from it: /auth/invite?next=/reset-password", async () => {
  const { result, log } = await run({ env: { SITE_URL: "https://yoga.example.com", NODE_ENV: "production" } });
  assert.deepEqual(result, { success: "Login access invitation sent." });
  assert.equal(log.invites.length, 1);
  assert.equal(log.invites[0].email, "asha@example.com");
  assert.deepEqual(log.invites[0].options, { data: { full_name: "Asha Rao" }, redirectTo: INVITE_URL });
  assert.deepEqual(log.updates, [{ user_id: "auth-user-1" }], "the invited account is linked, as before");
  assert.deepEqual(log.revalidated, ["/settings/instructors", "/settings/instructors/i-1/edit"]);
});

test("a forged Origin header cannot influence the invitation link - the header is never read", async () => {
  for (const forgedOrigin of ["https://evil.example", "https://yoga.example.com.evil.example", "null", ""]) {
    const { log } = await run({ env: { SITE_URL: "https://yoga.example.com", NODE_ENV: "production" }, forgedOrigin });
    assert.equal(log.headerReads, 0, `Origin ${JSON.stringify(forgedOrigin)} was not read`);
    assert.equal(log.invites[0].options.redirectTo, INVITE_URL, `Origin ${JSON.stringify(forgedOrigin)} changed nothing`);
  }
});

test("the redirect is always sent: there is no longer an invitation without one", async () => {
  const { log } = await run({ env: { SITE_URL: "https://yoga.example.com", NODE_ENV: "production" } });
  assert.ok("redirectTo" in log.invites[0].options);
  assert.doesNotMatch(ACTIONS, /if \(origin\)/);
});

test("under `next dev` an unset SITE_URL uses the fixed local address; a production build does not", async () => {
  const dev = await run({ env: { NODE_ENV: "development" } });
  assert.equal(dev.log.invites[0].options.redirectTo, "http://localhost:3000/auth/invite?next=/reset-password");
  const prod = await run({ env: { NODE_ENV: "production" } });
  assert.equal(prod.log.invites.length, 0);
});

// ---- missing or invalid configuration: nothing is created or sent -------------------------------------------------------------------------------

const NOT_CONFIGURED = { error: "Login access is not configured on the server yet." };

test("a missing SITE_URL stops before the Admin client is made: no invitation, no account, no link, no revalidation", async () => {
  for (const env of [{ NODE_ENV: "production" }, { SITE_URL: "", NODE_ENV: "production" }, { SITE_URL: "   ", NODE_ENV: "production" }, { NODE_ENV: "test" }]) {
    const { result, log } = await run({ env });
    assert.deepEqual(result, NOT_CONFIGURED, JSON.stringify(env));
    assert.equal(log.adminClientMade, 0, "the Admin (secret-key) client is never created");
    assert.equal(log.invites.length, 0, "no invitation");
    assert.deepEqual(log.updates, [], "no instructor is linked");
    assert.deepEqual(log.revalidated, []);
    assert.equal(log.headerReads, 0, "and the request is not consulted for a substitute");
  }
});

test("an invalid SITE_URL is refused the same way", async () => {
  const bad = ["not a url", "http://yoga.example.com", "https://yoga.example.com/app", "https://user:pw@yoga.example.com", "ftp://yoga.example.com", "https:///yoga.example.com", "https://yoga.example.com?x=1", "javascript:alert(1)"];
  for (const SITE_URL of bad) {
    const { result, log } = await run({ env: { SITE_URL, NODE_ENV: "production" } });
    assert.deepEqual(result, NOT_CONFIGURED, SITE_URL);
    assert.equal(log.invites.length, 0, SITE_URL);
    assert.equal(log.adminClientMade, 0, SITE_URL);
  }
});

test("the reason is logged without the configured value", async () => {
  const { log } = await run({ env: { SITE_URL: "https://user:secret-pass@yoga.example.com", NODE_ENV: "production" } });
  assert.equal(log.errors.length, 1);
  assert.equal(log.errors[0], "[instructors] Invitation unavailable: SITE_URL is not usable (has-credentials).");
  assert.ok(!log.errors[0].includes("secret-pass"));
});

// ---- the rest of the flow is unchanged ----------------------------------------------------------------------------------------------------------

test("the Admin check still comes first: a non-admin changes and reads nothing", async () => {
  const denied = async () => {
    throw new Error("redirect: not an admin");
  };
  await assert.rejects(run({ env: { SITE_URL: "https://yoga.example.com", NODE_ENV: "production" }, requireRole: denied }), /not an admin/);
});

test("the instructor checks keep their messages and come before the configuration check", async () => {
  const env = { SITE_URL: "https://yoga.example.com", NODE_ENV: "production" };
  assert.deepEqual((await run({ env, instructor: { ...INSTRUCTOR, user_id: "u-9" } })).result, { error: "This instructor already has login access." });
  assert.deepEqual((await run({ env, instructor: { ...INSTRUCTOR, status: "inactive" } })).result, { error: "Activate this instructor before providing login access." });
  assert.deepEqual((await run({ env, instructor: { ...INSTRUCTOR, email: null } })).result, { error: "Add an email address for this instructor before providing login access." });
  assert.deepEqual((await run({ env, instructor: null })).result, { error: "That instructor no longer exists." });
  // With no SITE_URL these still answer first, so an instructor's own problem is not hidden behind a server-configuration message.
  assert.deepEqual((await run({ env: { NODE_ENV: "production" }, instructor: { ...INSTRUCTOR, user_id: "u-9" } })).result, { error: "This instructor already has login access." });
});

test("Auth's own refusals keep their messages: an existing account, or any other failure", async () => {
  const env = { SITE_URL: "https://yoga.example.com", NODE_ENV: "production" };
  const exists = await run({ env, inviteResult: { data: null, error: { code: "email_exists", message: "x" } } });
  assert.match(exists.result.error, /^An account already exists for that email address\./);
  assert.deepEqual(exists.log.updates, [], "nothing is linked after a refusal");
  const other = await run({ env, inviteResult: { data: null, error: { code: "unexpected_failure", message: "boom" } } });
  assert.deepEqual(other.result, { error: "Could not send the invitation. Try again." });
});

// ---- the wiring and the scope -------------------------------------------------------------------------------------------------------------------

test("the invitation reuses the shared helper; no second URL validator and no Origin header remain in the action", () => {
  const code = ACTIONS.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.match(code, /import \{ inviteRedirectUrl \} from "@\/lib\/auth\/site-url";/);
  assert.doesNotMatch(code, /next\/headers|headers\(\)|get\("origin"\)|\$\{origin\}/);
  assert.doesNotMatch(code, /new URL\(|process\.env\.SITE_URL|resolveSiteUrl/, "validation lives only in lib/auth/site-url.js (the log message may name the setting)");
  const helper = read("lib/auth/site-url.js");
  assert.equal((helper.match(/export function resolveSiteUrl/g) ?? []).length, 1, "one validator");
  assert.match(helper, /export function inviteRedirectUrl\(env\) \{\s*const site = resolveSiteUrl\(env\);/);
});

test("the check runs before the Admin client and the Auth call, inside provideLoginAccess only", () => {
  const start = ACTIONS.indexOf("export async function provideLoginAccess(");
  const body = ACTIONS.slice(start, ACTIONS.indexOf("\n}\n", start));
  const at = (text) => body.indexOf(text);
  assert.ok(at("await requireRole(ROLES.ADMIN)") < at("inviteRedirectUrl(process.env)"));
  assert.ok(at("inviteRedirectUrl(process.env)") < at("createAdminClient()"));
  assert.ok(at("createAdminClient()") < at("inviteUserByEmail("));
  assert.equal((ACTIONS.match(/inviteRedirectUrl\(process\.env\)/g) ?? []).length, 1);
  // The temporary-password flows do not send an email link and are not part of this change.
  for (const name of ["provideTemporaryLoginAccess", "resetInstructorPassword"]) {
    const at2 = ACTIONS.indexOf(`export async function ${name}(`);
    assert.ok(at2 > 0, name);
    assert.doesNotMatch(ACTIONS.slice(at2, ACTIONS.indexOf("\n}\n", at2)), /inviteRedirectUrl|site-url|redirectTo/, name);
  }
});

test("the expected URLs: the invitation and the password reset share SITE_URL and differ only in their route", () => {
  const env = { SITE_URL: "https://yoga.example.com/", NODE_ENV: "production" };
  assert.deepEqual(inviteRedirectUrl(env), { ok: true, url: INVITE_URL });
  assert.deepEqual(passwordResetRedirectUrl(env), { ok: true, url: "https://yoga.example.com/auth/recovery?next=/reset-password" });
  const parsed = new URL(INVITE_URL);
  assert.equal(parsed.pathname, "/auth/invite");
  assert.equal(parsed.searchParams.get("next"), "/reset-password");
  assert.ok(INVITE_URL.endsWith("/auth/invite?next=/reset-password"), "the slash in next is not percent-encoded, as it always was");
  // The page the link opens still exists and still validates `next` itself.
  assert.ok(read("app/auth/invite/page.js").includes("function safeNextPath"));
  assert.deepEqual(inviteRedirectUrl({ NODE_ENV: "production" }), { ok: false, reason: "not-set" });
  assert.deepEqual(inviteRedirectUrl({ SITE_URL: "http://yoga.example.com", NODE_ENV: "production" }), { ok: false, reason: "insecure" });
});

test(".env.example says the instructor invitation uses SITE_URL too, and the invite address belongs on the allowlist", () => {
  const example = read(".env.example");
  assert.match(example, /instructor invitation email/);
  assert.match(example, /<SITE_URL>\/auth\/recovery and <SITE_URL>\/auth\/invite/);
  assert.match(example, /^SITE_URL=$/m, "still no value");
});
