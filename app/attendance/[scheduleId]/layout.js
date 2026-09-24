import Container from "@/components/layout/Container";

/**
 * The session routes (Session Details and its Take / Edit steps) keep the
 * standard 1200px content container. The Attendance layout above no longer
 * supplies it, because the list page draws a full-width header strip outside
 * the container.
 */
export default function AttendanceSessionLayout({ children }) {
  return <Container>{children}</Container>;
}
