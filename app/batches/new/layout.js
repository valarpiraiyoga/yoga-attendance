import Container from "@/components/layout/Container";

/**
 * Add Batch keeps the standard 1200px content container. The Batches layout
 * above no longer supplies it, because the list page draws a full-width header
 * strip outside the container.
 */
export default function NewBatchLayout({ children }) {
  return <Container>{children}</Container>;
}
