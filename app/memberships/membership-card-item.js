import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

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

function getInitials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0].toUpperCase();

  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/**
 * Membership card — plan/status first, then student and validity.
 * View remains the only list action (Edit/Renew/Cancel live on Details).
 */
export default function MembershipCardItem({ membership }) {
  const studentName = membership.students?.full_name ?? null;
  const studentCode = membership.students?.student_code ?? null;

  return (
    <article className="flex h-full flex-col gap-3 rounded-2xl border border-border/70 bg-gradient-to-br from-info/10 via-surface/80 to-brand/10 p-3.5 shadow-sm backdrop-blur-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-body font-semibold leading-snug text-text-primary">
            {PLAN_LABELS[membership.plan] ?? membership.plan} Membership
          </h3>
          <p className="text-small mt-0.5 truncate text-text-secondary">{membership.membership_code}</p>
        </div>
        <Badge variant={STATUS_VARIANTS[membership.status]} className="shrink-0 rounded-full px-2 py-0">
          <span className="text-[10px] leading-[14px] font-medium">
            {STATUS_LABELS[membership.status] ?? membership.status}
          </span>
        </Badge>
      </div>

      <div className="flex min-w-0 items-center gap-2.5">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand/10 text-small font-semibold text-brand"
        >
          {studentName ? getInitials(studentName) : "?"}
        </span>
        <div className="min-w-0">
          <p className="truncate text-body font-semibold text-text-primary">{studentName || "—"}</p>
          <p className="text-small truncate text-text-secondary">{studentCode || "No student"}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 border-y border-border/50 py-2.5">
        <div className="min-w-0 pr-2">
          <p className="truncate text-body font-semibold leading-snug text-text-primary">
            {formatDate(membership.start_date)}
          </p>
          <p className="text-small mt-0.5 text-text-secondary">Start</p>
        </div>
        <div className="min-w-0 border-l border-border/50 pl-3">
          <p className="truncate text-body font-semibold leading-snug text-text-primary">
            {formatDate(membership.end_date)}
          </p>
          <p className="text-small mt-0.5 text-text-secondary">End</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-text-secondary">
        <span>
          <span className="font-medium text-text-primary">{formatAmount(membership.amount)}</span>
        </span>
        <span aria-hidden="true">·</span>
        <span>
          Payment:{" "}
          <span className="font-medium text-text-primary">
            {PAYMENT_LABELS[membership.payment_status] ?? membership.payment_status}
          </span>
        </span>
      </div>

      <div className="mt-auto">
        <Button
          size="sm"
          variant="outline"
          className="h-9 w-full rounded-full border-border/80 bg-surface/70 text-small font-semibold text-text-primary shadow-xs hover:bg-surface hover:text-text-primary"
          render={<Link href={`/memberships/${membership.id}`} />}
          nativeButton={false}
        >
          View Membership
        </Button>
      </div>
    </article>
  );
}
