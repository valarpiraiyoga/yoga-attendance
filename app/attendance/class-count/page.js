import { ClipboardCheck } from "lucide-react";
import { requireRole, ROLES } from "@/lib/auth/dal";
import Container from "@/components/layout/Container";
import PageHeader from "@/components/layout/PageHeader";
import EmptyState from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { todayDateString } from "@/lib/memberships/data";
import { listClassCountEligible, listClassCountToRenew } from "@/lib/class-count-attendance/data";
import AttendanceViewToggle from "@/app/attendance/attendance-view-toggle";
import ClassCountList from "@/app/attendance/class-count/class-count-list";

/**
 * Class Count Attendance - the third tab of Attendance (beside Today's Sessions and All Sessions), for an Admin and for an
 * Instructor (01-product.md §8 "Class Count Attendance"; 02-ux.md "Class Count Attendance").
 *
 * A route of its own rather than a view of `app/attendance/page.js`, so the session workflow of that page is not
 * touched: this tab never reads a class session or the `attendance` table. It lists the class-count memberships a
 * class can be recorded for today (with classes used and left, and the expiry), each with Record class; and the
 * memberships whose classes are all used, each with Renew. Duration memberships never appear here, and nothing here
 * changes session attendance.
 *
 * Roles: an Admin sees every eligible class-count membership and, below it, the used-up ones with Renew. An Instructor sees only
 * the memberships of the students they are authorized for - the database (`list_class_count_eligible`, migration 0053) returns
 * nothing else and no phone number - and has no Renew (renewing is a membership action and Admin only), so the used-up list is
 * neither read nor shown. Recording is checked again in the database (`record_class_count_attendance`); this page repeats
 * `requireRole` itself because the layout does not re-run on client-side navigation.
 */
export default async function ClassCountAttendancePage() {
  const user = await requireRole(ROLES.ADMIN, ROLES.INSTRUCTOR);
  const isAdmin = user.role === ROLES.ADMIN;

  const [eligible, toRenew, today] = await Promise.all([
    listClassCountEligible(),
    isAdmin ? listClassCountToRenew() : Promise.resolve([]),
    todayDateString(),
  ]);

  return (
    <>
      <PageHeader
        compact
        title="Attendance"
        description="Record completed classes for class-count memberships."
        icon={<ClipboardCheck className="size-6" />}
      />

      <Container>
        <AttendanceViewToggle active="class-count" showClassCount />

        {eligible.length === 0 && toRenew.length === 0 ? (
          <EmptyState
            description={
              isAdmin
                ? "No class-count memberships to record. A membership appears here once it has started and has classes left."
                : "No class-count memberships to record for your students. A membership appears here once it has started and has classes left."
            }
          />
        ) : (
          <div className="flex flex-col gap-8">
            <section aria-labelledby="class-count-record-heading" className="flex flex-col gap-1">
              <h2 id="class-count-record-heading" className="flex items-center gap-2 text-body font-semibold text-text-primary">
                Ready to record
                <Badge variant="neutral">{eligible.length}</Badge>
              </h2>
              {eligible.length === 0 ? (
                <EmptyState size="sm" description="No class-count membership has classes to record today." />
              ) : (
                <ClassCountList rows={eligible} mode="record" ariaLabel="Class-count memberships with classes left" today={today} />
              )}
            </section>

            {toRenew.length > 0 ? (
              <section aria-labelledby="class-count-renew-heading" className="flex flex-col gap-1">
                <h2 id="class-count-renew-heading" className="flex items-center gap-2 text-body font-semibold text-text-primary">
                  No classes remaining
                  <Badge variant="neutral">{toRenew.length}</Badge>
                </h2>
                <ClassCountList rows={toRenew} mode="renew" ariaLabel="Class-count memberships with no classes left" />
              </section>
            ) : null}
          </div>
        )}
      </Container>
    </>
  );
}
