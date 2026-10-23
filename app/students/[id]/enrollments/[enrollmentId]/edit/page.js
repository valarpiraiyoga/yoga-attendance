import { notFound } from "next/navigation";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getStudent } from "@/lib/students/data";
import { listBatchOptions } from "@/lib/batches/data";
import { listCurrentSchedules } from "@/lib/schedules/data";
import { getScheduleCapacitiesForPicker } from "@/lib/schedules/capacity-data";
import { getCentreToday } from "@/lib/center-profile/settings";
import { getEnrollment, listScheduleAssignmentsForEnrollment } from "@/lib/enrollments/data";
import { isScheduleAssignmentCurrent } from "@/lib/enrollments/schedule-availability";
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
  // The form pre-checks and diffs against the enrollment's CURRENT assignments - the ones not ended before today, whether they have
  // started or not: exactly what updateEnrollment reads as "currently assigned" and what takes a place against a schedule's
  // capacity (0060). A historical, already-ended one is not part of "what this enrollment currently attends" and must not be
  // re-offered as if it still applied. (Filtering on "has started" as well left a future-dated assignment out of the form: it
  // showed unticked, the server saw it as dropped, and a full schedule it holds looked unavailable.)
  const activeAssignments = allAssignments.filter((assignment) => isScheduleAssignmentCurrent(assignment, today));

  // The places taken against each schedule's capacity, for every schedule the picker can show - including one this enrollment
  // still attends but that is no longer "currently available". Null when they cannot be read: the picker then shows and locks nothing.
  const scheduleCapacities = await getScheduleCapacitiesForPicker([
    ...new Set([
      ...currentSchedules.map((schedule) => schedule.series_id),
      ...activeAssignments.map((assignment) => assignment.schedule_series_id),
    ]),
  ]);

  const updateEnrollmentById = updateEnrollment.bind(null, enrollmentId, id);

  return (
    <>
      <PageHeader
        compact
        back={{ href: `/students/${id}`, label: "Back to Student Details" }}
        title="Edit Batch Enrollment"
        description={<>Update {student.full_name}&rsquo;s enrollment in {enrollment.batches?.name ?? "this batch"}.</>}
      />
      <div className="mx-auto w-full max-w-5xl">
        <div className="rounded-card border border-border bg-surface p-6 shadow-xs">
          <StudentIdentityHeader student={student} className="mb-6" />
          <EnrollmentForm
            action={updateEnrollmentById}
            joinDate={student.join_date}
            student={{ full_name: student.full_name, student_code: student.student_code, photo_url: student.photo_url }}
            enrollment={enrollment}
            batchOptions={batchOptions}
            currentSchedules={currentSchedules}
            assignedSchedules={activeAssignments}
            scheduleCapacities={scheduleCapacities}
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
