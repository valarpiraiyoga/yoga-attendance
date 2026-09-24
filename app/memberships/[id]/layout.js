import Container from "@/components/layout/Container";

/**
 * Membership Details and its edit / renew / receipt steps keep the standard
 * 1200px content container. The Memberships layout above no longer supplies
 * it, because the list page draws a full-width header strip outside the
 * container.
 */
export default function MembershipDetailsLayout({ children }) {
  return <Container>{children}</Container>;
}
