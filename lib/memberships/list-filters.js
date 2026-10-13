/**
 * The Plan filter of the Memberships list (V1 Fee Structure, FS-6). Two URL params serve one control:
 *   - `plan`    - a legacy plan (monthly ... class_count), matched on the membership's own `plan` column, exactly as before;
 *   - `package` - a package id, matched on `package_id`, so only memberships bought from THAT package are listed. A legacy
 *     membership with the same duration plan has no package and is never matched.
 * The control's value is "all", a plan, or "package:<id>". Pure and relative-import only, so it is tested without a server.
 */

export const PLAN_VALUES = Object.freeze(["monthly", "quarterly", "half_yearly", "annual", "custom", "class_count"]);

const PACKAGE_PREFIX = "package:";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The package id of a URL param, or "" when it is missing or not an id (so an invented value filters nothing). */
export function parsePackageFilter(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return UUID_PATTERN.test(text) ? text.toLowerCase() : "";
}

/** The control's value for the applied URL filters: a package wins over a plan (the control chooses one). */
export function planFilterValue({ plan = "all", packageId = "" } = {}) {
  return packageId ? `${PACKAGE_PREFIX}${packageId}` : plan;
}

/**
 * The URL params a chosen control value stands for: exactly one of `plan` and `package`, or neither for "all".
 *
 * @returns {{ plan: string|null, package: string|null }}
 */
export function planFilterParams(value) {
  if (typeof value === "string" && value.startsWith(PACKAGE_PREFIX)) {
    const packageId = parsePackageFilter(value.slice(PACKAGE_PREFIX.length));
    return { plan: null, package: packageId || null };
  }
  return { plan: PLAN_VALUES.includes(value) ? value : null, package: null };
}

/**
 * Applies the Plan filter to a membership query: a legacy plan filters on `plan` (unchanged), a package on `package_id`.
 *
 * @param {{ eq: (column: string, value: string) => unknown }} query
 * @param {{ plan?: string, packageId?: string }} filters
 */
export function applyPlanFilter(query, { plan = "all", packageId = "" } = {}) {
  let next = query;
  if (plan !== "all") next = next.eq("plan", plan);
  if (packageId) next = next.eq("package_id", packageId);
  return next;
}
