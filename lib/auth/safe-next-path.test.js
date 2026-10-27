// Run with `npm test` (Node's built-in test runner).
//
// Audit finding F-01: the legacy /auth/callback built its redirect as `${origin}${next}` from an unchecked `next` query parameter, so a
// value that does not start with "/" (`@evil.example`, `.evil.example`, `:8080@evil.example`) moved the host and sent the person to another
// site after signing in. The route now goes through `sameOriginRedirect`. The helpers are run for real; the route (which needs Next and
// Supabase to load) is checked as source, and has not been exercised at runtime.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { safeNextPath, sameOriginRedirect } from "./safe-next-path.js";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const ORIGIN = "https://app.example";
const char = (codePoint) => String.fromCodePoint(codePoint);

// ---- ordinary in-app paths keep working -------------------------------------------------------------------------------------------------

test("normal internal paths are kept as they are", () => {
  for (const path of ["/", "/reset-password", "/students", "/students/abc-123/edit", "/memberships?status=active&page=2", "/reports#top", "/a/b/c?x=%2Fy", "/%2F/evil.example", "/?next=/x"]) {
    assert.equal(safeNextPath(path), path, path);
  }
});

test("a missing or empty next falls back to the default (the site root, or the caller's own default)", () => {
  for (const missing of [null, undefined, ""]) {
    assert.equal(safeNextPath(missing), "/");
    assert.equal(safeNextPath(missing, "/reset-password"), "/reset-password");
  }
});

// ---- everything that could leave the site is refused --------------------------------------------------------------------------------------

test("external and scheme URLs fall back", () => {
  for (const url of ["https://evil.example", "http://evil.example/x", "ftp://evil.example", "javascript:alert(1)", "data:text/html,<b>x</b>", "mailto:a@b.example", "evil.example", "www.evil.example/login"]) {
    assert.equal(safeNextPath(url), "/", url);
  }
});

test("protocol-relative URLs fall back", () => {
  for (const url of ["//evil.example", "//evil.example/x", "///evil.example", "////evil.example", "//"]) {
    assert.equal(safeNextPath(url), "/", url);
  }
});

test("userinfo and host-prefix tricks - the actual hole in `origin + next` - fall back", () => {
  for (const url of ["@evil.example", ":8080@evil.example", "user:pass@evil.example", ".evil.example", "-evil.example", "#@evil.example", "?x=@evil.example"]) {
    assert.equal(safeNextPath(url), "/", url);
  }
});

test("backslashes (which browsers read as slashes) fall back", () => {
  for (const url of ["/\\evil.example", "\\\\evil.example", "/\\/evil.example", "/path\\to"]) {
    assert.equal(safeNextPath(url), "/", url);
  }
});

test("control characters, which browsers strip from a URL, fall back: /<tab>/host would become //host", () => {
  for (const url of ["/\t/evil.example", "/\n/evil.example", "/\r/evil.example", "/\u0000/x", "/x\u001f", `/${char(0x7f)}`, "/ok\nSet-Cookie: a=b"]) {
    assert.equal(safeNextPath(url), "/", JSON.stringify(url));
  }
});

test("percent-encoded and Unicode look-alikes that do not start with an ASCII slash fall back", () => {
  for (const url of ["%2F%2Fevil.example", "%2Fevil.example", `${char(0xff0f)}evil.example`, `${char(0xff0f)}${char(0xff0f)}evil.example`, ` /x`, "\u00a0/x"]) {
    assert.equal(safeNextPath(url), "/", JSON.stringify(url));
  }
});

test("malformed, non-string and odd inputs fall back and never throw", () => {
  for (const value of [42, 0, true, false, {}, [], ["/ok"], ["//evil.example"], () => "/x", Symbol.iterator.description, NaN, 1n]) {
    assert.doesNotThrow(() => safeNextPath(value));
    assert.equal(safeNextPath(value), "/", String(typeof value));
  }
  assert.equal(safeNextPath("/" + "a".repeat(10000)).length, 10001, "a long path is not mangled");
});

// ---- the whole redirect stays on the site -------------------------------------------------------------------------------------------------

test("sameOriginRedirect returns an absolute URL on the site for a good path, with its query and fragment", () => {
  assert.equal(sameOriginRedirect("/", ORIGIN), `${ORIGIN}/`);
  assert.equal(sameOriginRedirect("/reset-password", ORIGIN), `${ORIGIN}/reset-password`);
  assert.equal(sameOriginRedirect("/memberships?status=active#top", ORIGIN), `${ORIGIN}/memberships?status=active#top`);
  assert.equal(sameOriginRedirect(null, ORIGIN), `${ORIGIN}/`, "the callback's old default when next is absent");
  assert.equal(sameOriginRedirect("http://localhost:3000/x", "http://localhost:3000"), "http://localhost:3000/", "a full URL in next is still refused");
  assert.equal(sameOriginRedirect("/students", "http://localhost:3000"), "http://localhost:3000/students", "a port in the origin is kept");
});

test("no value of next, however hostile, can produce a redirect to another host", () => {
  const hostile = [
    "@evil.example", ":8080@evil.example", ".evil.example", "https://evil.example", "//evil.example", "///evil.example", "/\\evil.example",
    "\\\\evil.example", "/\t/evil.example", "javascript:alert(1)", "%2F%2Fevil.example", `${char(0xff0f)}evil.example`, "evil.example",
    "/@evil.example", "/..//evil.example", "/%5Cevil.example", "/.%2e//evil.example", "/;@evil.example", "/?@evil.example", "/#@evil.example",
    null, undefined, "", 7, {}, [],
  ];
  for (const origin of [ORIGIN, "http://localhost:3000", "https://yoga.example.org"]) {
    for (const next of hostile) {
      const target = new URL(sameOriginRedirect(next, origin));
      assert.equal(target.origin, new URL(origin).origin, `${JSON.stringify(next)} on ${origin}`);
      assert.equal(target.username, "", "no credentials in the URL");
    }
  }
});

test("the unsafe inputs go to the fallback, not an error page: the site root by default", () => {
  assert.equal(sameOriginRedirect("@evil.example", ORIGIN), `${ORIGIN}/`);
  assert.equal(sameOriginRedirect("//evil.example", ORIGIN), `${ORIGIN}/`);
  assert.equal(sameOriginRedirect("@evil.example", ORIGIN, "/login"), `${ORIGIN}/login`);
});

// ---- the existing copies' rule is kept ------------------------------------------------------------------------------------------------------

test("it applies the same rule as /auth/confirm's own safeNextPath on every input that has no control character", () => {
  const source = read("app/auth/confirm/route.js");
  const body = source.slice(source.indexOf("function safeNextPath"), source.indexOf("\n}\n", source.indexOf("function safeNextPath")) + 3);
  const existing = new Function(`${body}; return safeNextPath;`)();
  const corpus = ["/", "/a", "/a?b=c", "//x", "///x", "@x", ".x", "x", "", "https://x", "/\\x", "\\x", "/a://b", "/a/b://c", "%2Fx", " /x", "/ x", "/%2Fx", "mailto:x", "/:x", "//", "/@x", "/x#//y"];
  for (const next of corpus) assert.equal(safeNextPath(next, "/"), existing(next), JSON.stringify(next));
  for (const notAString of [null, undefined, 1, {}, []]) assert.equal(safeNextPath(notAString, "/"), existing(notAString));
});

// ---- the route ----------------------------------------------------------------------------------------------------------------------------

test("the callback route redirects through sameOriginRedirect and no longer joins origin and next itself", () => {
  const route = read("app/auth/callback/route.js").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(route, /import \{ sameOriginRedirect \} from "@\/lib\/auth\/safe-next-path";/);
  assert.match(route, /NextResponse\.redirect\(sameOriginRedirect\(next, origin\)\)/);
  assert.doesNotMatch(route, /\$\{origin\}\$\{next\}/, "the unchecked concatenation is gone");
  assert.doesNotMatch(route, /searchParams\.get\("next"\) \|\| "\/"/, "next is read raw and checked by the helper, not defaulted inline");
});

test("the code exchange and the failure path of the callback are unchanged", () => {
  const route = read("app/auth/callback/route.js");
  assert.ok(route.includes('const code = searchParams.get("code");'));
  assert.ok(route.includes("await supabase.auth.exchangeCodeForSession(code)"));
  assert.ok(route.includes("if (!error) {"));
  assert.ok(route.includes("`${origin}/login?error=Invalid or expired reset link`"));
  // A redirect only follows a successful exchange.
  assert.ok(route.indexOf("exchangeCodeForSession") < route.indexOf("sameOriginRedirect(next, origin)"));
});

test("the helper is pure, and the other auth flows are not touched by this fix", () => {
  assert.doesNotMatch(read("lib/auth/safe-next-path.js"), /^import\s/m);
  for (const path of ["app/auth/confirm/route.js", "app/auth/recovery/page.js", "app/auth/invite/page.js", "lib/auth/actions.js"]) {
    assert.doesNotMatch(read(path), /safe-next-path/, `${path} keeps its own code`);
  }
});
