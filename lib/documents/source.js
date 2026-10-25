/**
 * Where a document page was opened from. A document lives under /memberships/[id]/..., so by its address alone it reads as part of
 * Memberships - but opened from the Documents list it belongs to Documents: the sidebar highlights Documents and Back returns to the
 * list. The Documents list marks the links it draws with `?from=documents`; the document pages (and the navigation) read the marker.
 * A document opened from anywhere else (a membership's own pages) has no marker and stays under Memberships, as before.
 * Pure - no imports, so `npm test` loads it.
 */
export const FROM_PARAM = "from";
export const FROM_DOCUMENTS = "documents";

/** `href` with the Documents marker added (before any #fragment). */
export function withDocumentsSource(href) {
  const [path, fragment] = String(href).split("#");
  const joined = `${path}${path.includes("?") ? "&" : "?"}${FROM_PARAM}=${FROM_DOCUMENTS}`;
  return fragment ? `${joined}#${fragment}` : joined;
}

/** Whether the page's search params (an object, or a URLSearchParams-like with `get`) carry the Documents marker. */
export function cameFromDocuments(params) {
  const value = typeof params?.get === "function" ? params.get(FROM_PARAM) : params?.[FROM_PARAM];
  return value === FROM_DOCUMENTS;
}

/** The back button of a document page: to the Documents list when it was opened from there, else to `fallback` ({ href, label }). */
export function documentBack(params, fallback) {
  return cameFromDocuments(params) ? { href: "/documents", label: "Back to Documents" } : fallback;
}

/** `href` carrying the marker forward when this page was opened from Documents (Correct Document and its Back). */
export function keepDocumentsSource(params, href) {
  return cameFromDocuments(params) ? withDocumentsSource(href) : href;
}

/**
 * The nav item the current address highlights: `Documents` for a membership-area document page opened from the Documents list, otherwise
 * the item whose route the path is under.
 *
 * @param {string} pathname
 * @param {string} href - one nav item's route.
 * @param {{ get?: Function }|object|null} params - the search params.
 */
export function isNavItemActive(pathname, href, params) {
  if (cameFromDocuments(params) && (pathname === "/memberships" || pathname.startsWith("/memberships/"))) {
    return href === "/documents";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
