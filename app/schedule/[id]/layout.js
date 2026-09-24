import Container from "@/components/layout/Container";

/**
 * Schedule Details (and its edit step) keep the standard 1200px content
 * container. The Schedule layout above no longer supplies it, because the
 * list page draws a full-width header strip outside the container.
 */
export default function ScheduleDetailsLayout({ children }) {
  return <Container>{children}</Container>;
}
