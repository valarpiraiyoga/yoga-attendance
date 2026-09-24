import Container from "@/components/layout/Container";

/**
 * Student Details and its edit / membership / enrollment steps keep the
 * standard 1200px content container. The Students layout above no longer
 * supplies it, because the list page draws a full-width header strip outside
 * the container.
 */
export default function StudentDetailsLayout({ children }) {
  return <Container>{children}</Container>;
}
