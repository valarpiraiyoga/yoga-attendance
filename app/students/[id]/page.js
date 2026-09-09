import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Plus, Mail, Phone, Calendar } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getStudent } from "@/lib/students/data";
import { listEnrollmentsForStudent } from "@/lib/enrollments/data";
import { getCurrentMembershipForStudent } from "@/lib/memberships/data";
import DeactivateStudent from "@/app/students/[id]/deactivate-student";

const SUCCESS_MESSAGES = {
  updated: "Student updated successfully.",
  enrollment_added: "Batch enrollment added successfully.",
  enrollment_updated: "Batch enrollment updated successfully.",
  membership_added: "Membership added successfully.",
};

const PLAN_LABELS = { monthly: "Monthly", quarterly: "Quarterly", custom: "Custom duration" };
const MEMBERSHIP_STATUS_LABELS = { upcoming: "Upcoming", active: "Active", expired: "Expired", cancelled: "Cancelled" };
const MEMBERSHIP_STATUS_VARIANTS = { upcoming: "default", active: "success", expired: "neutral", cancelled: "danger" };

function formatAmount(value) {
  return `₹${Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getInitials(name) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
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
 *
 * Membership and Batch Enrollments are real, live data (Phase 12 and Phase
 * 11 respectively). Recent Attendance still shows an honest "not available
 * yet" state — that panel is Phase 15.
 */
export default async function StudentDetailsPage({ params, searchParams }) {
  // Authorization boundary — see app/students/layout.js for why this must be
  // repeated here rather than relying on the layout alone.
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
  const rawParams = await searchParams;
  const message = SUCCESS_MESSAGES[rawParams?.success] ?? null;

  return (
    <div>
      <Link
        href="/students"
        className="text-body inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to Students
      </Link>

      <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-page-title font-semibold text-text-primary">Student Details</h1>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <p className="text-section-title font-semibold text-text-primary">{student.full_name}</p>
            <Badge variant={student.status === "active" ? "success" : "danger"}>
              {student.status === "active" ? "Active" : "Inactive"}
            </Badge>
          </div>
        </div>

        <div className="flex flex-wrap items-start gap-3">
          <DeactivateStudent studentId={student.id} studentName={student.full_name} status={student.status} />
          <Button render={<Link href={`/students/${student.id}/edit`} />} nativeButton={false}>
            Edit Student
          </Button>
        </div>
      </div>

      {message ? (
        <div
          role="status"
          className="mt-4 rounded-input border border-success/30 bg-success/5 px-3 py-2 text-body text-success"
        >
          {message}
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          {/* Profile / Contact */}
          <div className="rounded-card border border-border bg-surface p-6 shadow-xs">
            <div className="flex items-center gap-3 border-b border-border pb-4">
              <span
                aria-hidden="true"
                className="flex size-12 shrink-0 items-center justify-center rounded-full bg-background text-body font-semibold text-brand"
              >
                {getInitials(student.full_name)}
              </span>
              <div>
                <p className="text-body font-semibold text-text-primary">{student.full_name}</p>
                <p className="text-small text-text-secondary">ID: {student.student_code}</p>
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-3">
              <h3 className="text-small font-medium tracking-wide text-text-secondary uppercase">
                Contact Info
              </h3>
              <p className="flex items-center gap-2 text-body text-text-primary">
                <Phone className="size-4 text-text-secondary" aria-hidden="true" />
                {student.phone}
              </p>
              {student.email ? (
                <p className="flex items-center gap-2 text-body text-text-primary">
                  <Mail className="size-4 text-text-secondary" aria-hidden="true" />
                  {student.email}
                </p>
              ) : null}
            </div>

            <div className="mt-4 flex flex-col gap-3">
              <h3 className="text-small font-medium tracking-wide text-text-secondary uppercase">
                Account Details
              </h3>
              <p className="flex items-center gap-2 text-body text-text-primary">
                <Calendar className="size-4 text-text-secondary" aria-hidden="true" />
                Join Date: {formatDate(student.join_date)}
              </p>
              {student.date_of_birth ? (
                <p className="text-body text-text-secondary">
                  Date of Birth: {formatDate(student.date_of_birth)}
                </p>
              ) : null}
              {student.gender ? (
                <p className="text-body text-text-secondary capitalize">Gender: {student.gender}</p>
              ) : null}
              {student.notes ? (
                <p className="text-body text-text-secondary">Notes: {student.notes}</p>
              ) : null}
            </div>
          </div>

          {/* Membership — Phase 12, real data */}
          <div className="rounded-card border border-border bg-surface p-6 shadow-xs">
            <div className="flex items-center justify-between">
              <h2 className="text-section-title font-semibold text-text-primary">Membership</h2>
              <Button
                variant="outline"
                size="sm"
                render={<Link href={`/students/${student.id}/memberships/new`} />}
                nativeButton={false}
              >
                <Plus className="size-4" aria-hidden="true" />
                Add Membership
              </Button>
            </div>

            {currentMembership ? (
              <div className="mt-4">
                <div className="flex items-center gap-2">
                  <p className="text-body font-medium text-text-primary">
                    {PLAN_LABELS[currentMembership.plan] ?? currentMembership.plan} Membership
                  </p>
                  <Badge variant={MEMBERSHIP_STATUS_VARIANTS[currentMembership.status]}>
                    {MEMBERSHIP_STATUS_LABELS[currentMembership.status]}
                  </Badge>
                </div>
                <p className="text-small mt-1 text-text-secondary">ID: {currentMembership.membership_code}</p>
                <p className="text-small mt-2 text-text-secondary">
                  Validity: {formatDate(currentMembership.start_date)} – {formatDate(currentMembership.end_date)}
                </p>
                <p className="text-small text-text-secondary">
                  Amount: {formatAmount(currentMembership.amount)} · Payment:{" "}
                  {currentMembership.payment_status === "paid" ? "Paid" : "Pending"}
                </p>
                <Link
                  href={`/memberships/${currentMembership.id}`}
                  className="text-body mt-2 inline-block font-medium text-brand hover:underline"
                >
                  View Membership
                </Link>
              </div>
            ) : (
              <p className="text-body mt-2 text-text-secondary">No membership yet for this student.</p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-6">
          {/* Batch Enrollments — Phase 11, real data */}
          <div className="rounded-card border border-border bg-surface p-6 shadow-xs">
            <div className="flex items-center justify-between">
              <h2 className="text-section-title font-semibold text-text-primary">Batch Enrollments</h2>
              <Button
                size="sm"
                render={<Link href={`/students/${student.id}/enrollments/new`} />}
                nativeButton={false}
              >
                <Plus className="size-4" aria-hidden="true" />
                Add Enrollment
              </Button>
            </div>

            {enrollments.length === 0 ? (
              <p className="text-body mt-4 text-text-secondary">
                No batch enrollments yet. Add one to make this student eligible for attendance.
              </p>
            ) : (
              <ul className="mt-4 flex flex-col gap-3">
                {enrollments.map((enrollment) => (
                  <li
                    key={enrollment.id}
                    className="rounded-lg border border-border p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{enrollment.batches?.code ?? "—"}</Badge>
                          <p className="text-body font-medium text-text-primary">
                            {enrollment.batches?.name ?? "Unknown batch"}
                          </p>
                        </div>
                        <p className="text-small mt-1 text-text-secondary">
                          Enrollment:{" "}
                          <span className={enrollment.status === "active" ? "text-success" : "text-danger"}>
                            {enrollment.status === "active" ? "Active" : "Inactive"}
                          </span>
                        </p>
                        <p className="text-small text-text-secondary">
                          Effective: {formatDate(enrollment.effective_start_date)} –{" "}
                          {enrollment.effective_end_date ? formatDate(enrollment.effective_end_date) : "Present"}
                        </p>
                      </div>
                      <Link
                        href={`/students/${student.id}/enrollments/${enrollment.id}/edit`}
                        className="text-body font-medium text-brand hover:underline"
                      >
                        Edit
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Recent Attendance — Phase 15 */}
          <div className="rounded-card border border-border bg-surface p-6 shadow-xs">
            <h2 className="text-section-title font-semibold text-text-primary">Recent Attendance</h2>
            <p className="text-body mt-2 text-text-secondary">
              Not available yet — attendance is part of a later phase.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
