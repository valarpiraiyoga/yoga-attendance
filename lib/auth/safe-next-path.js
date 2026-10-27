/**
 * Where an auth link may send the person after it has done its job: only a path inside this app, never another site. Pure (no imports), so
 * `npm test` loads it.
 *
 * The rules are the ones `/auth/confirm`, `/auth/recovery` and `/auth/invite` already apply to their `next` parameter: it must start with a
 * single `/`, and may not be protocol-relative (`//host`), hold a backslash (browsers treat `\` as `/`) or a `://`. Two things are added for
 * the legacy `/auth/callback`, which builds its redirect by putting the site's origin in front of `next`:
 *
 *   - control characters (tab, line breaks, ...) are refused: browsers strip them from a URL, so `/<tab>/host` would become `//host`;
 *   - the result is resolved against the site origin and must still be on it (`sameOriginRedirect`), as a last check on the whole URL.
 *
 * Without the leading-slash rule, `origin + next` is a way off the site: `https://app.example` + `@evil.example` is the host `evil.example`.
 */

/**
 * `next` if it is a safe in-app path, else `fallback`.
 *
 * @param {unknown} next - the raw `next` query parameter (null when absent).
 * @param {string} [fallback] - an in-app path used when `next` is absent or unsafe.
 * @returns {string}
 */
export function safeNextPath(next, fallback = "/") {
  if (typeof next !== "string" || !next.startsWith("/")) return fallback;
  if (next.startsWith("//") || next.includes("\\") || next.includes("://")) return fallback;
  if (/[\x00-\x1f\x7f]/.test(next)) return fallback;
  return next;
}

/**
 * The absolute URL to redirect to: `next` (made safe by `safeNextPath`) on the site `origin`. The URL is parsed and its origin compared with
 * `origin`; anything that is not on it falls back to `fallback`, so no value of `next` can produce a redirect to another host.
 *
 * @param {unknown} next
 * @param {string} origin - the site's own origin, e.g. `https://app.example` (from the request URL).
 * @param {string} [fallback]
 * @returns {string}
 */
export function sameOriginRedirect(next, origin, fallback = "/") {
  const siteOrigin = new URL(origin).origin;
  const target = new URL(safeNextPath(next, fallback), siteOrigin);
  return target.origin === siteOrigin ? target.toString() : new URL(fallback, siteOrigin).toString();
}
