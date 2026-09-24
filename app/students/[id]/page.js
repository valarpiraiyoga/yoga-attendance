import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  CalendarDays,
  ClipboardList,
  CreditCard,
  FileText,
  Hash,
  Layers,
  Pencil,
  Plus,
  UserRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/ui/avatar";
import EmptyState from "@/components/ui/empty-state";
import { StatTile, StatTileGroup } from "@/components/ui/stat-tile";
import { EntityDetailHeader } from "@/components/layout/EntityDetailHeader";
import { Panel, PanelHeader } from "@/components/layout/Panel";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getStudent } from "@/lib/students/data";
import {
  listEnrollmentsForStudent,
  listScheduleAssignmentsForEnrollment,
  isScheduleAssignmentActive,
} from "@/lib/enrollments/data";
import { DAY_LABELS, DAYS_OF_WEEK } from "@/lib/schedules/validation";
import { getCurrentMembershipForStudent } from "@/lib/memberships/data";
import { formatAmount, formatDate, formatDateShort, formatTimeRange } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ENTITY_STATUS, MEMBERSHIP_STATUS, PAYMENT_STATUS, PLAN } from "@/lib/status";
import StudentStatusButton from "@/app/students/[id]/student-status-button";
import StudentCardMenu from "@/app/students/student-card-menu";
import GuidedComplete from "@/app/students/guided-complete";
import { formatPhone } from "@/lib/phone";

const SUCCESS_MESSAGES = {
  updated: "Student updated successfully.",
  enrollment_added: "Batch enrollment added successfully.",
  enrollment_updated: "Batch enrollment updated successfully.",
  membership_added: "Membership added successfully.",
};

// Enrollment schedule table columns: Day · Time · Instructor. Below `sm` the
// header row is hidden and the instructor drops to its own line under the time.
const SCHEDULE_COLUMNS =
  "grid grid-cols-[3rem_minmax(0,1fr)] gap-x-4 sm:grid-cols-[4rem_minmax(0,1fr)_minmax(0,1fr)]";

/** "Hatha Yoga General" -> "HYG": the first letters of up to three words. */
function batchAbbreviation(name) {
  const letters = String(name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((word) => word[0].toUpperCase())
    .join("");
  return letters || "?";
}

/** Monday-first, then by start time — a stable, readable order for the schedule table. */
function sortAssignmentsByWeek(assignments) {
  const dayIndex = (assignment) => {
    const index = DAYS_OF_WEEK.indexOf(assignment.schedule?.day_of_week);
    return index === -1 ? DAYS_OF_WEEK.length : index;
  };
  return [...assignments].sort(
    (a, b) =>
      dayIndex(a) - dayIndex(b) ||
      String(a.schedule?.start_time ?? "").localeCompare(String(b.schedule?.start_time ?? ""))
  );
}

/** A field's value — the one value style every detail panel uses. */
function Value({ children, className }) {
  return (
    <p className={`text-body font-medium break-words text-text-primary ${className ?? ""}`}>{children}</p>
  );
}

/**
 * One Student Information field: a small muted label above the value. The
 * panel is full width, so the fields sit in a 1 / 2 / 4-column grid.
 */
function InfoRow({ label, children, valueClassName, className }) {
  return (
    <div className={cn("grid min-w-0 content-start gap-0.5", className)}>
      <dt className="text-small text-text-secondary">{label}</dt>
      <dd>
        <Value className={valueClassName}>{children}</Value>
      </dd>
    </div>
  );
}

/** `Sep 1 – Sep 30, 2026` within a year; both years shown when the period crosses one. */
function formatPeriod(startDate, endDate) {
  return startDate.slice(0, 4) === endDate.slice(0, 4)
    ? `${formatDateShort(startDate)} – ${formatDate(endDate)}`
    : `${formatDate(startDate)} – ${formatDate(endDate)}`;
}

/**
 * Student Details (wireframe p10; `04 Student detail.png`) — a single page,
 * not tabs (02-ux.md: "Student Details is a single page, not tabs" — settled
 * explicitly to resolve the earlier IA/wireframe conflict, and confirmed for
 * this refinement). Hierarchy, top to bottom: the identity header (who; status,
 * ID, gender, joined; actions) — the same compact header as Membership Details;
 * four compact summary tiles; a full-width Student Information panel (notes
 * included); one working row with Batch Enrollments (wider) and Current
 * Membership (a summary and entry point); then the quiet secondary sections,
 * Additional Information and Recent Attendance. Additional Information holds an honest empty
 * state: no supported student field is left to show there (notes live in
 * Student Information; the schema has no emergency contact, address or
 * medical fields).
 */
export default async function StudentDetailsPage({ params, searchParams }) {
  await requireRole(ROLES.ADMIN);

  const { id } = await params;
  const student = await getStudent(id);

  if (!student) {
    notFound();
  }

  const [enrollments, currentMembership] = await Promise.all([
    listEnrollmentsForStudent(id),
    getCurrentMembershipForStudent(id),
  ]);
  const assignmentsByEnrollmentId = new Map(
    await Promise.all(
      enrollments.map(async (enrollment) => [enrollment.id, await listScheduleAssignmentsForEnrollment(enrollment.id)])
    )
  );
  const rawParams = await searchParams;
  const message = SUCCESS_MESSAGES[rawParams?.success] ?? null;

  // The Add Student guided flow's finish (`createEnrollment` redirects here
  // with `?guided=1`): show its completion screen instead of the details.
  if (rawParams?.guided === "1" && rawParams?.success === "enrollment_added") {
    return (
      <GuidedComplete
        student={student}
        membership={currentMembership}
        enrollment={enrollments.find((enrollment) => enrollment.status === "active") ?? enrollments[0]}
      />
    );
  }
  const activeEnrollmentCount = enrollments.filter((enrollment) => enrollment.status === "active").length;
  const membershipStatus = currentMembership
    ? (MEMBERSHIP_STATUS[currentMembership.status] ?? { label: currentMembership.status, variant: "neutral" })
    : null;
  const studentStatus = ENTITY_STATUS[student.status] ?? ENTITY_STATUS.inactive;
  const isActive = student.status === "active";

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/students"
        className="text-body inline-flex w-fit items-center gap-1.5 text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to Students
      </Link>

      <>
        <EntityDetailHeader
          decorative={false}
          className="mb-0"
          avatar={<Avatar name={student.full_name} src={student.photo_url} size="lg" />}
          title={student.full_name}
          status={<Badge variant={studentStatus.variant}>{studentStatus.label}</Badge>}
          subMeta={
            <>
              <span className="inline-flex items-center gap-1.5">
                <Hash className="size-3.5 shrink-0" aria-hidden="true" />
                Student ID: {student.student_code}
              </span>
              {student.gender ? (
                <span className="inline-flex items-center gap-1.5 capitalize">
                  <UserRound className="size-3.5 shrink-0" aria-hidden="true" />
                  {student.gender}
                </span>
              ) : null}
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="size-3.5 shrink-0" aria-hidden="true" />
                Joined {formatDate(student.join_date)}
              </span>
            </>
          }
          actions={
            <>
              <StudentStatusButton studentId={student.id} studentName={student.full_name} status={student.status} />
              <Button variant="outline" render={<Link href={`/students/${student.id}/edit`} />} nativeButton={false}>
                <Pencil className="size-4" aria-hidden="true" />
                Edit Student
              </Button>
              <StudentCardMenu
                studentId={student.id}
                membershipId={currentMembership?.id ?? null}
                enrollmentId={enrollments.find((enrollment) => enrollment.status === "active")?.id ?? null}
                triggerVariant="outline"
                triggerSize="icon"
                triggerClassName=""
                triggerLabel={`More actions for ${student.full_name}`}
              />
            </>
          }
        />

        <StatTileGroup ariaLabel="Student summary" columns={2} className="-mt-2 grid-cols-1 xl:grid-cols-4">
          <StatTile
            compact
            icon={Layers}
            label="Enrollments"
            value={activeEnrollmentCount}
            caption={`Active of ${enrollments.length} total`}
            tone="brand"
          />
          <StatTile
            compact
            icon={CreditCard}
            label="Membership"
            value={membershipStatus ? membershipStatus.label : "None"}
            caption={currentMembership ? `Ends ${formatDate(currentMembership.end_date)}` : "No membership yet"}
            tone="info"
          />
          <StatTile
            compact
            icon={UserRound}
            label="Status"
            value={isActive ? "Active" : "Inactive"}
            caption="Student record"
            tone={isActive ? "success" : "danger"}
          />
          <StatTile compact icon={Calendar} label="Joined" value={formatDate(student.join_date)} caption="Join date" tone="neutral" />
        </StatTileGroup>
      </>

      {message ? (
        <div
          role="status"
          className="rounded-input border border-success/30 bg-success/5 px-3 py-2 text-body text-success"
        >
          {message}
        </div>
      ) : null}

      <Panel>
        <PanelHeader icon={UserRound} title="Student Information" />
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          <InfoRow label="Full Name">{student.full_name}</InfoRow>
          <InfoRow label="Student ID">{student.student_code}</InfoRow>
          <InfoRow label="Phone">{formatPhone(student.phone, student.phone_country_code)}</InfoRow>
          <InfoRow label="Email" valueClassName="break-all">
            {student.email || "—"}
          </InfoRow>
          <InfoRow label="Join Date">{formatDate(student.join_date)}</InfoRow>
          <InfoRow label="Date of Birth">{student.date_of_birth ? formatDate(student.date_of_birth) : "—"}</InfoRow>
          <InfoRow label="Gender" valueClassName="capitalize">
            {student.gender || "—"}
          </InfoRow>
        </dl>
        <div className="mt-3 border-t border-border pt-3">
          <p className="text-small text-text-secondary">Notes</p>
          <p className="text-body mt-0.5 break-words whitespace-pre-line text-text-primary">
            {student.notes || "No notes."}
          </p>
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        <Panel>
          <PanelHeader
            icon={Layers}
            title="Batch Enrollments"
            className="flex-col items-start sm:flex-row sm:items-center"
            action={
              <Button size="sm" render={<Link href={`/students/${student.id}/enrollments/new`} />} nativeButton={false}>
                <Plus className="size-4" aria-hidden="true" />
                Add Enrollment
              </Button>
            }
          />
          {enrollments.length === 0 ? (
            <EmptyState
              size="sm"
              description="No batch enrollments yet. Add one to make this student eligible for attendance."
            />
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {enrollments.map((enrollment) => {
                const schedules = sortAssignmentsByWeek(
                  (assignmentsByEnrollmentId.get(enrollment.id) ?? []).filter((assignment) =>
                    isScheduleAssignmentActive(assignment)
                  )
                );
                const batchName = enrollment.batches?.name ?? "Unknown batch";
                const batchCode = enrollment.batches?.code ?? "—";
                const enrollmentStatus = ENTITY_STATUS[enrollment.status] ?? ENTITY_STATUS.inactive;

                return (
                  <li key={enrollment.id} className="py-3 first:pt-0 last:pb-0">
                    {/* One flat row per enrollment (no nested card): the batch tile, name with its status,
                        code, and the edit control — then its schedule table. */}
                    <div className="flex items-start gap-3">
                      <span
                        aria-hidden="true"
                        className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand/10 px-1 text-small font-semibold text-brand"
                      >
                        {batchAbbreviation(batchName)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <p className="text-body font-semibold break-words text-text-primary">{batchName}</p>
                          <Badge variant={enrollmentStatus.variant}>{enrollmentStatus.label}</Badge>
                        </div>
                        <p className="text-small text-text-secondary">
                          Code: <span className="font-medium text-text-primary">{batchCode}</span>
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="shrink-0 text-brand hover:bg-brand/10 hover:text-brand"
                        aria-label={`Edit enrollment in ${batchName}`}
                        title="Edit Enrollment"
                        render={<Link href={`/students/${student.id}/enrollments/${enrollment.id}/edit`} />}
                        nativeButton={false}
                      >
                        <Pencil className="size-4" aria-hidden="true" />
                      </Button>
                    </div>

                    {schedules.length === 0 ? (
                      <p className="text-small mt-2 font-medium text-danger">
                        No schedule assigned — this enrollment is not eligible for attendance.
                      </p>
                    ) : (
                      <div role="table" aria-label={`${batchName} schedules`} className="mt-2">
                        <div role="row" className={`${SCHEDULE_COLUMNS} hidden border-b border-border pb-1.5 sm:grid`}>
                          {["Day", "Time", "Instructor"].map((heading) => (
                            <div
                              key={heading}
                              role="columnheader"
                              className="text-small font-medium tracking-wide text-text-secondary uppercase"
                            >
                              {heading}
                            </div>
                          ))}
                        </div>
                        {schedules.map((assignment) => {
                          const schedule = assignment.schedule;

                          if (!schedule) {
                            return (
                              <div key={assignment.id} role="row" className="border-b border-border/60 py-1.5 last:border-b-0">
                                <p role="cell" className="text-small font-medium text-danger">
                                  Assigned schedule could not be found
                                </p>
                              </div>
                            );
                          }

                          const instructor = schedule.instructors;

                          return (
                            <div
                              key={assignment.id}
                              role="row"
                              className={`${SCHEDULE_COLUMNS} items-center gap-y-1 border-b border-border/60 py-1.5 last:border-b-0`}
                            >
                              <div role="cell" className="text-body font-medium text-text-primary">
                                {(DAY_LABELS[schedule.day_of_week] ?? schedule.day_of_week).slice(0, 3)}
                              </div>
                              <div role="cell" className="text-body min-w-0 text-text-primary">
                                {formatTimeRange(schedule.start_time, schedule.end_time)}
                              </div>
                              <div role="cell" className="col-span-2 flex min-w-0 items-center gap-2 sm:col-span-1">
                                {instructor?.full_name ? (
                                  <>
                                    <Avatar name={instructor.full_name} src={instructor.photo_url} size="sm" className="size-6" />
                                    <span className="text-body truncate text-text-primary">{instructor.full_name}</span>
                                  </>
                                ) : (
                                  <span className="text-body text-text-secondary">—</span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel>
          <PanelHeader
            icon={CreditCard}
            title="Current Membership"
            className="flex-col items-start sm:flex-row sm:items-center"
            action={
              <Button
                variant="outline"
                size="sm"
                render={<Link href={`/students/${student.id}/memberships/new`} />}
                nativeButton={false}
              >
                <Plus className="size-4" aria-hidden="true" />
                Add Membership
              </Button>
            }
          />
          {currentMembership ? (
            <div>
              {/* A summary and entry point — the full record lives on Membership Details. */}
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="text-body font-semibold text-text-primary">
                      {PLAN[currentMembership.plan] ?? currentMembership.plan} Membership
                    </p>
                    <Badge variant={membershipStatus.variant}>{membershipStatus.label}</Badge>
                  </div>
                  <div className="text-small flex flex-wrap items-center gap-x-3 gap-y-0.5 text-text-secondary">
                    <span>ID: {currentMembership.membership_code}</span>
                    <Link
                      href={`/memberships/${currentMembership.id}`}
                      className="inline-flex items-center gap-1 font-medium text-brand hover:underline"
                    >
                      View Membership
                      <ArrowRight className="size-3.5" aria-hidden="true" />
                    </Link>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 text-brand hover:bg-brand/10 hover:text-brand"
                  aria-label={`Edit membership ${currentMembership.membership_code}`}
                  title="Edit Membership"
                  render={<Link href={`/memberships/${currentMembership.id}/edit`} />}
                  nativeButton={false}
                >
                  <Pencil className="size-4" aria-hidden="true" />
                </Button>
              </div>

              <div className="@container mt-3 border-t border-border pt-3">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 @md:grid-cols-3">
                  <InfoRow label="Validity" className="col-span-2 @md:col-span-1">
                    {formatPeriod(currentMembership.start_date, currentMembership.end_date)}
                  </InfoRow>
                  <InfoRow label="Amount">{formatAmount(currentMembership.amount)}</InfoRow>
                  <div className="grid min-w-0 content-start gap-0.5">
                    <dt className="text-small text-text-secondary">Payment</dt>
                    <dd>
                      <Badge variant={(PAYMENT_STATUS[currentMembership.payment_status] ?? PAYMENT_STATUS.pending).variant}>
                        {(PAYMENT_STATUS[currentMembership.payment_status] ?? PAYMENT_STATUS.pending).label}
                      </Badge>
                    </dd>
                  </div>
                </dl>
              </div>
            </div>
          ) : (
            <EmptyState size="sm" description="No membership yet for this student." />
          )}
        </Panel>
      </div>

      <Panel>
        <PanelHeader icon={FileText} title="Additional Information" className="mb-2" />
        <EmptyState
          size="compact"
          title="No additional information yet"
          description="Extra student details will appear here when they are available."
        />
      </Panel>

      <Panel>
        <PanelHeader icon={ClipboardList} title="Recent Attendance" className="mb-2" />
        <EmptyState
          size="compact"
          title="No recent attendance yet"
          description="Attendance for this student will appear here once classes are marked."
        />
      </Panel>
    </div>
  );
}
