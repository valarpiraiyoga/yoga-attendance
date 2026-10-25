import Link from "next/link";
import { CalendarDays, Hash, Pencil, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/ui/avatar";
import { EntityDetailHeader } from "@/components/layout/EntityDetailHeader";
import { formatDate } from "@/lib/format";
import { ENTITY_STATUS } from "@/lib/status";
import StudentStatusButton from "@/app/students/[id]/student-status-button";
import StudentCardMenu from "@/app/students/student-card-menu";

/**
 * The student's identity header - ONE card, rendered by both Student Details and Membership Details so they are exactly the same:
 * the student's photo and name with their status badge; Student ID, join date and gender beneath; and at the right the status
 * toggle, Edit Student and the student's overflow menu.
 *
 * `membershipId` and `enrollmentId` are only the overflow menu's shortcuts (View Membership, Edit Enrollment): Membership Details
 * passes the membership it is showing and the student's active enrollment that overlaps it. `showEdit={false}` hides the Edit Student
 * button (Membership Details keeps only the status toggle and the menu); `showMenu={false}` hides the overflow menu (Student Details
 * keeps only the status toggle and Edit Student - the page itself holds every other action). Nothing else differs.
 *
 * @param {{ student: { id: string, full_name: string, student_code: string, photo_url: string|null, status: string,
 *                      join_date: string, gender?: string|null },
 *           membershipId?: string|null, enrollmentId?: string|null }} props
 */
export default function StudentHeader({ student, membershipId = null, enrollmentId = null, showEdit = true, showMenu = true }) {
  const studentStatus = ENTITY_STATUS[student.status] ?? ENTITY_STATUS.inactive;

  return (
    <EntityDetailHeader
      decorative={false}
      wash
      className="mb-0"
      avatar={<Avatar name={student.full_name} src={student.photo_url} size="lg" />}
      title={student.full_name}
      status={<Badge variant={studentStatus.variant}>{studentStatus.label}</Badge>}
      subMeta={
        <>
          <span className="inline-flex items-center gap-1.5">
            <Hash className="size-3.5 shrink-0" aria-hidden="true" />
            Student ID: {student.student_code}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays className="size-3.5 shrink-0" aria-hidden="true" />
            Joined {formatDate(student.join_date)}
          </span>
          {student.gender ? (
            <span className="inline-flex items-center gap-1.5 capitalize">
              <UserRound className="size-3.5 shrink-0" aria-hidden="true" />
              {student.gender}
            </span>
          ) : null}
        </>
      }
      actions={
        <>
          <StudentStatusButton
            studentId={student.id}
            studentName={student.full_name}
            status={student.status}
            student={{ full_name: student.full_name, student_code: student.student_code, photo_url: student.photo_url }}
          />
          {showEdit ? (
            <Button render={<Link href={`/students/${student.id}/edit`} />} nativeButton={false}>
              <Pencil className="size-4" aria-hidden="true" />
              Edit Student
            </Button>
          ) : null}
          {showMenu ? (
            <StudentCardMenu
              studentId={student.id}
              membershipId={membershipId}
              enrollmentId={enrollmentId}
              triggerVariant="outline"
              triggerSize="icon"
              triggerClassName=""
              triggerLabel={`More actions for ${student.full_name}`}
            />
          ) : null}
        </>
      }
    />
  );
}
