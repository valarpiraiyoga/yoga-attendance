import { CreditCard, Hash } from "lucide-react";
import Avatar from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/**
 * The identity header's surface, shared with `BatchIdentityHeader`: a soft teal-to-white wash (the Student / Batch Details header's
 * wash). As the first thing in its card it is the card's top band - full-bleed, with no gap above or at the sides: it pulls out by
 * the card's padding (`--card-pad`, 1.5rem = the forms' `p-6` unless the card sets it), takes the card's top corners and closes with
 * a bottom rule, and pads its content back in so it lines up with the fields below. Anywhere else (not first) it stays an inset
 * rounded panel.
 */
export const IDENTITY_BAND = [
  "flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-card border border-border bg-linear-to-r from-brand/10 via-brand/5 to-surface p-4 sm:p-5",
  "first:mx-[calc(var(--card-pad,1.5rem)*-1)] first:mt-[calc(var(--card-pad,1.5rem)*-1)] first:rounded-b-none first:rounded-t-[calc(var(--radius-card)-1px)]",
  "first:border-x-0 first:border-t-0 first:px-(--card-pad,1.5rem) first:py-5",
].join(" ");

/**
 * The membership a form is editing, on the right of the header: a white panel with a card icon, the "Membership" caption, the
 * membership code prominent and its plan beneath - so the record being edited reads as its own block beside the student, not as a
 * line of the student's details. It wraps below the student on a narrow screen.
 */
function MembershipSummary({ code, plan }) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-card border border-brand/15 bg-surface px-4 py-3 shadow-xs">
      <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
        <CreditCard className="size-5" />
      </span>
      <div className="min-w-0">
        <p className="text-small text-text-secondary">Membership</p>
        <p className="text-body font-semibold whitespace-nowrap text-text-primary tabular-nums">{code}</p>
        {plan ? <p className="text-small truncate text-text-secondary">{plan}</p> : null}
      </div>
    </div>
  );
}

/**
 * A deliberately simple header for the forms that edit something OF a student
 * (Membership, Batch Enrollment): who is this for? The photo avatar, the name large
 * and the Student ID on the left - and, when an existing membership is being edited,
 * that membership (code and plan) as its own block on the right, since it says which
 * record this is. Nothing else; the student's other details live on Student Details.
 * Nothing here is editable. The same header look on every form (`BatchIdentityHeader` matches it).
 *
 * @param {object} props
 * @param {{ full_name: string, student_code?: string, photo_url?: string|null }} props.student
 * @param {{ code: string, plan: string }} [props.membership]
 * @param {import("react").ReactNode} [props.action] shown at the right of the row (e.g. a segmented control)
 */
export default function StudentIdentityHeader({ student, membership, className, action }) {
  return (
    <div className={cn(IDENTITY_BAND, className)}>
      <div className="flex min-w-0 items-center gap-3">
        <Avatar name={student.full_name} src={student.photo_url} size="lg" />
        <div className="min-w-0">
          <p className="text-page-title font-semibold break-words text-text-primary">{student.full_name}</p>
          {student.student_code ? (
            <p className="mt-1 inline-flex items-center gap-1.5 text-small text-text-secondary">
              <Hash className="size-3.5 shrink-0" aria-hidden="true" />
              Student ID: {student.student_code}
            </p>
          ) : null}
        </div>
      </div>
      {membership || action ? (
        <div className="flex flex-wrap items-center gap-3">
          {membership ? <MembershipSummary code={membership.code} plan={membership.plan} /> : null}
          {action ?? null}
        </div>
      ) : null}
    </div>
  );
}
