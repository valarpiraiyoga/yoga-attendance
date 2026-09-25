import { notFound } from "next/navigation";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getStudent } from "@/lib/students/data";
import { listBatchOptions } from "@/lib/batches/data";
import { listCurrentSchedules } from "@/lib/schedules/data";
import { getCentreToday } from "@/lib/center-profile/settings";
import { getEnrollment, listScheduleAssignmentsForEnrollment, isScheduleAssignmentActive } from "@/lib/enrollments/data";
import { updateEnrollment } from "@/lib/enrollments/actions";
import EnrollmentForm from "@/app/students/[id]/enrollments/enrollment-form";
import StudentIdentityHeader from "@/components/ui/student-identity-header";
import PageHeader from "@/components/layout/PageHeader";

export default async function EditEnrollmentPage({ params }) {
  // Authorization boundary — see app/students/layout.js for why this must be
  // repeated here rather than relying on the layout alone. updateEnrollment
  // also calls requireRole itself before writing anything.
  await requireRole(ROLES.ADMIN);

  const { id, enrollmentId } = await params;
  const [student, enrollment, batchOptions, currentSchedules] = await Promise.all([
    getStudent(id),
    getEnrollment(enrollmentId),
    listBatchOptions(),
    listCurrentSchedules(),
  ]);

  // The enrollment must both exist and actually belong to this student —
  // otherwise a crafted URL pairing one student's id with another's
  // enrollmentId would silently operate on the wrong record.
  if (!student || !enrollment || enrollment.student_id !== id) {
    notFound();
  }

  const today = await getCentreToday();
  const allAssignments = await listScheduleAssignmentsForEnrollment(enrollmentId);
  // The form pre-checks and diffs against currently-active assignments
  // only — a historical, already-ended one is not part of "what this
  // enrollment currently attends" and must not be re-offered as if it
  // still applied.
  const activeAssignments = allAssignments.filter((assignment) => isScheduleAssignmentActive(assignment, today));

  const updateEnrollmentById = updateEnrollment.bind(null, enrollmentId, id);

  return (
    <>
      <PageHeader
        compact
        back={{ href: `/students/${id}`, label: "Back to Student Details" }}
        title="Edit Batch Enrollment"
        description={<>Update {student.full_name}&rsquo;s enrollment in {enrollment.batches?.name ?? "this batch"}.</>}
      />
      <div className="mx-auto w-full max-w-3xl">
        <div className="rounded-card border border-border bg-surface p-6 shadow-xs">
          <StudentIdentityHeader student={student} className="mb-6" />
          <EnrollmentForm
            action={updateEnrollmentById}
            student={{ full_name: student.full_name, student_code: student.student_code, photo_url: student.photo_url }}
            enrollment={enrollment}
            batchOptions={batchOptions}
            currentSchedules={currentSchedules}
            assignedSchedules={activeAssignments}
            todayDate={today}
            submitLabel="Save Changes"
            pendingLabel="Saving…"
            cancelHref={`/students/${id}`}
          />
        </div>
      </div>
    </>
  );
}
