import Container from "@/components/layout/Container";

/**
 * The session-detail routes (`[date]`, its edit / review steps) keep the
 * standard 1200px content container. The Attendance History layout above no
 * longer supplies it, because the list page draws a full-width header strip
 * outside the container.
 */
export default function AttendanceHistorySessionLayout({ children }) {
  return <Container>{children}</Container>;
}
