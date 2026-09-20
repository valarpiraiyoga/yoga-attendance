import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CircleCheck,
  FileText,
  Hash,
  History,
  IndianRupee,
  Layers,
  Mail,
  Pencil,
  Phone,
  RefreshCw,
  Tag,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/ui/avatar";
import EmptyState from "@/components/ui/empty-state";
import Progress from "@/components/ui/progress";
import { StatTile, StatTileGroup } from "@/components/ui/stat-tile";
import { EntityDetailHeader } from "@/components/layout/EntityDetailHeader";
import FieldRow from "@/components/layout/FieldRow";
import { Panel, PanelHeader } from "@/components/layout/Panel";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getMembership, listMembershipsForStudent, listCoveredEnrollments } from "@/lib/memberships/data";
import { getMembershipValidity, getValidityLabel } from "@/lib/memberships/validity";
import { todayDateString } from "@/lib/schedules/validation";
import { formatAmount, formatDate, formatDateShort } from "@/lib/format";
import { MEMBERSHIP_STATUS, PAYMENT_STATUS, PLAN } from "@/lib/status";
import CancelMembership from "@/app/memberships/[id]/cancel-membership";
import CoveredEnrollmentRow from "@/app/memberships/[id]/covered-enrollment-row";
import MembershipHistoryRow from "@/app/memberships/[id]/membership-history-row";

const SUCCESS_MESSAGES = {
  created: "Membership created successfully.",
  updated: "Membership updated successfully.",
  renewed: "Membership renewed successfully.",
};

function FieldValue({ children }) {
  return <p className="text-body font-medium break-words text-text-primary">{children}</p>;
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

/** `Sep 1 – Sep 30, 2026` within a year; both years shown when the period crosses one. */
function formatPeriod(startDate, endDate) {
  if (!startDate || !endDate) return "—";
  return startDate.slice(0, 4) === endDate.slice(0, 4)
    ? `${formatDateShort(startDate)} – ${formatDate(endDate)}`
    : `${formatDate(startDate)} – ${formatDate(endDate)}`;
}

/** Validity bar colour, as on the Memberships list: red once Expired, orange while payment is Pending, else green. */
function validityTone(membership, validity) {
  if (validity.status === "expired") return "danger";
  if (membership.payment_status === "pending") return "warning";
  return "success";
}

/** Days used so far, from the same reading the list's progress bar uses (`getMembershipValidity`). */
function usedDays(validity) {
  if (validity.status === "active") return validity.totalDays - validity.daysLeft;
  if (validity.status === "expired") return validity.totalDays;
  return 0;
}

/**
 * The header's Days Progress card. The headline is the same validity text the
 * tile and the Memberships list show; the figure beside it is the share used
 * once the membership has begun, and the start date while it is still
 * Upcoming (where "0% used" says nothing). Bar colours and calculations are
 * unchanged.
 */
function DaysProgress({ membership, validity, validityLabel, used }) {
  const isUpcoming = validity.status === "upcoming";

  return (
    <div className="w-full rounded-lg border border-border bg-background/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-small text-text-secondary">Days Progress</p>
        <p className="text-small shrink-0 font-medium text-text-secondary">
          {isUpcoming ? `Starts ${formatDate(membership.start_date)}` : `${validity.percentUsed}% used`}
        </p>
      </div>
      <p
        className={
          validityLabel.tone === "danger"
            ? "text-page-title mt-1 font-semibold text-danger"
            : "text-page-title mt-1 font-semibold text-text-primary"
        }
      >
        {validityLabel.text}
      </p>
      <Progress
        className="mt-3"
        value={validity.percentUsed}
        tone={validityTone(membership, validity)}
        label="Membership validity used"
      />
      <div className="text-small mt-2 flex items-center justify-between gap-3 text-text-secondary">
        <span>{isUpcoming ? "Not started yet" : `Used ${used} of ${validity.totalDays} days`}</span>
        <span>{validity.totalDays} total days</span>
      </div>
    </div>
  );
}

/**
 * Membership Details (composed screen — 02-ux.md "Composed Membership
 * screens": no dedicated approved wireframe, built from the same panelled
 * layout as Student Details, so no tabs). The header carries the student's
 * identity and contact details, the membership's own facts and its Days
 * Progress; below it the summary tiles, Covered Batch Enrollments (derived,
 * never stored — 01-product.md §12), Membership History (the student's other
 * memberships — renewal always creates a new record, the previous one remains
 * here, never overwritten), and the membership's notes.
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
  const status = MEMBERSHIP_STATUS[membership.status] ?? { label: membership.status, variant: "neutral" };
  const payment = PAYMENT_STATUS[membership.payment_status] ?? PAYMENT_STATUS.pending;
  const planLabel = PLAN[membership.plan] ?? membership.plan;
  const durationLabel = formatDuration(membership.start_date, membership.end_date);
  const period = formatPeriod(membership.start_date, membership.end_date);

  // The same "today" the Memberships list derived each row's status and validity from.
  const validity = getMembershipValidity(membership, todayDateString());
  const validityLabel = getValidityLabel(validity);
  const showProgress = validity.status !== "cancelled";
  const used = usedDays(validity);

  // Status tile caption — the date that closed or will close the membership, from its own record.
  const statusCaption =
    membership.status === "cancelled"
      ? membership.cancelled_at
        ? `Cancelled ${formatDate(String(membership.cancelled_at).slice(0, 10))}`
        : "Cancelled"
      : membership.status === "expired"
        ? `Ended ${formatDate(membership.end_date)}`
        : `Ends ${formatDate(membership.end_date)}`;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/memberships"
        className="text-body inline-flex w-fit items-center gap-1.5 text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to Memberships
      </Link>

      <div className="flex flex-col gap-4">
        <EntityDetailHeader
          className="mb-0"
          avatar={<Avatar name={student?.full_name} size="lg" />}
          title={student?.full_name ?? "—"}
          status={<Badge variant={status.variant}>{status.label}</Badge>}
          subMeta={
            <>
              <span className="inline-flex items-center gap-1.5">
                <Hash className="size-3.5 shrink-0" aria-hidden="true" />
                Student ID: {student?.student_code ?? "—"}
              </span>
              {student?.phone ? (
                <span className="inline-flex items-center gap-1.5">
                  <Phone className="size-3.5 shrink-0" aria-hidden="true" />
                  {student.phone}
                </span>
              ) : null}
              {student?.email ? (
                <span className="inline-flex max-w-full min-w-0 items-center gap-1.5">
                  <Mail className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 break-all">{student.email}</span>
                </span>
              ) : null}
              {student ? (
                <Link
                  href={`/students/${student.id}`}
                  className="inline-flex items-center gap-1 font-medium text-brand hover:underline"
                >
                  View Student
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </Link>
              ) : null}
            </>
          }
          actions={
            <>
              <Button variant="outline" render={<Link href={`/memberships/${id}/renew`} />} nativeButton={false}>
                <RefreshCw className="size-4" aria-hidden="true" />
                Renew
              </Button>
              <Button variant="outline" render={<Link href={`/memberships/${id}/edit`} />} nativeButton={false}>
                <Pencil className="size-4" aria-hidden="true" />
                Edit Membership
              </Button>
              <CancelMembership membershipId={membership.id} isCancelled={membership.status === "cancelled"} />
            </>
          }
          highlight={
            <div className="grid w-full gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
              <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
                <FieldRow icon={Hash} label="Membership ID">
                  <FieldValue>{membership.membership_code}</FieldValue>
                </FieldRow>
                <FieldRow icon={Tag} label="Plan">
                  <FieldValue>{planLabel}</FieldValue>
                </FieldRow>
                <FieldRow icon={CalendarDays} label="Start Date">
                  <FieldValue>{formatDate(membership.start_date)}</FieldValue>
                </FieldRow>
                <FieldRow icon={CalendarDays} label="End Date">
                  <FieldValue>{formatDate(membership.end_date)}</FieldValue>
                </FieldRow>
              </div>
              {showProgress ? (
                <DaysProgress membership={membership} validity={validity} validityLabel={validityLabel} used={used} />
              ) : null}
            </div>
          }
        />

        <StatTileGroup ariaLabel="Membership summary" className="grid-cols-1 sm:grid-cols-2">
          <StatTile icon={Tag} label="Plan" value={planLabel} caption={`Duration: ${durationLabel}`} tone="brand" />
          <StatTile icon={CalendarDays} label="Validity" value={validityLabel.text} caption={period} tone="info" />
          <StatTile
            icon={IndianRupee}
            label="Amount"
            value={formatAmount(membership.amount)}
            caption={`Payment: ${payment.label}`}
            tone={membership.payment_status === "paid" ? "success" : "warning"}
          />
          <StatTile
            icon={CircleCheck}
            label="Status"
            value={status.label}
            caption={statusCaption}
            tone={
              membership.status === "active"
                ? "success"
                : membership.status === "upcoming"
                  ? "warning"
                  : membership.status === "cancelled"
                    ? "danger"
                    : "neutral"
            }
          />
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

      <Panel>
        <PanelHeader
          icon={Layers}
          title="Covered Batch Enrollments"
          description="Batch enrollments that overlap this membership's period."
          className="mb-4 min-h-8"
        />
        {coveredEnrollments.length === 0 ? (
          <EmptyState
            size="sm"
            title="No overlapping enrollments"
            description="No batch enrollments overlap this membership’s period."
          />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <Table aria-label="Covered batch enrollments">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="whitespace-nowrap">Batch</TableHead>
                  <TableHead className="whitespace-nowrap">Enrolled On</TableHead>
                  <TableHead className="whitespace-nowrap">End Date</TableHead>
                  <TableHead className="whitespace-nowrap">Status</TableHead>
                  <TableHead className="whitespace-nowrap">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {coveredEnrollments.map((enrollment) => (
                  <CoveredEnrollmentRow
                    key={enrollment.id}
                    enrollment={enrollment}
                    studentId={membership.student_id}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>

      <Panel>
        <PanelHeader
          icon={History}
          title="Membership History"
          description="The student's other memberships."
          className="mb-4 min-h-8"
        />
        {otherMemberships.length === 0 ? (
          <EmptyState
            size="sm"
            title="No other memberships"
            description="No other membership records for this student."
          />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <Table aria-label="Membership history">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="whitespace-nowrap">Membership ID</TableHead>
                  <TableHead className="whitespace-nowrap">Plan</TableHead>
                  <TableHead className="whitespace-nowrap">Period</TableHead>
                  <TableHead className="whitespace-nowrap">Amount</TableHead>
                  <TableHead className="whitespace-nowrap">Status</TableHead>
                  <TableHead className="whitespace-nowrap">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {otherMemberships.map((entry) => (
                  <MembershipHistoryRow key={entry.id} entry={entry} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>

      <Panel>
        <PanelHeader icon={FileText} title="Additional Information" className="mb-4 min-h-8" />
        <FieldRow icon={FileText} label="Notes">
          <p className="text-body break-words whitespace-pre-line text-text-primary">{membership.notes || "No notes."}</p>
        </FieldRow>
      </Panel>
    </div>
  );
}
