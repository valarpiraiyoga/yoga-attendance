import { notFound } from "next/navigation";
import { FileText, Layers } from "lucide-react";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import EmptyState from "@/components/ui/empty-state";
import FlashToast from "@/components/ui/flash-toast";
import Alert from "@/components/ui/alert";
import { PAYMENT_NOT_RECORDED_NOTICE } from "@/lib/memberships/initial-payment";
import Container from "@/components/layout/Container";
import PageHeader from "@/components/layout/PageHeader";
import FieldRow from "@/components/layout/FieldRow";
import { Panel, PanelHeader } from "@/components/layout/Panel";
import { requireRole, ROLES } from "@/lib/auth/dal";
import {
  getMembership,
  listMembershipsForStudent,
  listCoveredEnrollments,
  listMembershipTermCorrections,
  todayDateString,
} from "@/lib/memberships/data";
import { getInvoiceForMembership } from "@/lib/invoices/data";
import { getInvoiceSectionState } from "@/lib/invoices/membership-invoice";
import { formatPeriod } from "@/lib/memberships/period";
import { getCenterSettings, getCenterTimezone } from "@/lib/center-profile/settings";
import { PLAN } from "@/lib/status";
import StudentHeader from "@/app/students/[id]/student-header";
import CoveredEnrollmentRow from "@/app/memberships/[id]/covered-enrollment-row";
import MembershipListPanel from "@/app/memberships/[id]/membership-list-panel";
import MembershipCarousel from "@/app/memberships/[id]/membership-carousel";
import InvoicePanel from "@/app/memberships/[id]/invoice-panel";
import PaymentsPanel from "@/app/memberships/[id]/payments-panel";
import PricingPanel from "@/app/memberships/[id]/pricing-panel";
import { pricingSnapshotOf } from "@/lib/packages/membership-pricing";
import ClassAttendancePanel from "@/app/memberships/[id]/class-attendance-panel";
import { listClassCountHistory, listClassCountExpiryEdits } from "@/lib/class-count-attendance/data";
import ExpiryPanel from "@/app/memberships/[id]/expiry-panel";
import CorrectionsPanel from "@/app/memberships/[id]/corrections-panel";
import { getPaymentsForMembership } from "@/lib/memberships/payments-data";

const SUCCESS_MESSAGES = {
  created: "Membership created successfully.",
  updated: "Membership updated successfully.",
  renewed: "Membership renewed successfully.",
};

/**
 * Membership Details (composed screen — 02-ux.md "Composed Membership
 * screens": no dedicated approved wireframe, built from the same panelled
 * layout as Student Details, so no tabs). The header only identifies — who
 * (student), which membership (code · plan) — and carries the actions; the
 * Membership carousel (the selected membership's summary card). From `xl` the page is two columns: the student's Memberships list on the left (search, Status and Plan
 * filters, the current membership highlighted; each card opens that membership) and these details on the right; below `xl` the
 * list follows the details. The list is the one place to switch between the student's memberships (renewal always creates a new
 * record, the previous one remains there, never overwritten), so the details do not repeat them. The details continue with Pricing,
 * Corrections, Payments, Covered Batch Enrollments (derived, never stored — 01-product.md §12) and the membership's notes.
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

  const isPackageLinked = Boolean(membership.package_id);
  const [history, coveredEnrollments, invoice, payments, classRecords, expiryEdits, corrections] = await Promise.all([
    listMembershipsForStudent(membership.student_id),
    listCoveredEnrollments(membership),
    getInvoiceForMembership(id),
    getPaymentsForMembership(id),
    membership.kind === "class_count" ? listClassCountHistory(id) : Promise.resolve([]),
    membership.kind === "class_count" ? listClassCountExpiryEdits(id) : Promise.resolve([]),
    // Corrections (migration 0050) belong to a package-linked membership only; a legacy one keeps its Edit form.
    isPackageLinked ? listMembershipTermCorrections(id) : Promise.resolve([]),
  ]);

  const rawParams = await searchParams;
  const message = SUCCESS_MESSAGES[rawParams?.success] ?? null;

  const student = membership.students;
  // A membership with recorded payments is documented per payment (Payments panel), not at membership level.
  const hasPayments = payments.length > 0;
  const invoiceState = getInvoiceSectionState({ membership, invoice, hasPayments });
  const planLabel = PLAN[membership.plan] ?? membership.plan;
  // A package-linked membership shows the pricing recorded when it was created; a legacy membership has none and is unchanged.
  const pricing = pricingSnapshotOf(membership);
  const period = formatPeriod(membership.start_date, membership.end_date);

  return (
    <>
      <PageHeader
        compact
        back={{ href: "/memberships", label: "Back to Memberships" }}
        title="Membership Details"
        description={`Plan, payment and validity for ${student?.full_name ?? "this student"}.`}
      />
      <Container className="flex flex-col gap-4">
        {/* The student's own header card - the same one Student Details shows. Its overflow menu's shortcuts are this membership
            and the student's active enrollment that overlaps it. */}
        {student ? (
          <StudentHeader
            student={student}
            membershipId={membership.id}
            enrollmentId={coveredEnrollments.find((enrollment) => enrollment.status === "active")?.id ?? null}
            showEdit={false}
          />
        ) : null}

        <div className="grid items-start gap-4 xl:grid-cols-[19rem_minmax(0,1fr)]">
        <div className="order-last min-w-0 xl:order-first">
          <MembershipListPanel
            memberships={history.map((entry) => ({
              id: entry.id,
              membership_code: entry.membership_code,
              plan: entry.plan,
              kind: entry.kind,
              total_classes: entry.total_classes,
              package_name: entry.package_name,
              start_date: entry.start_date,
              end_date: entry.end_date,
              amount: entry.amount,
              currency: entry.currency,
              status: entry.status,
            }))}
            currentId={membership.id}
            studentId={membership.student_id}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
        {/* The selected membership as the summary card, with its neighbours (the same order as the list) partly visible. */}
        <MembershipCarousel
          memberships={history}
          selectedId={membership.id}
          studentId={membership.student_id}
          centreName={(await getCenterSettings()).name ?? ""}
          today={await todayDateString()}
        />


      {/* The save confirmation is a toast overlay, not a banner, so it takes no layout space. */}
      <FlashToast message={message} />

      {/* A membership saved with "Record Payment Now" whose payment did not go through (lib/memberships/initial-payment.js).
          It stays until a payment exists, so it cannot be missed - and tells the Admin to check before recording again. */}
      {rawParams?.notice === PAYMENT_NOT_RECORDED_NOTICE && payments.length === 0 ? (
        <Alert variant="warning" role="alert" title="The membership was saved, but its payment may not have been recorded">
          Check Payments below before recording it again. Until a payment is recorded, this membership stays Pending.
        </Alert>
      ) : null}

      {pricing ? <PricingPanel snapshot={pricing} membershipId={membership.id} canEdit={membership.status !== "cancelled"} /> : null}

      {/* A package-linked membership: the history of its corrections; they are made in Edit Membership. */}
      {isPackageLinked ? (
        <CorrectionsPanel
          membershipId={membership.id}
          currency={membership.currency}
          canEdit={membership.status !== "cancelled"}
          corrections={corrections}
          timeZone={await getCenterTimezone()}
        />
      ) : null}

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

      {/* The legacy membership-level invoice: shown for an invoice that exists, and for the one case that can still issue one
          (Paid, no recorded payments, no invoice). Every other membership is documented per payment, in the Payments panel. */}
      {invoice || invoiceState.canIssue ? (
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

      {membership.class_count ? (
        <ClassAttendancePanel
          classCount={membership.class_count}
          records={classRecords}
          timeZone={await getCenterTimezone()}
          endDate={membership.end_date}
          student={
            student
              ? { full_name: student.full_name, student_code: student.student_code, photo_url: student.photo_url }
              : null
          }
          membership={{ code: membership.membership_code, planLabel, period }}
        />
      ) : null}

      {/* Every class-count membership, legacy or package-linked: its expiry, the Edit expiry action, and the history of changes. */}
      {membership.kind === "class_count" ? (
        <ExpiryPanel
          membershipId={membership.id}
          expiry={membership.end_date}
          startDate={membership.start_date}
          edits={expiryEdits}
          timeZone={await getCenterTimezone()}
          student={
            student
              ? { full_name: student.full_name, student_code: student.student_code, photo_url: student.photo_url }
              : null
          }
          membership={{ code: membership.membership_code, planLabel, period }}
        />
      ) : null}

      <Panel className="sm:p-4">
        <PanelHeader
          icon={Layers}
          tone="brand"
          title="Covered Batch Enrollments"
          description="Batch enrollments that overlap this membership's period."
          className="mb-3"
        />
        {coveredEnrollments.length === 0 ? (
          <EmptyState
            size="sm"
            title="No overlapping enrollments"
            description="No batch enrollments overlap this membership’s period."
          />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <Table aria-label="Covered batch enrollments" className="[&_td]:px-4 [&_td]:py-2.5 [&_th]:h-10 [&_th]:px-4">
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

      <Panel className="sm:p-4">
        <PanelHeader icon={FileText} tone="brand" title="Additional Information" className="mb-3" />
        <FieldRow icon={FileText} label="Notes">
          <p className="text-body break-words whitespace-pre-line text-text-primary">{membership.notes || "No notes."}</p>
        </FieldRow>
      </Panel>
        </div>
        </div>
      </Container>
    </>
  );
}
