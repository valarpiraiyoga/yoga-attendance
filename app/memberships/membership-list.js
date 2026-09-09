import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

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
 * The Membership table (wireframe: Memberships list). A plain Server
 * Component, mirroring app/students/student-list.js and
 * app/batches/batch-list.js: no quick actions here, only "View" — Edit,
 * Renew, and Cancel all live on Membership Details.
 */
export default function MembershipList({ memberships }) {
  return (
    <div className="mt-6 overflow-hidden rounded-card border border-border bg-surface">
      <Table aria-label="Memberships">
        <TableHeader>
          <TableRow>
            <TableHead>Membership</TableHead>
            <TableHead>Student</TableHead>
            <TableHead>Plan</TableHead>
            <TableHead>Start Date</TableHead>
            <TableHead>End Date</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Payment</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {memberships.map((membership) => (
            <TableRow key={membership.id}>
              <TableCell className="font-medium text-text-primary">{membership.membership_code}</TableCell>
              <TableCell>
                {membership.students ? (
                  <>
                    <p className="text-text-primary">{membership.students.full_name}</p>
                    <p className="text-small text-text-secondary">{membership.students.student_code}</p>
                  </>
                ) : (
                  <span className="text-text-secondary">—</span>
                )}
              </TableCell>
              <TableCell className="text-text-secondary">{PLAN_LABELS[membership.plan] ?? membership.plan}</TableCell>
              <TableCell className="text-text-secondary">{formatDate(membership.start_date)}</TableCell>
              <TableCell className="text-text-secondary">{formatDate(membership.end_date)}</TableCell>
              <TableCell className="text-text-secondary">{formatAmount(membership.amount)}</TableCell>
              <TableCell className="text-text-secondary">
                {PAYMENT_LABELS[membership.payment_status] ?? membership.payment_status}
              </TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANTS[membership.status]}>{STATUS_LABELS[membership.status]}</Badge>
              </TableCell>
              <TableCell>
                <Link
                  href={`/memberships/${membership.id}`}
                  className="font-medium text-brand hover:underline"
                >
                  View
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
