import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  CalendarDays,
  ClipboardList,
  Clock,
  CreditCard,
  FileText,
  Hash,
  Layers,
  Mail,
  Pencil,
  Phone,
  Plus,
  UserRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/ui/avatar";
import EmptyState from "@/components/ui/empty-state";
import { StatTile, StatTileGroup } from "@/components/ui/stat-tile";
import { EntityDetailHeader } from "@/components/layout/EntityDetailHeader";
import FieldRow from "@/components/layout/FieldRow";
import { Panel, PanelHeader } from "@/components/layout/Panel";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getStudent } from "@/lib/students/data";
import {
  listEnrollmentsForStudent,
  listScheduleAssignmentsForEnrollment,
  isScheduleAssignmentActive,
} from "@/lib/enrollments/data";
import { DAY_LABELS } from "@/lib/schedules/validation";
import { getCurrentMembershipForStudent } from "@/lib/memberships/data";
import { formatAmount, formatDate, formatTimeRange } from "@/lib/format";
import { ENTITY_STATUS, MEMBERSHIP_STATUS, PAYMENT_STATUS, PLAN } from "@/lib/status";
import DeactivateStudent from "@/app/students/[id]/deactivate-student";

const SUCCESS_MESSAGES = {
  updated: "Student updated successfully.",
  enrollment_added: "Batch enrollment added successfully.",
  enrollment_updated: "Batch enrollment updated successfully.",
  membership_added: "Membership added successfully.",
};

/** A field's value — the one value style every detail panel uses. */
function Value({ children, className }) {
  return (
    <p className={`text-body font-semibold break-words text-text-primary ${className ?? ""}`}>{children}</p>
  );
}

/**
 * Student Details (wireframe p10; `04 Student detail.png`) — a single page,
 * not tabs (02-ux.md: "Student Details is a single page, not tabs" — settled
 * explicitly to resolve the earlier IA/wireframe conflict, and confirmed for
 * this refinement). The header, the summary tiles, and the panels: Student
 * Information, Additional Information, Batch Enrollments, Current
 * Membership, Recent Attendance.
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
  const activeEnrollmentCount = enrollments.filter((enrollment) => enrollment.status === "active").length;
  const studentStatus = ENTITY_STATUS[student.status] ?? ENTITY_STATUS.inactive;
  const membershipStatus = currentMembership
    ? (MEMBERSHIP_STATUS[currentMembership.status] ?? { label: currentMembership.status, variant: "neutral" })
    : null;
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

      <div className="flex flex-col gap-4">
        <EntityDetailHeader
          className="mb-0"
          avatar={<Avatar name={student.full_name} src={student.photo_url} size="lg" />}
          title={student.full_name}
          status={<Badge variant={studentStatus.variant}>{studentStatus.label}</Badge>}
          subMeta={
            <>
              <span className="inline-flex items-center gap-1.5">
                <Hash className="size-3.5 shrink-0" aria-hidden="true" />
                ID: {student.student_code}
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
              <Button variant="outline" render={<Link href={`/students/${student.id}/edit`} />} nativeButton={false}>
                <Pencil className="size-4" aria-hidden="true" />
                Edit Student
              </Button>
              <DeactivateStudent studentId={student.id} studentName={student.full_name} status={student.status} />
            </>
          }
        />

        <StatTileGroup ariaLabel="Student summary" className="grid-cols-1 sm:grid-cols-2">
          <StatTile
            icon={Layers}
            label="Enrollments"
            value={activeEnrollmentCount}
            caption={`Active of ${enrollments.length} total`}
            tone="brand"
          />
          <StatTile
            icon={CreditCard}
            label="Membership"
            value={membershipStatus ? membershipStatus.label : "None"}
            caption={currentMembership ? `Ends ${formatDate(currentMembership.end_date)}` : "No membership yet"}
            tone="info"
          />
          <StatTile
            icon={UserRound}
            label="Status"
            value={isActive ? "Active" : "Inactive"}
            caption="Student record"
            tone={isActive ? "success" : "danger"}
          />
          <StatTile icon={Calendar} label="Joined" value={formatDate(student.join_date)} caption="Join date" tone="neutral" />
        </StatTileGroup>
      </div>

      {message ? (
        <div
          role="status"
          className="rounded-input border border-success/30 bg-success/5 px-3 py-2 text-body text-success"
        >
          {message}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <div className="flex flex-col gap-6">
          <Panel>
            <PanelHeader icon={UserRound} title="Student Information" className="mb-4 min-h-8" />
            <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <FieldRow icon={UserRound} label="Full Name">
                <Value>{student.full_name}</Value>
              </FieldRow>
              <FieldRow icon={Hash} label="Student ID">
                <Value>{student.student_code}</Value>
              </FieldRow>
              <FieldRow icon={Phone} label="Phone">
                <Value>{student.phone || "—"}</Value>
              </FieldRow>
              <FieldRow icon={Calendar} label="Join Date">
                <Value>{formatDate(student.join_date)}</Value>
              </FieldRow>
              <FieldRow icon={Mail} label="Email">
                <Value>{student.email || "—"}</Value>
              </FieldRow>
              <FieldRow icon={Calendar} label="Date of Birth">
                <Value>{student.date_of_birth ? formatDate(student.date_of_birth) : "—"}</Value>
              </FieldRow>
              <FieldRow icon={UserRound} label="Gender">
                <Value className="capitalize">{student.gender || "—"}</Value>
              </FieldRow>
            </div>
          </Panel>

          <Panel>
            <PanelHeader icon={FileText} title="Additional Information" className="mb-4 min-h-8" />
            <FieldRow icon={FileText} label="Notes">
              <p className="text-body break-words whitespace-pre-line text-text-primary">{student.notes || "—"}</p>
            </FieldRow>
          </Panel>
        </div>

        <div className="flex flex-col gap-6">
          <Panel>
            <PanelHeader
              icon={Layers}
              title="Batch Enrollments"
              className="mb-4 min-h-8 flex-col items-start sm:flex-row sm:items-center"
              action={
                <Button size="sm" render={<Link href={`/students/${student.id}/enrollments/new`} />} nativeButton={false}>
                  <Plus className="size-4" aria-hidden="true" />
                  Add Enrollment
                </Button>
              }
            />
            {enrollments.length === 0 ? (
              <p className="text-body text-text-secondary">
                No batch enrollments yet. Add one to make this student eligible for attendance.
              </p>
            ) : (
              <ul className="flex flex-col gap-4">
                {enrollments.map((enrollment) => {
                  const activeAssignments = (assignmentsByEnrollmentId.get(enrollment.id) ?? []).filter(
                    (assignment) => isScheduleAssignmentActive(assignment)
                  );
                  const batchName = enrollment.batches?.name ?? "Unknown batch";
                  const enrollmentStatus = ENTITY_STATUS[enrollment.status] ?? ENTITY_STATUS.inactive;

                  return (
                    <li key={enrollment.id} className="overflow-hidden rounded-lg border border-brand/20 bg-brand/5">
                      <div className="flex items-start gap-3 border-b border-brand/15 p-4">
                        <Avatar name={batchName} shape="square" />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-body font-semibold text-text-primary">{batchName}</p>
                            <Badge variant={enrollmentStatus.variant}>{enrollmentStatus.label}</Badge>
                          </div>
                          <p className="text-small mt-1 text-text-secondary">
                            Code: {enrollment.batches?.code ?? "—"}
                          </p>
                        </div>
                      </div>

                      <div className="grid gap-4 p-4 sm:grid-cols-2">
                        <FieldRow icon={Calendar} label="Start Date">
                          <Value>{formatDate(enrollment.effective_start_date)}</Value>
                        </FieldRow>
                        <FieldRow icon={Calendar} label="End Date">
                          <Value>
                            {enrollment.effective_end_date ? formatDate(enrollment.effective_end_date) : "Present"}
                          </Value>
                        </FieldRow>
                        <FieldRow icon={Clock} label="Schedules" className="sm:col-span-2">
                          {activeAssignments.length === 0 ? (
                            <p className="text-small font-medium text-danger">
                              No schedule assigned — this enrollment is not eligible for attendance.
                            </p>
                          ) : (
                            <ul className="flex flex-col gap-3">
                              {activeAssignments.map((assignment) => {
                                const schedule = assignment.schedule;
                                const instructorName = schedule?.instructors?.full_name ?? null;

                                return (
                                  <li key={assignment.id} className="min-w-0">
                                    {schedule ? (
                                      <>
                                        <p className="text-body font-medium text-text-primary">
                                          {DAY_LABELS[schedule.day_of_week] ?? schedule.day_of_week}
                                          {" · "}
                                          {formatTimeRange(schedule.start_time, schedule.end_time)}
                                        </p>
                                        <div className="mt-1.5 flex min-w-0 items-center gap-2">
                                          <Avatar
                                            name={instructorName ?? "?"}
                                            src={schedule.instructors?.photo_url ?? null}
                                            size="sm"
                                            tone="neutral"
                                            className="size-6"
                                          />
                                          <span className="text-small truncate text-text-secondary">
                                            {instructorName || "—"}
                                          </span>
                                        </div>
                                      </>
                                    ) : (
                                      <span className="text-small font-medium text-danger">
                                        Assigned schedule could not be found
                                      </span>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </FieldRow>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-brand/15 px-1.5 py-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-text-secondary hover:text-text-primary"
                          render={<Link href={`/students/${student.id}/enrollments/${enrollment.id}/edit`} />}
                          nativeButton={false}
                        >
                          Edit Enrollment
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-brand hover:bg-brand/10 hover:text-brand"
                          render={<Link href={`/batches/${enrollment.batch_id}`} />}
                          nativeButton={false}
                        >
                          View Batch
                          <ArrowRight className="size-4" aria-hidden="true" />
                        </Button>
                      </div>
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
              className="mb-4 min-h-8 flex-col items-start sm:flex-row sm:items-center"
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
              <div className="overflow-hidden rounded-lg border border-info/20 bg-info/5">
                <div className="border-b border-info/15 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-body font-semibold text-text-primary">
                      {PLAN[currentMembership.plan] ?? currentMembership.plan} Membership
                    </p>
                    <Badge variant={membershipStatus.variant}>{membershipStatus.label}</Badge>
                  </div>
                  <p className="text-small mt-1 text-text-secondary">ID: {currentMembership.membership_code}</p>
                </div>

                <div className="grid gap-4 p-4 sm:grid-cols-2">
                  <FieldRow icon={Calendar} label="Start Date">
                    <Value>{formatDate(currentMembership.start_date)}</Value>
                  </FieldRow>
                  <FieldRow icon={Calendar} label="End Date">
                    <Value>{formatDate(currentMembership.end_date)}</Value>
                  </FieldRow>
                  <FieldRow icon={CreditCard} label="Amount">
                    <Value>{formatAmount(currentMembership.amount)}</Value>
                  </FieldRow>
                  <FieldRow icon={CreditCard} label="Payment">
                    <Badge variant={(PAYMENT_STATUS[currentMembership.payment_status] ?? PAYMENT_STATUS.pending).variant}>
                      {(PAYMENT_STATUS[currentMembership.payment_status] ?? PAYMENT_STATUS.pending).label}
                    </Badge>
                  </FieldRow>
                </div>

                <div className="flex justify-end border-t border-info/15 px-1.5 py-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-brand hover:bg-brand/10 hover:text-brand"
                    render={<Link href={`/memberships/${currentMembership.id}`} />}
                    nativeButton={false}
                  >
                    View Membership
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-body text-text-secondary">No membership yet for this student.</p>
            )}
          </Panel>
        </div>
      </div>

      <Panel>
        <PanelHeader icon={ClipboardList} title="Recent Attendance" className="mb-4 min-h-8" />
        <EmptyState
          size="sm"
          title="No recent attendance yet"
          description="Attendance for this student will appear here once classes are marked."
        />
      </Panel>
    </div>
  );
}
