import Link from "next/link";
import { notFound } from "next/navigation";
import { getCentreToday } from "@/lib/center-profile/settings";
import {
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
import BatchAvatar from "@/components/ui/batch-avatar";
import EmptyState from "@/components/ui/empty-state";
import FlashToast from "@/components/ui/flash-toast";
import { StatTile, StatTileGroup } from "@/components/ui/stat-tile";
import Container from "@/components/layout/Container";
import { EntityDetailHeader } from "@/components/layout/EntityDetailHeader";
import PageHeader from "@/components/layout/PageHeader";
import { Panel, PanelHeader } from "@/components/layout/Panel";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getStudent } from "@/lib/students/data";
import { getRecentStudentAttendance } from "@/lib/reports/data";
import { InstructorCell } from "@/components/ui/session-cells";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  listEnrollmentsForStudent,
  listScheduleAssignmentsForEnrollment,
  isScheduleAssignmentActive,
} from "@/lib/enrollments/data";
import { DAY_LABELS, DAYS_OF_WEEK } from "@/lib/schedules/validation";
import { getCurrentMembershipForStudent } from "@/lib/memberships/data";
import { formatDate, formatDateShort, formatDateWithWeekday, formatTimeRange } from "@/lib/format";
import { formatCurrency } from "@/lib/currencies";
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
 * One field of a side panel: the muted label on the left, the value on the right,
 * for the narrow column the Membership and Profile & Contact panels sit in.
 */
function DetailRow({ label, children, valueClassName }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 first:pt-0 last:pb-0">
      <dt className="text-small shrink-0 text-text-secondary">{label}</dt>
      <dd className="min-w-0 text-right">
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

const ATTENDANCE_STATUS = {
  present: { label: "Present", variant: "success" },
  absent: { label: "Absent", variant: "danger" },
};

/**
 * The student's latest recorded attendance (`getRecentStudentAttendance`), or
 * `null` when it cannot be loaded, so the rest of Student Details still renders
 * and the panel says so rather than claiming there is none.
 */
async function loadRecentAttendance(studentId, today) {
  try {
    return await getRecentStudentAttendance(studentId, today);
  } catch {
    return null;
  }
}

/**
 * Student Details (wireframe p10; `04 Student detail.png`) — a single page,
 * not tabs (02-ux.md: "Student Details is a single page, not tabs" — settled
 * explicitly to resolve the earlier IA/wireframe conflict, and confirmed for
 * this refinement). Hierarchy, top to bottom: the page strip; the identity header
 * (who; status, ID, gender, joined; actions) — the same header as Membership
 * Details; four compact summary cards; the working content in two columns from `xl`
 * (left: Batch Enrollments then Recent Attendance; right: Current Membership, a summary
 * and entry point, then Profile & Contact: phone, email, date of birth, gender); and
 * Additional Information (the notes) full width at the bottom. No student field is
 * dropped: name, ID and join date are in the identity header, the rest below it.
 */
export default async function StudentDetailsPage({ params, searchParams }) {
  await requireRole(ROLES.ADMIN);

  const { id } = await params;
  const today = await getCentreToday();
  const student = await getStudent(id);

  if (!student) {
    notFound();
  }

  const [enrollments, currentMembership, recentAttendance] = await Promise.all([
    listEnrollmentsForStudent(id),
    getCurrentMembershipForStudent(id),
    loadRecentAttendance(id, today),
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
  const membershipStatus = currentMembership
    ? (MEMBERSHIP_STATUS[currentMembership.status] ?? { label: currentMembership.status, variant: "neutral" })
    : null;
  const studentStatus = ENTITY_STATUS[student.status] ?? ENTITY_STATUS.inactive;
  const isActive = student.status === "active";
  const activeEnrollmentCount = enrollments.filter((enrollment) => enrollment.status === "active").length;

  return (
    <>
      <PageHeader
        compact
        back={{ href: "/students", label: "Back to Students" }}
        title="Student Details"
        description={`Profile, enrollments and membership for ${student.full_name}.`}
      />
      <Container className="flex flex-col gap-6">
      <>
        <EntityDetailHeader
          decorative={false}
          wash
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
              <StudentStatusButton
                studentId={student.id}
                studentName={student.full_name}
                status={student.status}
                student={{ full_name: student.full_name, student_code: student.student_code, photo_url: student.photo_url }}
              />
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

      {/* The save confirmation is a toast overlay, not a banner, so it takes no layout space. */}
      <FlashToast message={message} />

      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-2 lg:items-start xl:grid-cols-[minmax(0,1fr)_22rem]">
        {/* From `xl`: two columns, the working panels on the left (enrollments, then attendance) and the
            reference panels on the right (membership, then profile). Below `xl` the wrappers dissolve
            (`contents`) and the four panels are laid out by `order`: enrollments, membership, profile,
            attendance - one column on a phone, and from `lg` enrollments and attendance full width with
            membership and profile side by side between them. */}
        <div className="contents xl:flex xl:min-w-0 xl:flex-col xl:gap-6">
        <Panel className="order-1 lg:col-span-2 xl:order-none xl:col-span-1">
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
                    isScheduleAssignmentActive(assignment, today)
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
                      <BatchAvatar batch={{ ...enrollment.batches, name: batchName }} size="md" className="shrink-0" />
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

      <Panel className="order-4 lg:col-span-2 xl:order-none xl:col-span-1">
        <PanelHeader icon={ClipboardList} title="Recent Attendance" className="mb-2" />
        {!recentAttendance ? (
          <EmptyState
            size="compact"
            title="Recent attendance is not available right now"
            description="Try refreshing the page."
          />
        ) : recentAttendance.length === 0 ? (
          <EmptyState
            size="compact"
            title="No recent attendance yet"
            description="Attendance for this student will appear here once classes are marked."
          />
        ) : (
          <Table aria-label="Recent attendance">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Date</TableHead>
                <TableHead>Batch</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden sm:table-cell">Instructor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentAttendance.map((session) => {
                const status = ATTENDANCE_STATUS[session.status];
                return (
                  <TableRow key={session.id}>
                    <TableCell className="whitespace-nowrap font-medium text-text-primary">
                      {formatDateWithWeekday(session.session_date)}
                    </TableCell>
                    <TableCell className="text-text-primary">
                      {session.batch?.name ?? "—"}
                      {session.batch?.code ? <span className="text-text-secondary"> · {session.batch.code}</span> : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <InstructorCell name={session.instructor?.full_name} photoUrl={session.instructor?.photo_url} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Panel>
        </div>
        <div className="contents xl:flex xl:min-w-0 xl:flex-col xl:gap-6">
        <Panel className="order-2 xl:order-none">
          <PanelHeader
            icon={CreditCard}
            title="Current Membership"
            action={
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Add Membership"
                title="Add Membership"
                render={<Link href={`/students/${student.id}/memberships/new`} />}
                nativeButton={false}
              >
                <Plus className="size-4" aria-hidden="true" />
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

              <dl className="mt-3 flex flex-col divide-y divide-border border-t border-border pt-3">
                <DetailRow label="Validity">{formatPeriod(currentMembership.start_date, currentMembership.end_date)}</DetailRow>
                <DetailRow label="Amount">{formatCurrency(currentMembership.amount, currentMembership.currency)}</DetailRow>
                <DetailRow label="Payment">
                  <Badge variant={(PAYMENT_STATUS[currentMembership.payment_status] ?? PAYMENT_STATUS.pending).variant}>
                    {(PAYMENT_STATUS[currentMembership.payment_status] ?? PAYMENT_STATUS.pending).label}
                  </Badge>
                </DetailRow>
              </dl>
            </div>
          ) : (
            <EmptyState size="sm" description="No membership yet for this student." />
          )}
        </Panel>

        <Panel className="order-3 xl:order-none">
          <PanelHeader icon={UserRound} title="Profile & Contact" />
          <dl className="flex flex-col divide-y divide-border">
            <DetailRow label="Phone">{formatPhone(student.phone, student.phone_country_code)}</DetailRow>
            <DetailRow label="Email" valueClassName="break-all">
              {student.email || "—"}
            </DetailRow>
            <DetailRow label="Date of Birth">{student.date_of_birth ? formatDate(student.date_of_birth) : "—"}</DetailRow>
            <DetailRow label="Gender" valueClassName="capitalize">
              {student.gender || "—"}
            </DetailRow>
          </dl>
        </Panel>
        </div>
      </div>

      <Panel>
        <PanelHeader icon={FileText} title="Additional Information" className="mb-2" />
        {student.notes ? (
          <div>
            <p className="text-small text-text-secondary">Notes</p>
            <p className="text-body mt-0.5 break-words whitespace-pre-line text-text-primary">{student.notes}</p>
          </div>
        ) : (
          <EmptyState size="compact" title="No additional information yet" />
        )}
      </Panel>
      </Container>
    </>
  );
}
