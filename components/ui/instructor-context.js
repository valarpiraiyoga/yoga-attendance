import { Mail } from "lucide-react";
import Avatar from "@/components/ui/avatar";
import ContextCard from "@/components/ui/context-card";

/**
 * The context card for a popup about an instructor (reset password, a generated temporary password): the instructor's photo and name and, as the
 * quiet detail, the email they sign in with - so the Admin can see exactly whose password the popup acts on.
 *
 * @param {object} props
 * @param {{ full_name: string, email?: string|null, photo_url?: string|null }} props.instructor
 */
export default function InstructorContext({ instructor }) {
  if (!instructor) return null;

  return (
    <ContextCard
      mark={<Avatar name={instructor.full_name} src={instructor.photo_url} size="lg" />}
      title={instructor.full_name}
      meta={
        instructor.email ? (
          <>
            <Mail className="size-3.5 shrink-0" aria-hidden="true" />
            {instructor.email}
          </>
        ) : null
      }
    />
  );
}
