import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  CreditCard,
  History,
  IndianRupee,
  Layers,
  Phone,
  UserRound,
} from "lucide-react";
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

function formatDuration(startDate, endDate) {
  if (!startDate || !endDate) return "—";
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const days = Math.round((end - start) / 86400000) + 1;
  if (!Number.isFinite(days) || days < 1) return "—";
  if (days === 1) return "1 day";
  if (days < 60) return `${days} days`;
  const months = Math.round(days / 30);
  return months === 1 ? "~1 month" : `~${months} months`;
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

function statusMetricTone(status) {
  if (status === "active") return "success";
  if (status === "upcoming") return "info";
  if (status === "cancelled") return "warning";
  return "brand";
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
  const planLabel = PLAN_LABELS[membership.plan] ?? membership.plan;
  const statusLabel = STATUS_LABELS[membership.status] ?? membership.status;
  const paymentLabel = PAYMENT_LABELS[membership.payment_status] ?? membership.payment_status;
  const durationLabel = formatDuration(membership.start_date, membership.end_date);

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/memberships"
        className="text-body inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to Memberships
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
              <span className="flex size-16 shrink-0 items-center justify-center rounded-full border-2 border-brand/40 bg-brand/10 text-brand sm:size-[4.25rem]">
                <CreditCard className="size-6" aria-hidden="true" />
              </span>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-page-title font-semibold break-words text-brand">
                    {planLabel} Membership
                  </h1>
                  <Badge variant={STATUS_VARIANTS[membership.status]} className="px-1.5 py-0">
                    <span className="text-[10px] leading-[14px] font-medium">{statusLabel}</span>
                  </Badge>
                </div>
                <p className="text-small mt-1 text-text-secondary">ID: {membership.membership_code}</p>
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
              <CancelMembership membershipId={membership.id} isCancelled={membership.status === "cancelled"} />
              <Button
                size="sm"
                variant="outline"
                render={<Link href={`/memberships/${id}/renew`} />}
                nativeButton={false}
              >
                Renew
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-brand/30 bg-surface/80 text-brand hover:bg-brand/5 hover:text-brand"
                render={<Link href={`/memberships/${id}/edit`} />}
                nativeButton={false}
              >
                Edit Membership
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-2 gap-2 border-t border-border/50 bg-surface/50 px-3 py-2.5 sm:gap-2.5 sm:px-4 sm:py-3 lg:grid-cols-4">
          <MetricTile
            icon={CreditCard}
            value={statusLabel}
            label="Status"
            tone={statusMetricTone(membership.status)}
          />
          <MetricTile
            icon={IndianRupee}
            value={paymentLabel}
            label="Payment"
            tone={membership.payment_status === "paid" ? "success" : "warning"}
          />
          <MetricTile icon={Calendar} value={formatDate(membership.start_date)} label="Start" tone="info" />
          <MetricTile icon={Calendar} value={formatDate(membership.end_date)} label="End" tone="brand" />
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
          <Panel title="Membership Information" icon={CreditCard}>
            <div className="overflow-hidden rounded-xl border border-info/15 bg-info/5">
              <div className="bg-info/10 px-3.5 py-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-body font-semibold text-text-primary">{planLabel} Membership</p>
                  <Badge variant={STATUS_VARIANTS[membership.status]} className="px-1.5 py-0">
                    <span className="text-[10px] leading-[14px] font-medium">{statusLabel}</span>
                  </Badge>
                </div>
                <p className="text-small mt-1 text-text-secondary">ID: {membership.membership_code}</p>
              </div>

              <div className="grid grid-cols-2 gap-3 border-t border-info/10 px-3.5 py-3">
                <FieldRow icon={Calendar} label="Start Date">
                  <p className="truncate text-body font-semibold text-text-primary">
                    {formatDate(membership.start_date)}
                  </p>
                </FieldRow>
                <FieldRow icon={Calendar} label="End Date">
                  <p className="truncate text-body font-semibold text-text-primary">
                    {formatDate(membership.end_date)}
                  </p>
                </FieldRow>
                <FieldRow icon={Calendar} label="Duration">
                  <p className="truncate text-body font-semibold text-text-primary">{durationLabel}</p>
                </FieldRow>
                <FieldRow icon={IndianRupee} label="Amount">
                  <p className="truncate text-body font-semibold text-text-primary">
                    {formatAmount(membership.amount)}
                  </p>
                </FieldRow>
                <FieldRow icon={CreditCard} label="Payment">
                  <p className="truncate text-body font-semibold text-text-primary">{paymentLabel}</p>
                </FieldRow>
              </div>

              <div className="border-t border-info/10 px-3.5 py-2.5">
                <p className="text-small text-text-secondary">Notes</p>
                <p className="mt-1 text-body text-text-primary">{membership.notes || "No notes."}</p>
              </div>
            </div>
          </Panel>

          {student ? (
            <Panel
              title="Student"
              icon={UserRound}
              action={
                <Link
                  href={`/students/${student.id}`}
                  className="text-small font-medium text-brand hover:underline"
                >
                  View Student
                </Link>
              }
            >
              <div className="overflow-hidden rounded-xl border border-success/20 bg-success/5">
                <div className="flex items-start gap-3 bg-success/10 px-3.5 py-3.5">
                  <span
                    aria-hidden="true"
                    className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-small font-semibold text-brand"
                  >
                    {getInitials(student.full_name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-body font-semibold text-text-primary">{student.full_name}</p>
                    <p className="text-small mt-1 text-text-secondary">ID: {student.student_code}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 border-t border-success/15 px-3.5 py-3 sm:grid-cols-2">
                  <FieldRow icon={Phone} label="Phone">
                    <p className="truncate text-body font-semibold text-text-primary">{student.phone || "—"}</p>
                  </FieldRow>
                </div>
              </div>
            </Panel>
          ) : null}
        </div>

        <div className="flex flex-col gap-4">
          <Panel title="Covered Batch Enrollments" icon={Layers}>
            {coveredEnrollments.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-background/40 px-4 py-8 text-center">
                <span
                  aria-hidden="true"
                  className="flex size-10 items-center justify-center rounded-full bg-border/50 text-text-secondary"
                >
                  <Layers className="size-4" />
                </span>
                <p className="text-body font-medium text-text-primary">No overlapping enrollments</p>
                <p className="text-small max-w-sm text-text-secondary">
                  No batch enrollments overlap this membership&rsquo;s period.
                </p>
              </div>
            ) : (
              <ul className="flex flex-col gap-3">
                {coveredEnrollments.map((enrollment) => {
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

                      {enrollment.batches?.id ? (
                        <div className="flex justify-end border-t border-warning/15 px-3.5 py-2.5">
                          <Link
                            href={`/batches/${enrollment.batches.id}`}
                            className="text-small font-medium text-brand hover:underline"
                          >
                            View Batch
                          </Link>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel title="Membership History" icon={History}>
            {otherMemberships.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-background/40 px-4 py-8 text-center">
                <span
                  aria-hidden="true"
                  className="flex size-10 items-center justify-center rounded-full bg-border/50 text-text-secondary"
                >
                  <History className="size-4" />
                </span>
                <p className="text-body font-medium text-text-primary">No other memberships</p>
                <p className="text-small max-w-sm text-text-secondary">
                  No other membership records for this student.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                {otherMemberships.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex flex-col gap-2 bg-surface px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-body font-semibold text-text-primary">{entry.membership_code}</p>
                        <Badge variant={STATUS_VARIANTS[entry.status]} className="px-1.5 py-0">
                          <span className="text-[10px] leading-[14px] font-medium">
                            {STATUS_LABELS[entry.status]}
                          </span>
                        </Badge>
                      </div>
                      <p className="text-small mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-text-secondary">
                        <span className="inline-flex items-center gap-1">
                          <CreditCard className="size-3.5 shrink-0" aria-hidden="true" />
                          {PLAN_LABELS[entry.plan] ?? entry.plan}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="size-3.5 shrink-0" aria-hidden="true" />
                          {formatDate(entry.start_date)} – {formatDate(entry.end_date)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1">
                          <IndianRupee className="size-3.5 shrink-0" aria-hidden="true" />
                          {formatAmount(entry.amount)}
                        </span>
                      </p>
                    </div>
                    <Link
                      href={`/memberships/${entry.id}`}
                      className="text-small shrink-0 font-medium text-brand hover:underline sm:self-center"
                    >
                      View
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
