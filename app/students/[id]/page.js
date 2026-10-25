import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";
import { getCenterSettings, getCenterTimezone, getCentreToday } from "@/lib/center-profile/settings";
import { CalendarDays, CreditCard, FileText, Hash, Layers, Pencil, Plus } from "lucide-react";
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
import { groupSchedulesByTimeSlot, instructorCountLabel, SLOT_TONES } from "@/lib/students/enrollment-schedule-groups";
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
        <StudentHeader student={student} showMenu={false} />

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
 * One batch enrollment as a card: the batch mark, name and status, its code and enrollment date, and the edit action; then its current schedules grouped by time slot
 * (`groupSchedulesByTimeSlot`, presentation only) as a Time | Instructor | Days table. Each distinct time slot is one tinted block in the Time
 * column - the time and "N instructors" - spanning that slot's instructor rows; each instructor is a row with their photo and name and the days
 * they teach that slot as chips. Slot colours cycle through a restrained set, one per slot. An enrollment with no current schedule is flagged, as
 * before. The table scrolls sideways inside the card on a narrow screen rather than overflowing it.
 */
function EnrollmentCard({ studentId, enrollment, schedules }) {
  const batchName = enrollment.batches?.name ?? "Unknown batch";
  const batchCode = enrollment.batches?.code ?? "—";
  const enrollmentStatus = ENTITY_STATUS[enrollment.status] ?? ENTITY_STATUS.inactive;
  const groups = groupSchedulesByTimeSlot(schedules);
  const missingSchedules = schedules.filter((assignment) => !assignment.schedule);

  return (
    <li className="overflow-hidden rounded-card border border-border bg-surface">
      <div className="flex items-start gap-3 px-4 py-3">
        <BatchAvatar batch={{ ...enrollment.batches, name: batchName }} size="md" className="shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-body font-semibold break-words text-text-primary">{batchName}</p>
            <Badge variant={enrollmentStatus.variant}>{enrollmentStatus.label}</Badge>
          </div>
          <p className="text-small mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-text-secondary">
            <span className="inline-flex items-center gap-1">
              <Hash className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="sr-only">Code: </span>
              {batchCode}
            </span>
            {enrollment.effective_start_date ? (
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="size-3.5 shrink-0" aria-hidden="true" />
                Enrolled on {formatDate(enrollment.effective_start_date)}
              </span>
            ) : null}
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
        <p className="text-small border-t border-border px-4 py-2.5 font-medium text-danger">
          No schedule assigned — this enrollment is not eligible for attendance.
        </p>
      ) : (
        <div className="overflow-x-auto border-t border-border">
          <table aria-label={`${batchName} schedules`} className="w-full min-w-[28rem]">
            <thead>
              <tr className="text-small bg-brand/5 text-left text-text-secondary">
                <th scope="col" className="w-44 px-4 py-2 font-medium sm:w-52">Time</th>
                <th scope="col" className="px-2 py-2 font-medium">Instructor</th>
                <th scope="col" className="px-2 py-2 font-medium">Days</th>
              </tr>
            </thead>
            {groups.map((group, groupIndex) => (
              <tbody key={group.key} className="border-t border-border first:border-t-0">
                {group.rows.map((row, rowIndex) => (
                  <tr key={row.key} className={rowIndex === 0 ? "" : "border-t border-border/60"}>
                    {rowIndex === 0 ? (
                      <td rowSpan={group.rows.length} className="p-1.5 align-middle">
                        <div className={`flex h-full min-h-14 flex-col items-center justify-center rounded-lg px-3 py-2 text-center ${SLOT_TONES[groupIndex % SLOT_TONES.length]}`}>
                          <span className="text-[0.8125rem] leading-5 font-semibold whitespace-nowrap">{formatTimeRange(group.startTime, group.endTime)}</span>
                          <span className="text-small opacity-80">{instructorCountLabel(group.instructorCount)}</span>
                        </div>
                      </td>
                    ) : null}
                    <td className="text-body px-2 py-2.5 text-text-primary">
                      {row.instructor ? (
                        <span className="flex min-w-0 items-center gap-2.5">
                          <Avatar name={row.instructor.full_name} src={row.instructor.photo_url} size="md" className="shrink-0" />
                          <span className="truncate">{row.instructor.full_name}</span>
                        </span>
                      ) : (
                        <span className="text-text-secondary">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2.5">
                      <ul className="flex flex-wrap gap-1.5">
                        {row.days.map((day) => (
                          <li key={day} className="text-small rounded-md border border-border bg-brand/5 px-2.5 py-1 font-medium text-text-primary">
                            {(DAY_LABELS[day] ?? day).slice(0, 3)}
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
            {missingSchedules.map((assignment) => (
              <tbody key={assignment.id} className="border-t border-border/60">
                <tr>
                  <td colSpan={3} className="text-small px-4 py-2.5 font-medium text-danger">
                    Assigned schedule could not be found
                  </td>
                </tr>
              </tbody>
            ))}
          </table>
        </div>
      )}
    </li>
  );
}
