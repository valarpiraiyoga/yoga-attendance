import Container from "@/components/layout/Container";

/**
 * Add Membership (and its student-selection step) keeps the standard 1200px
 * content container. The Memberships layout above no longer supplies it,
 * because the list page draws a full-width header strip outside the container.
 */
export default function NewMembershipLayout({ children }) {
  return <Container>{children}</Container>;
}
