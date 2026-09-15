import Link from "next/link";
import { CalendarDays, Eye, Layers, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const PLAN_LABELS = { monthly: "Monthly", quarterly: "Quarterly", custom: "Custom" };
const PAYMENT_LABELS = { paid: "Paid", pending: "Pending" };
const PAYMENT_VARIANTS = { paid: "success", pending: "neutral" };
const STATUS_LABELS = { upcoming: "Upcoming", active: "Active", expired: "Expired", cancelled: "Cancelled" };
const STATUS_VARIANTS = { upcoming: "default", active: "success", expired: "neutral", cancelled: "danger" };

function formatDate(value) {
  if (!value) return "—";
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
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
 * Membership card list item — student-first compact card matching the
 * approved list layout. View (eye) is the only list action.
 * Batch is not on membership list data; membership code fills that row.
 */
export default function MembershipCardItem({ membership }) {
  const studentName = membership.students?.full_name ?? null;
  const planLabel = PLAN_LABELS[membership.plan] ?? membership.plan;
  const dateRange = `${formatDate(membership.start_date)} - ${formatDate(membership.end_date)}`;
  const paymentLabel = PAYMENT_LABELS[membership.payment_status] ?? membership.payment_status;

  return (
    <article className="flex h-full flex-col gap-3 rounded-2xl border border-border/70 bg-surface p-4 shadow-sm">
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand/15 text-small font-semibold text-brand"
        >
          {studentName ? getInitials(studentName) : "?"}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-1.5">
            <div className="min-w-0 flex-1">
              <h3
                className="truncate text-body font-semibold leading-snug text-text-primary"
                title={studentName || undefined}
              >
                {studentName || "—"}
              </h3>
              <Badge
                variant={STATUS_VARIANTS[membership.status]}
                className="mt-1 rounded-full px-2 py-0"
              >
                <span className="text-[10px] leading-[14px] font-medium">
                  {STATUS_LABELS[membership.status] ?? membership.status}
                </span>
              </Badge>
            </div>

            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="shrink-0 text-brand hover:bg-brand/10 hover:text-brand"
              aria-label={`View membership ${membership.membership_code}`}
              render={<Link href={`/memberships/${membership.id}`} />}
              nativeButton={false}
            >
              <Eye className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 text-small text-text-secondary">
        <span
          className="inline-flex min-w-0 items-center gap-2"
          title={`Code: ${membership.membership_code}`}
        >
          <Layers className="size-3.5 shrink-0 text-text-secondary" aria-hidden="true" />
          <span className="min-w-0 truncate">
            Code:{" "}
            <span className="font-semibold text-text-primary">{membership.membership_code}</span>
          </span>
        </span>

        <span
          className="inline-flex min-w-0 items-center gap-2"
          title={`${planLabel} : ${dateRange}`}
        >
          <CalendarDays className="size-3.5 shrink-0 text-text-secondary" aria-hidden="true" />
          <span className="min-w-0 truncate">
            {planLabel} : {dateRange}
          </span>
        </span>

        <span className="inline-flex min-w-0 items-center gap-2">
          <Wallet className="size-3.5 shrink-0 text-text-secondary" aria-hidden="true" />
          <span className="min-w-0 truncate font-medium text-text-primary">
            {formatAmount(membership.amount)}
          </span>
          <Badge
            variant={PAYMENT_VARIANTS[membership.payment_status] ?? "neutral"}
            className="rounded-full px-2 py-0"
          >
            <span className="text-[10px] leading-[14px] font-medium">{paymentLabel}</span>
          </Badge>
        </span>
      </div>
    </article>
  );
}
