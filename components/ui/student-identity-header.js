import { Hash } from "lucide-react";
import Avatar from "@/components/ui/avatar";
import MembershipTag from "@/components/ui/membership-tag";
import { cn } from "@/lib/utils";

/**
 * A deliberately simple header for the forms that edit something OF a student
 * (Membership, Batch Enrollment): who is this for? The photo avatar, the name large
 * and the Student ID - and, when an existing membership is being edited, its
 * "Membership · MEM-... · Plan" line, since that says which record it is. Nothing
 * else; the student's other details live on Student Details. Nothing here is
 * editable. A pale brand-tinted panel - the same header look on every form (`BatchIdentityHeader` matches it).
 *
 * @param {object} props
 * @param {{ full_name: string, student_code?: string, photo_url?: string|null }} props.student
 * @param {{ code: string, plan: string }} [props.membership]
 * @param {import("react").ReactNode} [props.action] shown at the right of the row (e.g. a segmented control)
 */
export default function StudentIdentityHeader({ student, membership, className, action }) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-card border border-border bg-brand/5 p-4 sm:p-5", className)}>
      <div className="flex min-w-0 items-center gap-3">
      <Avatar name={student.full_name} src={student.photo_url} size="lg" />
      <div className="min-w-0">
        <p className="text-page-title font-semibold break-words text-text-primary">{student.full_name}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-small text-text-secondary">
          {student.student_code ? (
            <span className="inline-flex items-center gap-1.5">
              <Hash className="size-3.5 shrink-0" aria-hidden="true" />
              Student ID: {student.student_code}
            </span>
          ) : null}
          {membership ? <MembershipTag code={membership.code} plan={membership.plan} /> : null}
        </div>
      </div>
      </div>
      {action ?? null}
    </div>
  );
}
