import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getMembership, listMembershipsForStudent, listCoveredEnrollments } from "@/lib/memberships/data";
import CancelMembership from "@/app/memberships/[id]/cancel-membership";

const SUCCESS_MESSAGES = {
  created: "Membership created successfully.",
  updated: "Membership updated successfully.",
  renewed: "Membership renewed successfully.",
};

const PLAN_LABELS = { monthly: "Monthly", quarterly: "Quarterly", custom: "Custom duration" };
const PAYMENT_LABELS = { paid: "Paid", pending: "Pending" };
const STATUS_LABELS = { upcoming: "Upcoming", active: "Active", expired: "Expired", cancelled: "Cancelled" };
const STATUS_VARIANTS = { upcoming: "default", active: "success", expired: "neutral", cancelled: "danger" };

function formatDate(value) {
  if (!value) return "—";
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatAmount(value) {
  return `₹${Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Membership Details (composed screen — 02-ux.md "Composed Membership
 * screens": no dedicated approved wireframe, built from the same panelled
 * layout as Student Details). Membership Information, a read-only Student
 * panel, Covered Batch Enrollments (derived, never stored —
 * 01-product.md §12), and Membership History (the student's other
 * memberships — renewal always creates a new record, the previous one
 * remains here, never overwritten).
 */
export default async function MembershipDetailsPage({ params, searchParams }) {
  // Authorization boundary — see app/memberships/layout.js for why this must
  // be repeated here rather than relying on the layout alone.
  await requireRole(ROLES.ADMIN);

  const { id } = await params;
  const membership = await getMembership(id);

  if (!membership) {
    notFound();
  }

  const [history, coveredEnrollments] = await Promise.all([
    listMembershipsForStudent(membership.student_id),
    listCoveredEnrollments(membership),
  ]);
  const otherMemberships = history.filter((entry) => entry.id !== id);

  const rawParams = await searchParams;
  const message = SUCCESS_MESSAGES[rawParams?.success] ?? null;

  const student = membership.students;

  return (
    <div>
      <Link
        href="/memberships"
        className="text-body inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to Memberships
      </Link>

      <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-page-title font-semibold text-text-primary">Membership Details</h1>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <p className="text-section-title font-semibold text-text-primary">{membership.membership_code}</p>
            <Badge variant={STATUS_VARIANTS[membership.status]}>{STATUS_LABELS[membership.status]}</Badge>
          </div>
        </div>

        <div className="flex flex-wrap items-start gap-3">
          <CancelMembership membershipId={membership.id} isCancelled={membership.status === "cancelled"} />
          <Button variant="outline" render={<Link href={`/memberships/${id}/renew`} />} nativeButton={false}>
            Renew Membership
          </Button>
          <Button render={<Link href={`/memberships/${id}/edit`} />} nativeButton={false}>
            Edit Membership
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
          {/* Membership Information */}
          <div className="rounded-card border border-border bg-surface p-6 shadow-xs">
            <h2 className="text-section-title font-semibold text-text-primary">Membership Information</h2>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4">
              <div>
                <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">Plan</dt>
                <dd className="text-body text-text-primary">{PLAN_LABELS[membership.plan] ?? membership.plan}</dd>
              </div>
              <div>
                <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">Amount</dt>
                <dd className="text-body text-text-primary">{formatAmount(membership.amount)}</dd>
              </div>
              <div>
                <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">Start Date</dt>
                <dd className="text-body text-text-primary">{formatDate(membership.start_date)}</dd>
              </div>
              <div>
                <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">End Date</dt>
                <dd className="text-body text-text-primary">{formatDate(membership.end_date)}</dd>
              </div>
              <div>
                <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">
                  Payment Status
                </dt>
                <dd className="text-body text-text-primary">
                  {PAYMENT_LABELS[membership.payment_status] ?? membership.payment_status}
                </dd>
              </div>
            </dl>
            <div className="mt-4">
              <h3 className="text-small font-medium tracking-wide text-text-secondary uppercase">Notes</h3>
              <p className="text-body mt-1 text-text-primary">{membership.notes || "No notes."}</p>
            </div>
          </div>

          {/* Student */}
          {student ? (
            <div className="rounded-card border border-border bg-surface p-6 shadow-xs">
              <div className="flex items-center justify-between">
                <h2 className="text-section-title font-semibold text-text-primary">Student</h2>
                <Link
                  href={`/students/${student.id}`}
                  className="text-body font-medium text-brand hover:underline"
                >
                  View Student
                </Link>
              </div>
              <p className="text-body mt-2 font-medium text-text-primary">{student.full_name}</p>
              <p className="text-small text-text-secondary">{student.student_code}</p>
              {student.phone ? <p className="text-body mt-1 text-text-secondary">{student.phone}</p> : null}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-6">
          {/* Covered Batch Enrollments — derived, read-only */}
          <div className="rounded-card border border-border bg-surface p-6 shadow-xs">
            <h2 className="text-section-title font-semibold text-text-primary">Covered Batch Enrollments</h2>
            {coveredEnrollments.length === 0 ? (
              <p className="text-body mt-4 text-text-secondary">
                No batch enrollments overlap this membership&rsquo;s period.
              </p>
            ) : (
              <ul className="mt-4 flex flex-col gap-3">
                {coveredEnrollments.map((enrollment) => (
                  <li key={enrollment.id} className="rounded-lg border border-border p-4">
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
                          </span>{" "}
                          · {formatDate(enrollment.effective_start_date)} –{" "}
                          {enrollment.effective_end_date ? formatDate(enrollment.effective_end_date) : "Present"}
                        </p>
                      </div>
                      {enrollment.batches?.id ? (
                        <Link
                          href={`/batches/${enrollment.batches.id}`}
                          className="text-body font-medium text-brand hover:underline"
                        >
                          View Batch
                        </Link>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Membership History */}
          <div className="rounded-card border border-border bg-surface p-6 shadow-xs">
            <h2 className="text-section-title font-semibold text-text-primary">Membership History</h2>
            {otherMemberships.length === 0 ? (
              <p className="text-body mt-4 text-text-secondary">No other membership records for this student.</p>
            ) : (
              <ul className="mt-4 flex flex-col gap-3">
                {otherMemberships.map((entry) => (
                  <li key={entry.id} className="rounded-lg border border-border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-body font-medium text-text-primary">{entry.membership_code}</p>
                          <Badge variant={STATUS_VARIANTS[entry.status]}>{STATUS_LABELS[entry.status]}</Badge>
                        </div>
                        <p className="text-small mt-1 text-text-secondary">
                          {PLAN_LABELS[entry.plan] ?? entry.plan} · {formatDate(entry.start_date)} –{" "}
                          {formatDate(entry.end_date)} · {formatAmount(entry.amount)}
                        </p>
                      </div>
                      <Link
                        href={`/memberships/${entry.id}`}
                        className="text-body font-medium text-brand hover:underline"
                      >
                        View
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
