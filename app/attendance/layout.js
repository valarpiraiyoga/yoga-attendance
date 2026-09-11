import AppShell from "@/components/layout/AppShell";
import Container from "@/components/layout/Container";
import { requireRole, ROLES } from "@/lib/auth/dal";

/**
 * Shared Attendance shell: auth boundary + shared page chrome. Mirrors
 * app/schedule/layout.js, except for who may enter: Attendance is the one
 * feature area both roles reach (01-product.md §8 "Purpose": "Allow
 * instructors and administrators to quickly record and maintain
 * attendance"; 02-ux.md Flow 01), matching the primary nav, which has
 * always shown "Attendance" to both (app/data/navigation.js).
 *
 * Letting an instructor in here grants no data by itself. Which sessions,
 * students and marks they can actually see or write is decided entirely by
 * RLS and the SECURITY DEFINER functions from
 * 0014_instructor_attendance_access.sql — an instructor with no assigned
 * sessions, or one whose instructor record is inactive
 * (`current_instructor_id()` returns null), reaches these pages and finds
 * them empty rather than being handed anything.
 *
 * Session *management* is not part of that: Edit This Session (Flow 06)
 * and Mark Cancelled/Holiday (Flow 07) stay admin-only, gated on their own
 * routes and inside their own actions.
 *
 * This layout's own `requireRole` only builds the shell for the initial
 * request — it does not re-run on client-side navigation between sibling
 * pages (see app/settings/layout.js for the full explanation). Every page
 * under /attendance must call `requireRole` again itself.
 */
export default async function AttendanceLayout({ children }) {
  const user = await requireRole(ROLES.ADMIN, ROLES.INSTRUCTOR);

  return (
    <AppShell role={user.role} user={user}>
      <Container>{children}</Container>
    </AppShell>
  );
}
