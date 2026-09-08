/**
 * Shared URL search-param helper for list pages (Instructors, Batches,
 * Students). Extracted here once a third near-identical copy
 * (`instructorsHref`/`batchesHref`) was about to be written — not created
 * speculatively ahead of a real second use.
 *
 * Builds a same-page href with `overrides` applied on top of the current
 * params: a value of `""`/`null`/`undefined` deletes that key (used to drop
 * a page number when filters change, or to strip a one-time `success` flag),
 * anything else sets it.
 */
export function buildListHref(basePath, currentParams, overrides) {
  const params = new URLSearchParams(currentParams);

  for (const [key, value] of Object.entries(overrides)) {
    if (value === null || value === undefined || value === "") {
      params.delete(key);
    } else {
      params.set(key, String(value));
    }
  }

  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}
