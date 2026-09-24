import Container from "@/components/layout/Container";

/**
 * Batch Details and its tabs / edit step keep the standard 1200px content
 * container. The Batches layout above no longer supplies it, because the list
 * page draws a full-width header strip outside the container.
 */
export default function BatchDetailsLayout({ children }) {
  return <Container>{children}</Container>;
}
