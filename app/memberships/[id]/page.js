import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowRight,
  CalendarDays,
  CircleCheck,
  FileText,
  Gauge,
  Hash,
  History,
  Banknote,
  Layers,
  Mail,
  Pencil,
  Phone,
  RefreshCw,
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
import FlashToast from "@/components/ui/flash-toast";
import MembershipTag from "@/components/ui/membership-tag";
import Progress from "@/components/ui/progress";
import { StatTile, StatTileGroup } from "@/components/ui/stat-tile";
import Container from "@/components/layout/Container";
import { EntityDetailHeader } from "@/components/layout/EntityDetailHeader";
import PageHeader from "@/components/layout/PageHeader";
import FieldRow from "@/components/layout/FieldRow";
import { Panel, PanelHeader } from "@/components/layout/Panel";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getMembership, listMembershipsForStudent, listCoveredEnrollments, todayDateString } from "@/lib/memberships/data";
import { getInvoiceForMembership } from "@/lib/invoices/data";
import { getInvoiceSectionState } from "@/lib/invoices/membership-invoice";
import { getMembershipValidity } from "@/lib/memberships/validity";
import { formatDate } from "@/lib/format";
import { formatPeriod } from "@/lib/memberships/period";
import { formatCurrency } from "@/lib/currencies";
import { centreDateOf } from "@/lib/class-sessions/validation";
import { getCenterTimezone } from "@/lib/center-profile/settings";
import { MEMBERSHIP_STATUS, PAYMENT_STATUS, PLAN } from "@/lib/status";
import CancelMembership from "@/app/memberships/[id]/cancel-membership";
import CoveredEnrollmentRow from "@/app/memberships/[id]/covered-enrollment-row";
import MembershipHistoryRow from "@/app/memberships/[id]/membership-history-row";
import InvoicePanel from "@/app/memberships/[id]/invoice-panel";
import PaymentsPanel from "@/app/memberships/[id]/payments-panel";
import { getPaymentsForMembership } from "@/lib/memberships/payments-data";

const SUCCESS_MESSAGES = {
  created: "Membership created successfully.",
  updated: "Membership updated successfully.",
  renewed: "Membership renewed successfully.",
};

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
 * Membership Details (composed screen — 02-ux.md "Composed Membership
 * screens": no dedicated approved wireframe, built from the same panelled
 * layout as Student Details, so no tabs). The header only identifies — who
 * (student), which membership (code · plan) — and carries the actions; the
 * four summary tiles below it give the current state (Status, Validity,
 * Payment, Progress); below them Covered Batch Enrollments (derived,
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

  const [history, coveredEnrollments, invoice, payments] = await Promise.all([
    listMembershipsForStudent(membership.student_id),
    listCoveredEnrollments(membership),
    getInvoiceForMembership(id),
    getPaymentsForMembership(id),
  ]);
  const otherMemberships = history.filter((entry) => entry.id !== id);

  const rawParams = await searchParams;
  const message = SUCCESS_MESSAGES[rawParams?.success] ?? null;

  const student = membership.students;
  // A membership with recorded payments is documented per payment (Payments panel), not at membership level.
  const hasPayments = payments.length > 0;
  const invoiceState = getInvoiceSectionState({ membership, invoice, hasPayments });
  const status = MEMBERSHIP_STATUS[membership.status] ?? { label: membership.status, variant: "neutral" };
  const payment = PAYMENT_STATUS[membership.payment_status] ?? PAYMENT_STATUS.pending;
  const planLabel = PLAN[membership.plan] ?? membership.plan;
  const durationLabel = formatDuration(membership.start_date, membership.end_date);
  const period = formatPeriod(membership.start_date, membership.end_date);

  // The same "today" the Memberships list derived each row's status and validity from:
  // the centre's date (its time zone from Center Settings), not the server's UTC date.
  const validity = getMembershipValidity(membership, await todayDateString());
  const showProgress = validity.status !== "cancelled";
  const used = usedDays(validity);

  // Progress tile text — the same reading the former Days Progress card gave: the share used once the
  // membership has begun, "not started" while Upcoming, nothing once Cancelled. Calculations are unchanged.
  const isUpcoming = validity.status === "upcoming";
  const progressValue = !showProgress ? "—" : isUpcoming ? "Not started" : `${validity.percentUsed}% used`;
  const progressCaption = !showProgress
    ? "Membership cancelled"
    : isUpcoming
      ? `Starts ${formatDate(membership.start_date)}`
      : `${used} of ${validity.totalDays} days`;

  // Status tile caption — the date that closed or will close the membership, from its own record.
  const statusCaption =
    membership.status === "cancelled"
      ? membership.cancelled_at
        ? `Cancelled ${formatDate(centreDateOf(membership.cancelled_at, await getCenterTimezone()))}`
        : "Cancelled"
      : membership.status === "expired"
        ? `Ended ${formatDate(membership.end_date)}`
        : `Ends ${formatDate(membership.end_date)}`;

  return (
    <>
      <PageHeader
        compact
        back={{ href: "/memberships", label: "Back to Memberships" }}
        title="Membership Details"
        description={`Plan, payment and validity for ${student?.full_name ?? "this student"}.`}
      />
      <Container className="flex flex-col gap-6">
      <>
        <EntityDetailHeader
          decorative={false}
          wash
          className="mb-0"
          avatar={<Avatar name={student?.full_name} src={student?.photo_url} size="lg" />}
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
              <MembershipTag code={membership.membership_code} plan={planLabel} />
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
              <CancelMembership
                membershipId={membership.id}
                studentId={student?.id}
                paymentStatus={membership.payment_status}
                invoiceExists={Boolean(invoice)}
                hasPayments={hasPayments}
                invoiceToIssue={
                  invoiceState.canIssue
                    ? {
                        needsPaymentDate: invoiceState.needsPaymentDate,
                        paymentDateLabel: invoiceState.paymentDate.kind === "recorded" ? formatDate(invoiceState.paymentDate.date) : null,
                      }
                    : null
                }
                isCancelled={membership.status === "cancelled"}
                student={
                  student
                    ? { full_name: student.full_name, student_code: student.student_code, photo_url: student.photo_url }
                    : null
                }
                membership={{ code: membership.membership_code, planLabel, period }}
              />
            </>
          }
        />

        {/* Current state at a glance — each tile answers one question: what state (Status), when
            (Validity), what is owed (Payment), how much is used (Progress). */}
        <StatTileGroup ariaLabel="Membership summary" columns={2} className="-mt-2 grid-cols-1 xl:grid-cols-4">
          <StatTile
            compact
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
          <StatTile compact icon={CalendarDays} label="Validity" value={period} caption={durationLabel} tone="neutral" />
          <StatTile
            compact
            icon={Banknote}
            label="Payment"
            value={formatCurrency(membership.amount, membership.currency)}
            caption={payment.label}
            tone={membership.payment_status === "paid" ? "success" : "warning"}
          />
          <StatTile
            compact
            icon={Gauge}
            label="Progress"
            value={progressValue}
            caption={progressCaption}
            tone={showProgress ? validityTone(membership, validity) : "neutral"}
          >
            {showProgress ? (
              <Progress
                className="mt-2 h-1.5"
                value={validity.percentUsed}
                tone={validityTone(membership, validity)}
                label="Membership validity used"
              />
            ) : null}
          </StatTile>
        </StatTileGroup>
      </>

      {/* The save confirmation is a toast overlay, not a banner, so it takes no layout space. */}
      <FlashToast message={message} />

      <PaymentsPanel
        membership={membership}
        payments={payments}
        hasMembershipInvoice={Boolean(invoice)}
        today={await todayDateString()}
        student={
          student
            ? {
                full_name: student.full_name,
                student_code: student.student_code,
                photo_url: student.photo_url,
                tax_invoice_default: student.tax_invoice_default,
              }
            : null
        }
        membershipSummary={{ code: membership.membership_code, planLabel, period }}
      />

      {invoice || !hasPayments ? (
        <InvoicePanel
          membership={membership}
          invoice={invoice}
          student={
            student
              ? { full_name: student.full_name, student_code: student.student_code, photo_url: student.photo_url }
              : null
          }
          membershipSummary={{ code: membership.membership_code, planLabel, period }}
        />
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
                  <MembershipHistoryRow key={entry.id} entry={entry} student={student} />
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
      </Container>
    </>
  );
}
