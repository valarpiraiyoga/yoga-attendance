import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getStudent } from "@/lib/students/data";
import { listBatchOptions } from "@/lib/batches/data";
import { listCurrentSchedules } from "@/lib/schedules/data";
import { todayDateString } from "@/lib/schedules/validation";
import { createEnrollment } from "@/lib/enrollments/actions";
import { getCurrentMembershipForStudent } from "@/lib/memberships/data";
import EnrollmentForm from "@/app/students/[id]/enrollments/enrollment-form";
import GuidedSteps from "@/app/students/guided-steps";

const PLAN_LABELS = { monthly: "Monthly", quarterly: "Quarterly", custom: "Custom duration" };
const MEMBERSHIP_STATUS_LABELS = { upcoming: "Upcoming", active: "Active", expired: "Expired", cancelled: "Cancelled" };
const MEMBERSHIP_STATUS_VARIANTS = { upcoming: "default", active: "success", expired: "neutral", cancelled: "danger" };

function formatDate(value) {
  if (!value) return "—";
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Add Batch Enrollment (wireframe p13). Serves two entry points with one
 * page rather than duplicating the form across two routes:
 *
 * - `?guided=1` — step 3 of the Add Student flow, arrived at directly from
 *   `createStudent`'s redirect (02-ux.md Flow 02).
 * - no query param — "Add Enrollment" from an existing student's Details
 *   page (02-ux.md Flow 10).
 *
 * The guided entry also shows a read-only Membership Context card
 * (wireframe: "STUDENT CONTEXT / MEMBERSHIP CONTEXT" alongside step 3),
 * summarizing the membership created in step 2 — using
 * `getCurrentMembershipForStudent` (lib/memberships/data.js), the same
 * lookup and status derivation Student Details' Membership panel already
 * uses, not a second implementation. Step 2 is skippable, so when the
 * student has no membership yet, the card shows that honestly ("No
 * membership was created for this student") instead of fabricating one or
 * silently disappearing.
 */
export default async function NewEnrollmentPage({ params, searchParams }) {
  // Authorization boundary — see app/students/layout.js for why this must be
  // repeated here rather than relying on the layout alone. createEnrollment
  // also calls requireRole itself before writing anything.
  await requireRole(ROLES.ADMIN);

  const { id } = await params;
  const student = await getStudent(id);

  if (!student) {
    notFound();
  }

  const rawParams = await searchParams;
  const isGuided = rawParams?.guided === "1";

  const [batchOptions, currentSchedules, currentMembership] = await Promise.all([
    listBatchOptions(),
    listCurrentSchedules(),
    isGuided ? getCurrentMembershipForStudent(id) : Promise.resolve(null),
  ]);
  const createEnrollmentForStudent = createEnrollment.bind(null, id);

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href={`/students/${id}`}
        className="text-body inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to Student Details
      </Link>

      <h1 className="text-page-title mt-3 font-semibold text-text-primary">Add Batch Enrollment</h1>
      <p className="text-body mt-1 text-text-secondary">
        Assign this student to a batch{isGuided ? " to complete their setup." : "."}
      </p>

      {isGuided ? <GuidedSteps current={3} /> : null}

      <div className="mt-6 rounded-card border border-border bg-surface p-6 shadow-xs">
        <div className={isGuided ? "mb-6 grid gap-4 sm:grid-cols-2" : "mb-6"}>
          <div className="flex flex-col gap-1 rounded-lg border border-border bg-background/60 p-3">
            {isGuided ? (
              <span className="text-small font-medium tracking-wide text-text-secondary uppercase">
                Student Context
              </span>
            ) : null}
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="text-body font-medium text-text-primary">{student.full_name}</span>
              <span className="text-body text-text-secondary">{student.phone}</span>
            </div>
          </div>

          {isGuided && currentMembership ? (
            <div className="flex flex-col gap-1 rounded-lg border border-border bg-background/60 p-3">
              <span className="text-small font-medium tracking-wide text-text-secondary uppercase">
                Membership Context
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-body font-medium text-text-primary">
                  {PLAN_LABELS[currentMembership.plan] ?? currentMembership.plan} Membership
                </span>
                <Badge variant={MEMBERSHIP_STATUS_VARIANTS[currentMembership.status]}>
                  {MEMBERSHIP_STATUS_LABELS[currentMembership.status]}
                </Badge>
              </div>
              <span className="text-body text-text-secondary">
                {formatDate(currentMembership.start_date)} – {formatDate(currentMembership.end_date)}
              </span>
            </div>
          ) : isGuided ? (
            <div className="flex flex-col justify-center gap-1 rounded-lg border border-dashed border-border bg-background/60 p-3">
              <span className="text-small font-medium tracking-wide text-text-secondary uppercase">
                Membership Context
              </span>
              <span className="text-body text-text-secondary">No membership was created for this student.</span>
            </div>
          ) : null}
        </div>

        <EnrollmentForm
          action={createEnrollmentForStudent}
          batchOptions={batchOptions}
          currentSchedules={currentSchedules}
          todayDate={todayDateString()}
          submitLabel="Save Enrollment"
          pendingLabel="Saving…"
          cancelHref={`/students/${id}`}
        />
      </div>
    </div>
  );
}
