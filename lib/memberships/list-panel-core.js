/**
 * Membership Details → the left Memberships list - the pure half: what each card says about its plan, and the search and the
 * Status / Plan filters over the student's memberships. No React, no Supabase; tested without a server.
 *
 * The label maps (MEMBERSHIP_STATUS and PLAN in lib/status.js) are passed in, so this file imports nothing.
 *
 * It works on the memberships the page has ALREADY loaded (`listMembershipsForStudent`), each with its derived status; nothing is
 * read again, and filtering only narrows what is shown - it never changes a membership or its status.
 */

export const ALL = "all";

/** The status filter's options: All Status, then each membership status (MEMBERSHIP_STATUS). */
export function statusOptions(statuses) {
  return [{ value: ALL, label: "All Status" }, ...Object.entries(statuses).map(([value, { label }]) => ({ value, label }))];
}

/**
 * What a card shows beneath the membership number: the package it was sold under ("Hatha Yoga - 5 days"), else the plan
 * ("Monthly"), and a class-count membership its class total. Only what the record holds.
 */
export function membershipPlanLine(membership, plans) {
  if (membership.package_name) return membership.package_name;
  if (membership.kind === "class_count" && membership.total_classes) {
    return `${plans.class_count} · ${membership.total_classes} ${membership.total_classes === 1 ? "class" : "classes"}`;
  }
  return plans[membership.plan] ?? membership.plan ?? "";
}

/** The plan filter's options: All Plans, then each plan the student's memberships actually use (in the app's plan order). */
export function planOptions(memberships, plans) {
  const used = new Set((memberships ?? []).map((membership) => membership.plan));
  return [{ value: ALL, label: "All Plans" }, ...Object.entries(plans).filter(([value]) => used.has(value)).map(([value, label]) => ({ value, label }))];
}

/**
 * The selected membership's neighbours in the list's own order (no ordering of its own): the one before it and the one after. At
 * either end there is none on that side; a single membership has neither; a selection that is not in the list has no position.
 *
 * @returns {{ index: number, previous: object|null, next: object|null }}
 */
export function neighboursOf(memberships, selectedId) {
  const list = memberships ?? [];
  const index = list.findIndex((entry) => entry.id === selectedId);
  if (index < 0) return { index: -1, previous: null, next: null };
  return { index, previous: index > 0 ? list[index - 1] : null, next: index < list.length - 1 ? list[index + 1] : null };
}

/** The dots to show: every membership, or `max` of them in a window around the selected one (never past either end). */
export function dotWindow(count, index, max = 7) {
  if (count <= max) return { from: 0, to: count };
  const from = Math.min(Math.max(0, index - Math.floor(max / 2)), count - max);
  return { from, to: from + max };
}

/** How many of the Status / Plan filters are applied (the search is not counted: it has its own clear button). */
export function activeFilterCount({ status = ALL, plan = ALL } = {}) {
  return [status, plan].filter((value) => value !== ALL).length;
}

/**
 * The memberships that match, in the order given. The search is a case-insensitive substring of the membership number, the
 * plan line or the plan's name ("monthly" finds a Monthly membership sold under a package named otherwise); the filters are exact.
 *
 * @param {object[]} memberships
 * @param {{ q?: string, status?: string, plan?: string }} filters
 * @param {Record<string, string>} plans - the plan labels (PLAN).
 */
export function filterMemberships(memberships, { q = "", status = ALL, plan = ALL } = {}, plans = {}) {
  const needle = String(q ?? "").trim().toLowerCase();
  return (memberships ?? []).filter((membership) => {
    if (status !== ALL && membership.status !== status) return false;
    if (plan !== ALL && membership.plan !== plan) return false;
    if (!needle) return true;
    const haystack = [membership.membership_code, membershipPlanLine(membership, plans), plans[membership.plan]].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(needle);
  });
}
