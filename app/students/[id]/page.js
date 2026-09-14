import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  ClipboardList,
  Clock,
  CreditCard,
  Layers,
  Mail,
  Phone,
  Plus,
  UserRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getStudent } from "@/lib/students/data";
import {
  listEnrollmentsForStudent,
  listScheduleAssignmentsForEnrollment,
  isScheduleAssignmentActive,
} from "@/lib/enrollments/data";
import { DAY_LABELS } from "@/lib/schedules/validation";
import { getCurrentMembershipForStudent } from "@/lib/memberships/data";
import DeactivateStudent from "@/app/students/[id]/deactivate-student";

const SUCCESS_MESSAGES = {
  updated: "Student updated successfully.",
  enrollment_added: "Batch enrollment added successfully.",
  enrollment_updated: "Batch enrollment updated successfully.",
  membership_added: "Membership added successfully.",
};

const PLAN_LABELS = { monthly: "Monthly", quarterly: "Quarterly", custom: "Custom duration" };
const MEMBERSHIP_STATUS_LABELS = {
  upcoming: "Upcoming",
  active: "Active",
  expired: "Expired",
  cancelled: "Cancelled",
};
const MEMBERSHIP_STATUS_VARIANTS = {
  upcoming: "default",
  active: "success",
  expired: "neutral",
  cancelled: "danger",
};

function formatAmount(value) {
  return `₹${Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getInitials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0].toUpperCase();

  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function MetricTile({ icon: Icon, value, label, tone }) {
  const tones = {
    warning: "border-warning/20 bg-warning/10 text-warning",
    info: "border-info/20 bg-info/10 text-info",
    success: "border-success/20 bg-success/10 text-success",
    brand: "border-brand/20 bg-brand/10 text-brand",
  };

  return (
    <div className={`flex min-w-0 items-center gap-2.5 rounded-xl border px-3 py-2.5 ${tones[tone] ?? tones.brand}`}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface/80 shadow-xs">
        <Icon className="size-3.5" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-[10px] leading-[14px] font-medium tracking-wide text-text-secondary uppercase">
          {label}
        </p>
        <p className="truncate text-body font-semibold tracking-tight text-text-primary">{value}</p>
      </div>
    </div>
  );
}

function Panel({ title, icon: Icon, action, children }) {
  return (
    <section className="rounded-card border border-border bg-surface p-4 shadow-xs sm:p-5">
      {(title || action) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title ? (
            <h2 className="flex items-center gap-2 text-body font-semibold text-text-primary">
              {Icon ? <Icon className="size-4 text-text-secondary" aria-hidden="true" /> : null}
              {title}
            </h2>
          ) : (
            <span />
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** Icon + label on one row; value starts at the icon's left edge. */
function FieldRow({ icon: Icon, label, children }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <Icon className="size-3.5 shrink-0 text-text-secondary" aria-hidden="true" />
        <p className="text-small text-text-secondary">{label}</p>
      </div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function formatTime(value) {
  if (!value) return "—";
  const [hours, minutes] = value.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${period}`;
}

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
 * Student Details (wireframe p10) — a single page, not tabs (02-ux.md,
 * "Student Details is a single page, not tabs" — settled explicitly to
 * resolve the earlier IA/wireframe conflict). Four panels: Profile/Contact,
 * Membership, Batch Enrollments, Recent Attendance.
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
  const membershipLabel = currentMembership
    ? (MEMBERSHIP_STATUS_LABELS[currentMembership.status] ?? currentMembership.status)
    : "None";
  const isActive = student.status === "active";

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/students"
        className="text-body inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to Students
      </Link>

      <div className="overflow-hidden rounded-2xl border border-border/70 bg-gradient-to-br from-info/10 via-surface to-brand/10 shadow-xs">
        <section className="relative p-4 sm:p-5">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-8 -right-6 size-32 rounded-full border border-info/20"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-8 right-12 size-16 rounded-full border border-brand/20"
          />

          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3 sm:gap-4">
              <span className="flex size-16 shrink-0 items-center justify-center rounded-full border-2 border-brand/40 bg-brand/10 text-body font-semibold text-brand sm:size-[4.25rem]">
                {getInitials(student.full_name)}
              </span>

              <div className="min-w-0">
                <h1 className="text-page-title font-semibold break-words text-brand">{student.full_name}</h1>
                <p className="text-small mt-1 text-text-secondary">ID: {student.student_code}</p>
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
              <Button
                size="sm"
                variant="outline"
                className="border-brand/30 bg-surface/80 text-brand hover:bg-brand/5 hover:text-brand"
                render={<Link href={`/students/${student.id}/edit`} />}
                nativeButton={false}
              >
                Edit Student
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Button>
              <DeactivateStudent studentId={student.id} studentName={student.full_name} status={student.status} />
            </div>
          </div>
        </section>

        <div className="grid grid-cols-2 gap-2 border-t border-border/50 bg-surface/50 px-3 py-2.5 sm:gap-2.5 sm:px-4 sm:py-3 lg:grid-cols-4">
          <MetricTile icon={Layers} value={activeEnrollmentCount} label="Enrollments" tone="warning" />
          <MetricTile icon={CreditCard} value={membershipLabel} label="Membership" tone="info" />
          <MetricTile
            icon={UserRound}
            value={isActive ? "Active" : "Inactive"}
            label="Status"
            tone={isActive ? "success" : "warning"}
          />
          <MetricTile icon={Calendar} value={formatDate(student.join_date)} label="Joined" tone="brand" />
        </div>
      </div>

      {message ? (
        <div
          role="status"
          className="rounded-input border border-success/30 bg-success/5 px-3 py-2 text-body text-success"
        >
          {message}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Panel title="Profile" icon={UserRound}>
            <div className="overflow-hidden rounded-xl border border-success/20 bg-success/5">
              <div className="flex items-start gap-3 bg-success/10 px-3.5 py-3.5">
                {student.photo_url ? (
                  <img
                    src={student.photo_url}
                    alt=""
                    className="size-10 shrink-0 rounded-lg object-cover"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-small font-semibold text-brand"
                  >
                    {getInitials(student.full_name)}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-body font-semibold text-text-primary">{student.full_name}</p>
                    <Badge variant={isActive ? "success" : "danger"} className="px-1.5 py-0">
                      <span className="text-[10px] leading-[14px] font-medium">
                        {isActive ? "Active" : "Inactive"}
                      </span>
                    </Badge>
                  </div>
                  <p className="text-small mt-1 text-text-secondary">ID: {student.student_code}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 border-t border-success/15 px-3.5 py-3">
                <FieldRow icon={Phone} label="Phone">
                  <p className="truncate text-body font-semibold text-text-primary">{student.phone || "—"}</p>
                </FieldRow>
                <FieldRow icon={Mail} label="Email">
                  <p className="truncate text-body font-semibold text-text-primary">{student.email || "—"}</p>
                </FieldRow>
                <FieldRow icon={Calendar} label="Join Date">
                  <p className="truncate text-body font-semibold text-text-primary">{formatDate(student.join_date)}</p>
                </FieldRow>
                <FieldRow icon={Calendar} label="Date of Birth">
                  <p className="truncate text-body font-semibold text-text-primary">
                    {student.date_of_birth ? formatDate(student.date_of_birth) : "—"}
                  </p>
                </FieldRow>
                <FieldRow icon={UserRound} label="Gender">
                  <p className="truncate text-body font-semibold capitalize text-text-primary">
                    {student.gender || "—"}
                  </p>
                </FieldRow>
              </div>

              {student.notes ? (
                <div className="border-t border-success/15 px-3.5 py-2.5">
                  <p className="text-small text-text-secondary">Notes</p>
                  <p className="mt-1 text-body text-text-primary">{student.notes}</p>
                </div>
              ) : null}
            </div>
          </Panel>

          <Panel
            title="Membership"
            icon={CreditCard}
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
          >
            {currentMembership ? (
              <div className="overflow-hidden rounded-xl border border-info/15 bg-info/5">
                <div className="bg-info/10 px-3.5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-body font-semibold text-text-primary">
                        {PLAN_LABELS[currentMembership.plan] ?? currentMembership.plan} Membership
                      </p>
                      <Badge variant={MEMBERSHIP_STATUS_VARIANTS[currentMembership.status]} className="px-1.5 py-0">
                        <span className="text-[10px] leading-[14px] font-medium">
                          {MEMBERSHIP_STATUS_LABELS[currentMembership.status]}
                        </span>
                      </Badge>
                    </div>
                    <p className="text-small mt-1 text-text-secondary">ID: {currentMembership.membership_code}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 border-t border-info/10 px-3.5 py-3">
                  <FieldRow icon={Calendar} label="Start Date">
                    <p className="truncate text-body font-semibold text-text-primary">
                      {formatDate(currentMembership.start_date)}
                    </p>
                  </FieldRow>
                  <FieldRow icon={Calendar} label="End Date">
                    <p className="truncate text-body font-semibold text-text-primary">
                      {formatDate(currentMembership.end_date)}
                    </p>
                  </FieldRow>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-info/10 px-3.5 py-2.5">
                  <p className="text-small text-text-secondary">
                    Amount: {formatAmount(currentMembership.amount)} · Payment:{" "}
                    {currentMembership.payment_status === "paid" ? "Paid" : "Pending"}
                  </p>
                  <Link
                    href={`/memberships/${currentMembership.id}`}
                    className="text-small font-medium text-brand hover:underline"
                  >
                    View Membership
                  </Link>
                </div>
              </div>
            ) : (
              <p className="text-body text-text-secondary">No membership yet for this student.</p>
            )}
          </Panel>
        </div>

        <div className="flex flex-col gap-4">
          <Panel
            title="Batch Enrollments"
            icon={Layers}
            action={
              <Button size="sm" render={<Link href={`/students/${student.id}/enrollments/new`} />} nativeButton={false}>
                <Plus className="size-4" aria-hidden="true" />
                Add Enrollment
              </Button>
            }
          >
            {enrollments.length === 0 ? (
              <p className="text-body text-text-secondary">
                No batch enrollments yet. Add one to make this student eligible for attendance.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {enrollments.map((enrollment) => {
                  const activeAssignments = (assignmentsByEnrollmentId.get(enrollment.id) ?? []).filter(
                    (assignment) => isScheduleAssignmentActive(assignment)
                  );
                  const batchCode = enrollment.batches?.code ?? "—";
                  const isEnrollmentActive = enrollment.status === "active";

                  return (
                    <li
                      key={enrollment.id}
                      className="overflow-hidden rounded-xl border border-warning/20 bg-warning/5"
                    >
                      <div className="flex items-start gap-3 bg-warning/10 px-3.5 py-3.5">
                        <span
                          aria-hidden="true"
                          className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-warning/15 text-small font-semibold text-warning"
                        >
                          {batchCode}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-body font-semibold text-text-primary">
                              {enrollment.batches?.name ?? "Unknown batch"}
                            </p>
                            <Badge
                              variant={isEnrollmentActive ? "success" : "danger"}
                              className="px-1.5 py-0"
                            >
                              <span className="text-[10px] leading-[14px] font-medium">
                                {isEnrollmentActive ? "Active" : "Inactive"}
                              </span>
                            </Badge>
                          </div>
                          <p className="text-small mt-1 text-text-secondary">Code: {batchCode}</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3 border-t border-warning/15 px-3.5 py-3">
                        <FieldRow icon={Calendar} label="Start Date">
                          <p className="truncate text-body font-semibold text-text-primary">
                            {formatDate(enrollment.effective_start_date)}
                          </p>
                        </FieldRow>
                        <FieldRow icon={Calendar} label="End Date">
                          <p className="truncate text-body font-semibold text-text-primary">
                            {enrollment.effective_end_date
                              ? formatDate(enrollment.effective_end_date)
                              : "Present"}
                          </p>
                        </FieldRow>
                      </div>

                      <div className="border-t border-warning/15 px-3.5 py-2.5">
                        <FieldRow icon={Clock} label="Schedules">
                          {activeAssignments.length === 0 ? (
                            <p className="text-small font-medium text-danger">
                              No schedule assigned — this enrollment is not eligible for attendance.
                            </p>
                          ) : (
                            <ul className="flex flex-col gap-2.5">
                              {activeAssignments.map((assignment) => {
                                const instructorName = assignment.schedule?.instructors?.full_name ?? null;
                                const instructorPhoto = assignment.schedule?.instructors?.photo_url ?? null;

                                return (
                                  <li key={assignment.id} className="min-w-0">
                                    {assignment.schedule ? (
                                      <>
                                        <p className="text-small font-medium text-text-primary">
                                          {DAY_LABELS[assignment.schedule.day_of_week] ??
                                            assignment.schedule.day_of_week}
                                          {" · "}
                                          {formatTime(assignment.schedule.start_time)} –{" "}
                                          {formatTime(assignment.schedule.end_time)}
                                        </p>
                                        <div className="mt-1.5 flex min-w-0 items-center gap-1.5">
                                          {instructorPhoto ? (
                                            <img
                                              src={instructorPhoto}
                                              alt=""
                                              className="size-5 shrink-0 rounded-full object-cover"
                                            />
                                          ) : (
                                            <span
                                              aria-hidden="true"
                                              className="flex size-5 shrink-0 items-center justify-center rounded-full bg-border/60 text-[10px] font-semibold leading-none text-text-secondary"
                                            >
                                              {instructorName ? getInitials(instructorName) : "?"}
                                            </span>
                                          )}
                                          <span className="truncate text-small text-text-secondary">
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

                      <div className="flex justify-end border-t border-warning/15 px-3.5 py-2.5">
                        <Link
                          href={`/students/${student.id}/enrollments/${enrollment.id}/edit`}
                          className="text-small font-medium text-brand hover:underline"
                        >
                          Edit Enrollment
                        </Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel title="Recent Attendance" icon={ClipboardList}>
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-background/40 px-4 py-8 text-center">
              <span
                aria-hidden="true"
                className="flex size-10 items-center justify-center rounded-full bg-border/50 text-text-secondary"
              >
                <ClipboardList className="size-4" />
              </span>
              <p className="text-body font-medium text-text-primary">No recent attendance yet</p>
              <p className="text-small max-w-sm text-text-secondary">
                Attendance for this student will appear here once classes are marked.
              </p>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
