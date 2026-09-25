import { CreditCard } from "lucide-react";
import Avatar from "@/components/ui/avatar";
import ContextCard from "@/components/ui/context-card";

/**
 * The context card for a popup about a student (deactivate, review enrollment, review
 * membership, cancel membership): the student's photo, name and Student ID, and - when the
 * popup is about one of their memberships - that membership's code, plan and period.
 *
 * @param {object} props
 * @param {{ full_name: string, student_code?: string, photo_url?: string|null }} props.student
 * @param {{ code: string, planLabel?: string, period?: string }} [props.membership]
 */
export default function StudentContext({ student, membership }) {
  if (!student) return null;

  const membershipLine = membership
    ? [membership.code, membership.planLabel, membership.period].filter(Boolean).join(" · ")
    : null;

  return (
    <ContextCard
      mark={<Avatar name={student.full_name} src={student.photo_url} size="lg" />}
      title={student.full_name}
      detail={student.student_code ? `Student ID: ${student.student_code}` : null}
      meta={
        membershipLine ? (
          <>
            <CreditCard className="size-3.5 shrink-0" aria-hidden="true" />
            {membershipLine}
          </>
        ) : null
      }
    />
  );
}
