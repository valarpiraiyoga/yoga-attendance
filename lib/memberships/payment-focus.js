/**
 * "Record Payment" deep link: the Memberships list menu opens Membership Details with `?focus=payments`, and the page scrolls its Payments
 * section into view once (then removes the parameter, so a reload or a copied link does not jump again). A plain visit has no parameter and
 * is unchanged. The section's element id and the parameter value are defined here once.
 */
export const PAYMENTS_FOCUS = "payments";
export const PAYMENTS_SECTION_ID = "membership-payments";

/** The Membership Details URL that scrolls to the Payments section (and so to Record Payment). */
export function recordPaymentHref(membershipId) {
  return `/memberships/${membershipId}?focus=${PAYMENTS_FOCUS}`;
}

/**
 * The scrollTop that puts `target` just below whatever sticky header covers the top of the scroll container.
 *
 * @param {{ targetTop: number, containerTop: number, scrollTop: number, headerBottom: number, gap?: number }} measure - viewport coordinates;
 *   `headerBottom` is the sticky header's visible bottom edge (0 when there is none, e.g. below `sm` where it does not stick).
 */
export function scrollTopBelowHeader({ targetTop, containerTop, scrollTop, headerBottom, gap = 16 }) {
  const covered = Math.max(headerBottom, containerTop);
  return Math.max(0, scrollTop + (targetTop - covered) - gap);
}
