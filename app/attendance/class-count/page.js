import { ClipboardCheck } from "lucide-react";
import { requireRole, ROLES } from "@/lib/auth/dal";
import Container from "@/components/layout/Container";
import PageHeader from "@/components/layout/PageHeader";
import EmptyState from "@/components/ui/empty-state";
import { todayDateString } from "@/lib/memberships/data";
import { listClassCountEligible, listClassCountToRenew } from "@/lib/class-count-attendance/data";
import AttendanceViewToggle from "@/app/attendance/attendance-view-toggle";
import ClassCountList from "@/app/attendance/class-count/class-count-list";

/**
 * Class Count Attendance - the third tab of Attendance (beside Today's Sessions and All Sessions), Admin only
 * (01-product.md §8 "Class Count Attendance"; 02-ux.md "Class Count Attendance").
 *
 * A route of its own rather than a view of `app/attendance/page.js`, so the session workflow of that page is not
 * touched: this tab never reads a class session or the `attendance` table. It lists the class-count memberships a
 * class can be recorded for today (with classes used and left, and the expiry), each with Record class; and the
 * memberships whose classes are all used, each with Renew. Duration memberships never appear here, and nothing here
 * changes session attendance.
 *
 * Admin only: the layout (app/attendance/layout.js) also admits an instructor to the other two tabs, so this page
 * repeats `requireRole` itself - an instructor who types the URL is sent home - and the database refuses them again.
 */
export default async function ClassCountAttendancePage() {
  await requireRole(ROLES.ADMIN);

  const [eligible, toRenew, today] = await Promise.all([listClassCountEligible(), listClassCountToRenew(), todayDateString()]);

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
          <EmptyState description="No class-count memberships to record. A membership appears here once it has started and has classes left." />
        ) : (
          <div className="flex flex-col gap-8">
            <section aria-labelledby="class-count-record-heading" className="flex flex-col gap-3">
              <h2 id="class-count-record-heading" className="text-body font-semibold text-text-primary">
                Ready to record
              </h2>
              {eligible.length === 0 ? (
                <EmptyState size="sm" description="No class-count membership has classes to record today." />
              ) : (
                <ClassCountList rows={eligible} mode="record" ariaLabel="Class-count memberships with classes left" today={today} />
              )}
            </section>

            {toRenew.length > 0 ? (
              <section aria-labelledby="class-count-renew-heading" className="flex flex-col gap-3">
                <h2 id="class-count-renew-heading" className="text-body font-semibold text-text-primary">
                  No classes remaining
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
