import { AlarmClock, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * A membership's reminder indicators on the Memberships list (02-ux.md "Membership & payment reminders"): a red expiry badge ("Expires in 3 days",
 * "Expires today", "Expired 5 days ago") and a payment-pending badge with the outstanding balance - each only while its reminder applies, both
 * when both do. They wrap rather than widen the row or card. No state, so it works in the table rows and the cards alike.
 *
 * @param {object} props
 * `only` ("expiry" | "payment") shows just that one: the Memberships table puts the Balance badge in its Amount & Payment column, under the
 * payment status, and the expiry badge under the membership status.
 *
 * @param {{ expiry?: { text: string }, payment?: { text: string } }|undefined} props.reminders - one entry of `remindersByMembership`.
 * @param {"expiry"|"payment"} [props.only]
 */
export default function ReminderIndicators({ reminders, only, className }) {
  const expiry = only === "payment" ? null : reminders?.expiry;
  const payment = only === "expiry" ? null : reminders?.payment;
  if (!expiry && !payment) return null;

  return (
    <span className={cn("flex flex-wrap items-center gap-1", className)}>
      {expiry ? (
        <Badge variant="danger" title={`Expiry reminder: ${expiry.text}`}>
          <AlarmClock className="size-3" aria-hidden="true" />
          <span className="sr-only">Expiry reminder: </span>
          {expiry.text}
        </Badge>
      ) : null}
      {payment ? (
        <Badge variant="danger" title={`Payment pending: ${payment.text}`}>
          <Wallet className="size-3" aria-hidden="true" />
          <span className="sr-only">Payment pending: </span>
          {payment.text}
        </Badge>
      ) : null}
    </span>
  );
}
