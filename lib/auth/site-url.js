/**
 * The application's own public address, from configuration - never from the incoming request. Pure (it is given the environment), so
 * `npm test` loads it.
 *
 * Why: a link that the application puts in an email (the password-reset link) must lead to THIS application. Building it from the request's
 * `Origin` header lets whoever makes the request choose where the link points, so the address comes from the `SITE_URL` setting instead.
 * (Supabase also checks the link against its own redirect-URL allowlist, but this must not depend on that being set up correctly.)
 *
 * `SITE_URL` is the site's origin only: `https://yoga.example.com` - scheme and host (and a port when it is not the default), no path, query,
 * fragment or credentials. `https` is required; `http` is accepted only for a loopback host (`localhost`, `127.0.0.1`, `[::1]`) so local
 * development works. In development only (`NODE_ENV === "development"`), an unset `SITE_URL` falls back to `http://localhost:3000`. Anywhere
 * else an unset or invalid value is an error - there is no fallback to the request's host.
 *
 * The reasons returned never contain the configured value.
 */

export const SITE_URL_ENV = "SITE_URL";
export const DEV_DEFAULT_SITE_URL = "http://localhost:3000";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * @param {{ SITE_URL?: string, NODE_ENV?: string }} env - `process.env` (or a stand-in).
 * @returns {{ ok: true, origin: string } | { ok: false, reason: "not-set" | "invalid" | "insecure" | "has-credentials" | "not-an-origin" }}
 */
export function resolveSiteUrl(env) {
  const configured = typeof env?.SITE_URL === "string" ? env.SITE_URL.trim() : "";

  if (configured === "") {
    return env?.NODE_ENV === "development" ? { ok: true, origin: new URL(DEV_DEFAULT_SITE_URL).origin } : { ok: false, reason: "not-set" };
  }

  // Exactly `scheme://host`: the URL parser would quietly accept `https:///host` and a backslash after the scheme (it reads `\` as a slash), and a
  // setting that is wrong should fail visibly, not be repaired.
  if (!/^https?:\/\/[^/\x5c]/i.test(configured)) return { ok: false, reason: "invalid" };

  let url;
  try {
    url = new URL(configured);
  } catch {
    return { ok: false, reason: "invalid" };
  }

  const isHttps = url.protocol === "https:";
  const isLoopbackHttp = url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
  if (!isHttps && !isLoopbackHttp) {
    return { ok: false, reason: url.protocol === "http:" ? "insecure" : "invalid" };
  }
  if (url.username !== "" || url.password !== "") return { ok: false, reason: "has-credentials" };
  if (url.hostname === "") return { ok: false, reason: "invalid" };
  if ((url.pathname !== "/" && url.pathname !== "") || url.search !== "" || url.hash !== "") return { ok: false, reason: "not-an-origin" };

  return { ok: true, origin: url.origin };
}

/**
 * The link the password-reset email's "reset" button returns to: this site's `/auth/recovery`, which then continues to `/reset-password`.
 * The text is the same shape the action has always sent (the `/` in `next` is not percent-encoded), so Supabase's redirect allowlist
 * matches it exactly as before.
 *
 * @param {{ SITE_URL?: string, NODE_ENV?: string }} env
 * @returns {{ ok: true, url: string } | { ok: false, reason: string }}
 */
export function passwordResetRedirectUrl(env) {
  const site = resolveSiteUrl(env);
  return site.ok ? { ok: true, url: `${site.origin}/auth/recovery?next=/reset-password` } : site;
}

/**
 * The link the instructor invitation email's button returns to: this site's `/auth/invite`, which then continues to `/reset-password`
 * (the invited person chooses their own password there). Built from the same trusted `SITE_URL` as the password-reset link, never from a
 * request header, and with the same shape the invitation has always had (the `/` in `next` is not percent-encoded).
 *
 * @param {{ SITE_URL?: string, NODE_ENV?: string }} env
 * @returns {{ ok: true, url: string } | { ok: false, reason: string }}
 */
export function inviteRedirectUrl(env) {
  const site = resolveSiteUrl(env);
  return site.ok ? { ok: true, url: `${site.origin}/auth/invite?next=/reset-password` } : site;
}
