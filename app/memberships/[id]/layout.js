/**
 * Membership Details and its edit / renew / receipt steps draw the compact page strip full-width, so
 * they must sit directly in the shell's `<main>`: this layout adds no container of its
 * own. Each page sets its own content width (a centred `max-w-*` form, or a `Container`
 * around a detail page's body).
 */
export default function MembershipDetailsLayout({ children }) {
  return children;
}
