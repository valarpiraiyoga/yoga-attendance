import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";
import { getCenterSettings, getCenterTimezone, getCentreToday } from "@/lib/center-profile/settings";
import { CreditCard, FileText, Layers, Pencil, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/ui/avatar";
import BatchAvatar from "@/components/ui/batch-avatar";
import EmptyState from "@/components/ui/empty-state";
import FlashToast from "@/components/ui/flash-toast";
import Container from "@/components/layout/Container";
import PageHeader from "@/components/layout/PageHeader";
import { Panel, PanelHeader } from "@/components/layout/Panel";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getStudent } from "@/lib/students/data";
import { listStudentClassCountAttendance } from "@/lib/class-count-attendance/data";
import { combineRecentAttendance } from "@/lib/class-count-attendance/attendance-rows";
import { RECENT_ATTENDANCE_ROWS, recentAttendanceRange } from "@/lib/attendance/recent";
import { addDaysUTC } from "@/lib/schedules/validation";
import CommunicationHistory from "@/app/students/[id]/communications/communication-history";
import { listStudentCommunications } from "@/lib/communications/data";
import {
  listEnrollmentsForStudent,
  listScheduleAssignmentsForEnrollment,
  isScheduleAssignmentActive,
} from "@/lib/enrollments/data";
import { DAY_LABELS, DAYS_OF_WEEK } from "@/lib/schedules/validation";
import { listMembershipsForStudent, pickCurrentMembership } from "@/lib/memberships/data";
import { formatDate, formatTimeRange } from "@/lib/format";
import { ENTITY_STATUS } from "@/lib/status";
import StudentHeader from "@/app/students/[id]/student-header";
import GuidedComplete from "@/app/students/guided-complete";
import { movedAssignmentsText } from "@/lib/students/join-date";
import {
  batchAssignments,
  buildAttendanceStrip,
  calendarBatches,
  instructorsByDate,
  sessionsByDate,
  monthBounds,
  parseCalendarMonth,
  pickCalendarBatch,
} from "@/lib/students/attendance-calendar";
import { listStudentBatchAttendance, listStudentBatchClassDates } from "@/lib/students/attendance-calendar-data";
import AttendanceCalendar, { CLASS_COUNT_TAB } from "@/app/students/[id]/attendance-calendar";
import MembershipSummaryCard from "@/app/students/[id]/membership-summary-card";
import MembershipHistory from "@/app/students/[id]/membership-history";
import ProfileContact from "@/app/students/[id]/profile-contact";

const SUCCESS_MESSAGES = {
  updated: "Student updated successfully.",
  enrollment_added: "Batch enrollment added successfully.",
  enrollment_updated: "Batch enrollment updated successfully.",
  membership_added: "Membership added successfully.",
};

/** Monday-first, then by start time — a stable, readable order for the schedule table. */
function sortAssignmentsByWeek(assignments) {
  const dayIndex = (assignment) => {
    const index = DAYS_OF_WEEK.indexOf(assignment.schedule?.day_of_week);
    return index === -1 ? DAYS_OF_WEEK.length : index;
  };
  return [...assignments].sort(
    (a, b) =>
      dayIndex(a) - dayIndex(b) ||
      String(a.schedule?.start_time ?? "").localeCompare(String(b.schedule?.start_time ?? ""))
  );
}

/**
 * The student's latest class-count records (`listStudentClassCountAttendance`), shown in Recent Attendance's "Class count" tab
 * exactly as before (`combineRecentAttendance`, newest first). `unavailable` when they could not be read - never "none".
 */
async function loadClassCountAttendance(studentId, today) {
  const { dateFrom, dateTo } = recentAttendanceRange(today, addDaysUTC);
  const records = await listStudentClassCountAttendance(studentId, { dateFrom, dateTo, limit: RECENT_ATTENDANCE_ROWS }).catch(() => null);
  if (records === null) return { items: [], unavailable: true };
  return { items: combineRecentAttendance({ sessions: [], classCount: records, limit: RECENT_ATTENDANCE_ROWS }).items, unavailable: false };
}

/**
 * Student Details (the approved Student Details design). A single page, not tabs: the page strip; the identity header (photo,
 * name, status; Student ID, join date, gender; the status toggle, Edit Student and the overflow menu); then two columns from
 * `xl` - left: Batch Enrollments, Recent Attendance (the per-batch month calendar), Profile & Contact, Additional Information
 * (the notes), Communication History; right: Membership (the current membership) and Membership History (the others). Below
 * `xl` the columns stack in that same order. No student field is dropped.
 *
 * Recent Attendance reads `?attendanceBatch=` (a batch id, or "class-count") and `?attendanceMonth=YYYY-MM`; every other panel
 * ignores them.
 */
export default async function StudentDetailsPage({ params, searchParams }) {
  await requireRole(ROLES.ADMIN);

  const { id } = await params;
  const today = await getCentreToday();
  const student = await getStudent(id);

  if (!student) {
    notFound();
  }

  const [enrollments, memberships, classCount, communications, timeZone, centre] = await Promise.all([
    listEnrollmentsForStudent(id),
    listMembershipsForStudent(id),
    loadClassCountAttendance(id, today),
    // The history must never take the page down: on a failure its panel says so and the rest still works.
    listStudentCommunications(id).catch((error) => {
      unstable_rethrow(error);
      return null;
    }),
    getCenterTimezone(),
    getCenterSettings(),
  ]);
  const currentMembership = pickCurrentMembership(memberships);
  const otherMemberships = memberships.filter((membership) => membership.id !== currentMembership?.id);

  const assignmentsByEnrollmentId = new Map(
    await Promise.all(
      enrollments.map(async (enrollment) => [enrollment.id, await listScheduleAssignmentsForEnrollment(enrollment.id)])
    )
  );
  const rawParams = await searchParams;
  const baseMessage = SUCCESS_MESSAGES[rawParams?.success] ?? null;
  // An edited enrollment start date can move its initial schedule assignments (migration 0051): say how many, when it did.
  const movedText = rawParams?.success === "enrollment_updated" ? movedAssignmentsText(rawParams?.moved) : "";
  const message = baseMessage && movedText ? `${baseMessage} ${movedText}` : baseMessage;

  // The Add Student guided flow's finish (`createEnrollment` redirects here
  // with `?guided=1`): show its completion screen instead of the details.
  if (rawParams?.guided === "1" && rawParams?.success === "enrollment_added") {
    return (
      <GuidedComplete
        student={student}
        membership={currentMembership}
        enrollment={enrollments.find((enrollment) => enrollment.status === "active") ?? enrollments[0]}
      />
    );
  }

  // Recent Attendance: the batch tab and the month in the URL, and that month's recorded attendance for that batch.
  const batches = calendarBatches(enrollments);
  const calendarMonth = parseCalendarMonth(rawParams?.attendanceMonth, today);
  const wantsClassCount = rawParams?.attendanceBatch === CLASS_COUNT_TAB && (classCount.items.length > 0 || classCount.unavailable);
  const calendarBatch = wantsClassCount ? null : pickCalendarBatch(batches, rawParams?.attendanceBatch);
  const selectedTab = wantsClassCount
    ? CLASS_COUNT_TAB
    : (calendarBatch?.id ?? (classCount.items.length > 0 || classCount.unavailable ? CLASS_COUNT_TAB : null));
  let strip = [];
  if (calendarBatch) {
    const range = monthBounds(calendarMonth);
    // The month's recorded marks and its class dates (the batch's sessions for this student's enrollment) are read together;
    // if either cannot be read the panel says so - it never shows a guess.
    const quiet = (error) => {
      unstable_rethrow(error);
      return null;
    };
    const [records, occurrences] = await Promise.all([
      listStudentBatchAttendance(id, calendarBatch.id, range).catch(quiet),
      listStudentBatchClassDates(calendarBatch.id, range, {
        today,
        enrollmentPeriods: calendarBatch.periods,
        assignments: batchAssignments(enrollments, assignmentsByEnrollmentId, calendarBatch.id),
      }).catch(quiet),
    ]);
    strip =
      records === null || occurrences === null
        ? null
        : buildAttendanceStrip({
            month: calendarMonth,
            today,
            records,
            periods: calendarBatch.periods,
            classDates: occurrences.map((occurrence) => occurrence.date),
            instructors: instructorsByDate(occurrences, records),
            sessions: sessionsByDate(occurrences, records),
          });
  }


  return (
    <>
      <PageHeader
        compact
        back={{ href: "/students", label: "Back to Students" }}
        title="Student Details"
        description={`Profile, enrollments and membership for ${student.full_name}.`}
      />
      <Container className="flex flex-col gap-6">
        <StudentHeader
          student={student}
          membershipId={currentMembership?.id ?? null}
          enrollmentId={enrollments.find((enrollment) => enrollment.status === "active")?.id ?? null}
        />

        {/* The save confirmation is a toast overlay, not a banner, so it takes no layout space. */}
        <FlashToast message={message} />

        {/* Two columns from `xl` (the working column wider); below `xl` they stack, left column first, in the same order. */}
        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-6">
            <Panel>
              <PanelHeader
                icon={Layers}
                tone="brand"
                title="Batch Enrollments"
                action={
                  <Button size="sm" render={<Link href={`/students/${student.id}/enrollments/new`} />} nativeButton={false}>
                    <Plus className="size-4" aria-hidden="true" />
                    Add Enrollment
                  </Button>
                }
              />
              {enrollments.length === 0 ? (
                <EmptyState
                  size="sm"
                  description="No batch enrollments yet. Add one to make this student eligible for attendance."
                />
              ) : (
                <ul className="flex flex-col gap-3">
                  {enrollments.map((enrollment) => (
                    <EnrollmentCard
                      key={enrollment.id}
                      studentId={student.id}
                      enrollment={enrollment}
                      schedules={sortAssignmentsByWeek(
                        (assignmentsByEnrollmentId.get(enrollment.id) ?? []).filter((assignment) =>
                          isScheduleAssignmentActive(assignment, today)
                        )
                      )}
                    />
                  ))}
                </ul>
              )}
            </Panel>

            <AttendanceCalendar
              studentId={student.id}
              studentName={student.full_name}
              batches={batches}
              selected={selectedTab}
              month={calendarMonth}
              today={today}
              strip={strip}
              classCount={classCount}
            />

            <ProfileContact student={student} />

            <Panel>
              <PanelHeader icon={FileText} tone="brand" title="Additional Information" className="mb-2" />
              {student.notes ? (
                <div>
                  <p className="text-small text-text-secondary">Notes</p>
                  <p className="text-body mt-0.5 break-words whitespace-pre-line text-text-primary">{student.notes}</p>
                </div>
              ) : (
                <EmptyState size="compact" title="No additional information yet" />
              )}
            </Panel>

            <CommunicationHistory
              studentId={student.id}
              student={{ full_name: student.full_name, student_code: student.student_code, photo_url: student.photo_url }}
              timeZone={timeZone}
              communications={communications}
            />
          </div>

          <div className="flex min-w-0 flex-col gap-6">
            <Panel>
              <PanelHeader
                icon={CreditCard}
                tone="brand"
                title="Membership"
                action={
                  <Button size="sm" render={<Link href={`/students/${student.id}/memberships/new`} />} nativeButton={false}>
                    <Plus className="size-4" aria-hidden="true" />
                    Add Membership
                  </Button>
                }
              />
              {currentMembership ? (
                <MembershipSummaryCard membership={currentMembership} centreName={centre?.name ?? ""} today={today} />
              ) : (
                <EmptyState size="sm" description="No membership yet for this student." />
              )}
            </Panel>

            <MembershipHistory memberships={otherMemberships} />
          </div>
        </div>
      </Container>
    </>
  );
}

/**
 * One batch enrollment as a compact card: the batch mark, name, status and code with its edit action, then its current
 * schedules (Day · Time · Instructor). An enrollment with no current schedule is flagged, as before.
 */
function EnrollmentCard({ studentId, enrollment, schedules }) {
  const batchName = enrollment.batches?.name ?? "Unknown batch";
  const batchCode = enrollment.batches?.code ?? "—";
  const enrollmentStatus = ENTITY_STATUS[enrollment.status] ?? ENTITY_STATUS.inactive;

  return (
    <li className="overflow-hidden rounded-card border border-border">
      <div className="flex items-start gap-3 bg-background/60 px-3 py-2.5">
        <BatchAvatar batch={{ ...enrollment.batches, name: batchName }} size="md" className="shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-body font-semibold break-words text-text-primary">{batchName}</p>
            <Badge variant={enrollmentStatus.variant}>{enrollmentStatus.label}</Badge>
          </div>
          <p className="text-small text-text-secondary">
            Code: <span className="font-medium text-text-primary">{batchCode}</span>
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-brand hover:bg-brand/10 hover:text-brand"
          aria-label={`Edit enrollment in ${batchName}`}
          title="Edit Enrollment"
          render={<Link href={`/students/${studentId}/enrollments/${enrollment.id}/edit`} />}
          nativeButton={false}
        >
          <Pencil className="size-4" aria-hidden="true" />
        </Button>
      </div>

      {schedules.length === 0 ? (
        <p className="text-small border-t border-border px-3 py-2 font-medium text-danger">
          No schedule assigned — this enrollment is not eligible for attendance.
        </p>
      ) : (
        <table aria-label={`${batchName} schedules`} className="w-full table-fixed border-t border-border">
          <thead>
            <tr className="text-small text-left text-text-secondary">
              <th scope="col" className="w-16 px-3 py-1.5 font-medium sm:w-24">Day</th>
              <th scope="col" className="px-2 py-1.5 font-medium">Time</th>
              <th scope="col" className="px-2 py-1.5 font-medium">Instructor</th>
            </tr>
          </thead>
          <tbody>
            {schedules.map((assignment) => {
              const schedule = assignment.schedule;
              if (!schedule) {
                return (
                  <tr key={assignment.id} className="border-t border-border/60">
                    <td colSpan={3} className="text-small px-3 py-1.5 font-medium text-danger">
                      Assigned schedule could not be found
                    </td>
                  </tr>
                );
              }
              const instructor = schedule.instructors;
              return (
                <tr key={assignment.id} className="text-body border-t border-border/60 text-text-primary">
                  <td className="px-3 py-1.5 font-medium">{(DAY_LABELS[schedule.day_of_week] ?? schedule.day_of_week).slice(0, 3)}</td>
                  <td className="px-2 py-1.5">{formatTimeRange(schedule.start_time, schedule.end_time)}</td>
                  <td className="px-2 py-1.5">
                    {instructor?.full_name ? (
                      <span className="flex min-w-0 items-center gap-2">
                        <Avatar name={instructor.full_name} src={instructor.photo_url} size="sm" className="size-6 shrink-0" />
                        <span className="truncate">{instructor.full_name}</span>
                      </span>
                    ) : (
                      <span className="text-text-secondary">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </li>
  );
}
