import AppShell from "@/components/layout/AppShell";
import { requireRole, ROLES } from "@/lib/auth/dal";

/**
 * Shared Attendance History shell: auth boundary + shared page chrome.
 * No `Container` here: the list page's full-bleed header strip must be a direct
 * child of the shell's `<main>`, so each page wraps its own body in `Container`
 * (the detail routes do so in `[scheduleId]/layout.js`).
 * Mirrors app/attendance/layout.js exactly, including which roles may
 * enter — Attendance History is approved IA for both (`01-product.md` §9:
 * "Allow Admin and Instructors to review attendance"; `02-ux.md`'s
 * Role-Based IA already lists it under Instructor).
 *
 * As with Attendance itself, entering here grants no data by itself: which
 * sessions an instructor's own Attendance History query returns is decided
 * entirely by RLS (`class_sessions_select_instructor`,
 * `attendance_select_instructor`, `0014_instructor_attendance_access.sql`),
 * not by anything this layout or its pages check in JavaScript.
 *
 * This layout's own `requireRole` only builds the shell for the initial
 * request — it does not re-run on client-side navigation between sibling
 * pages (see app/settings/layout.js for the full explanation). Every page
 * under /attendance-history must call `requireRole` again itself.
 */
export default async function AttendanceHistoryLayout({ children }) {
  const user = await requireRole(ROLES.ADMIN, ROLES.INSTRUCTOR);

  return (
    <AppShell role={user.role} user={user} mobileTitle="Attendance History">
      {children}
    </AppShell>
  );
}
