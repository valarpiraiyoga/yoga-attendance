# Yoga Center Attendance Management App — Product

## 1. Product Concept

### Product Overview
A web-based management application for a yoga center to manage students, memberships, batches, class schedules, and daily attendance.

The product is centered around the yoga center's recurring batch schedule. Administrators can create and manage batches, define recurring schedules, assign students and instructors, manage memberships, and make future schedule changes without affecting historical attendance.

Instructors can view their assigned classes and quickly record student attendance for each class session.

The product also provides attendance history and basic reporting to help the yoga center understand student participation.

### Primary Goal
Make daily attendance management fast and simple while providing the yoga center with a reliable way to manage changing batches, schedules, student enrollments, and membership periods.

### Core Product Model
Student → Membership + Batch Enrollment → Batch → Recurring Schedule → Class Session → Attendance

A batch enrollment additionally carries one or more **schedule assignments**, which decide *which* of the batch's recurring schedules that student actually attends. Enrolling a student in a batch is therefore not by itself enough to make them eligible for every one of that batch's classes — see §4 "Schedule Assignment" and §8 "Eligibility".

### Initial Users
1. Admin
2. Instructor

Students will be managed by the center in V1 and will not require their own login.

### Initial Product Areas
- Dashboard
- Students
- Memberships
- Batches
- Schedule
- Attendance
- Attendance History
- Reports
- Settings

---

## 2. Users & Roles

### Admin
Full management access to Dashboard, Students, Memberships, Batches, Schedule, Attendance, Attendance History, Reports, Settings, and Instructor management.

### Instructor
Can view their dashboard, assigned classes, relevant class sessions, take attendance, edit attendance for their own assigned sessions, and view relevant attendance history.

### V1 Roles
Only Admin and Instructor are supported in V1.

---

## 3. Dashboard

### Purpose
Provide Admin and Instructor with a quick overview of today's activities and direct access to important actions.

### Admin Dashboard
- Today's date
- Active student summary
- Active batch summary
- Number of today's scheduled classes
- Today's attendance summary
- Today's class/session list
- Class time
- Batch name and code
- Instructor
- Student count
- Session status
- Direct access to attendance
- Upcoming classes

Admin sees all today's classes.

### Instructor Dashboard
- Today's date
- Instructor's scheduled classes
- Class time
- Batch name and code
- Student count
- Session status
- Direct access to attendance
- Upcoming classes

Instructor sees only their assigned classes.

### Session Status
- Upcoming
- Ongoing
- Completed
- Cancelled
- Holiday

### Principle
Today's Classes are the primary operational content. The dashboard prioritizes daily tasks rather than complex analytics.

---

## 4. Students

### Purpose
Maintain students and manage their batch enrollments and attendance history.

### Student Information
- Student ID
- Full name
- Phone
- Email — optional
- Date of birth — optional
- Gender — optional: Male / Female / Other
- Join date
- Profile photo — optional
- Status: Active / Inactive
- Notes — optional

### Management
Admin can view, search, add, edit, activate/deactivate students, assign students to batches, change batch enrollments, and view attendance history.

### Multiple Batch Enrollment
A student can belong to multiple batches at the same time, supporting combo offers.

### Batch Changes
A student can change batches. Enrollment must retain effective start/end dates so historical attendance remains correct.

### Schedule Assignment
A batch may run several recurring schedules, including more than one on the same weekday (§6, §7). A student enrolled in that batch does not automatically attend all of them: the enrollment records which schedules that student attends.

- Schedule assignment belongs to the batch enrollment, not to the student directly. A student attending the same batch across two separate enrollment periods therefore has separate assignments for each.
- One enrollment may carry several schedule assignments at once — a student attending both the 6:00 AM and the 7:00 PM class of the same batch holds two.
- A batch enrollment should have at least one schedule assignment. An enrollment with none makes the student eligible for nothing, which is a configuration mistake rather than a meaningful state.
- Assignments are assigned to a schedule's stable identity (§7 "Schedule Series"), not to one particular version of it, so an admin editing a schedule's time or instructor never detaches the students who attend it.
- Overlapping times across a student's own assignments are not blocked, consistent with §7 "Conflicts".

### Schedule Assignment Effective Dates
Each schedule assignment carries an effective start date and an optional effective end date. There is no separate active/inactive flag: an assignment applies to exactly the dates its period covers.

Changing which schedule a student attends closes the existing assignment on the day before the change takes effect and creates a new assignment from that date. The earlier assignment is retained, never rewritten, so what a student was scheduled to attend on any past date can always be reconstructed — the same principle §7 applies to schedule versions and §5 applies to memberships.

The one exception is an assignment that has not started yet when it is removed — one whose effective start date is on or after the date the removal takes effect. It has no past to reconstruct and cannot be closed on the day before it starts, so it is withdrawn (deleted) rather than left as a one-day assignment that would still apply on the change date. An assignment that has already covered any past day is never deleted.

### Deactivation
Inactive students remain in the system. Deactivation does not remove historical student, membership, enrollment, or attendance records.

---

## 5. Memberships

### Purpose
Manage the student's valid membership period and use it as part of attendance eligibility.

### Plans
- Monthly
- Quarterly
- Custom duration

### Membership Information
- Membership ID
- Student
- Plan
- Start date
- End date
- Amount
- Payment status
- Status
- Notes — optional

### Payment Status
- Paid
- Pending

No online payment gateway is required for V1. Payment Status defaults to Pending.

### Membership Status
- Upcoming
- Active
- Expired
- Cancelled

Upcoming, Active, and Expired are determined by comparing the current date to
the membership's start and end dates. Cancelled is a separate, explicit state
that overrides any date-derived status.

Membership start and end dates are calendar dates, both inclusive, and "the current
date" is the date at the centre, evaluated in the centre timezone
(the centre's configured time zone, §7A and §11 Regional Settings) — never the server's UTC date. A membership that starts and
ends on the same day is Active for that day and Expired from the next centre day,
so the membership status, days left and progress shown on Membership screens agree
with attendance eligibility, which compares the same dates against the class
session's own date (§8).

### End Date
End date is calculated from the selected plan and start date, but remains
editable:
- Monthly: start date + 1 month − 1 day
- Quarterly: start date + 3 months − 1 day
- Custom duration: entered manually

End date cannot precede start date. A same-day start and end date is allowed.

### Renewal
Every renewal creates a new membership record. Previous membership records remain available for historical purposes. The new membership's start date defaults to the previous membership's end date plus one day, editable if needed.

### Cancellation
Cancelling a membership retains the record; it is not deleted. An already-cancelled membership cannot be cancelled again. Cancellation does not affect batch enrollment.

### Eligibility
Membership is one of the conditions a student must meet to appear in attendance: their membership must be active on the class session date. The full set of conditions — active student, active batch enrollment, a schedule assignment for the session's schedule series, and an active membership — is defined in §8 "Eligibility".

Membership and batch enrollment are independent. One membership can cover multiple batch enrollments, and one membership covers every schedule the student is assigned to.

### Expiry
When membership expires, the student remains in the system and historical records remain available, but the student is not normally eligible for attendance until a valid membership is active again.

---

## 6. Batches

### Purpose
Represent the yoga class types offered by the center.

### Initial Real-World Batches
- PMS — Pranayama & Meditation Session
- HYG — Hatha Yoga General
- HYI — Hatha Yoga Intermediate
- HYL — Hatha Yoga Ladies
- AYS — Advanced Yoga Skills
- KYS — Kids Yoga Session
- AYP — Aerial Yoga Practice

These are initial data only and are not hard-coded limitations.

### Batch Information
- Batch name
- Short code
- Description — optional
- Category — optional
- Status: Active / Inactive

Batch capacity is not required in V1.

### Management
Admin can create, edit, activate, and deactivate batches.

### Batch/Schedule Relationship
A batch is not tied to one fixed time. The same batch can have multiple schedules across different days and times, **including several on the same weekday** — Hatha Yoga General running Monday at 6:00 AM, 7:00 AM, 5:00 PM and 7:00 PM is four schedules of one batch, not four batches.

Each of those schedules produces its own class sessions, and students enrolled in the batch attend only the ones they are assigned to (§4 "Schedule Assignment").

### Instructor Relationship
Instructors are assigned at the schedule level, allowing different instructors for different schedules of the same batch.

### Deactivation
Deactivated batches are retained. Historical enrollments, sessions, and attendance remain available.

---

## 7. Schedule

### Purpose
Define when each batch takes place so the system can generate/identify class sessions and provide the correct attendance workflow.

The current Yoga Center timetable is initial schedule data, not a fixed application structure.

### Schedule Information
- Batch
- Day of week
- Start time
- End time
- Instructor
- Status: Active / Inactive
- Effective from
- Effective until — optional

### Recurring Weekly Schedule
The system supports recurring weekly schedules. The same batch can appear multiple times across different days and times.

### Instructor
Each schedule can have its own instructor.

### Class Duration
Default duration is 60 minutes. When Admin enters a start time, the system automatically calculates the end time one hour later. The Admin can edit the calculated end time.

### Management
Admin can add new schedules anytime, edit schedules, change future schedules, deactivate schedules, delete unused schedules, assign instructors, and set effective dates.

### Future Changes
Changes to recurring schedules apply to future sessions only. Past sessions and historical attendance remain unchanged.

Editing a schedule's day, time or instructor is therefore versioned rather than applied in place: the existing schedule is closed by setting its effective until date to the day before the change takes effect, and a new schedule version is created starting from that date. The earlier version remains available, so what was scheduled on any past date can always be reconstructed.

Which of those two things happens depends on whether the schedule being edited has ever been in effect:

1. **The schedule has already started** — the new effective from date falls after the current version's own effective from date. The current version is closed at the day before the new date, and a new version carries the edited values forward. This is the ordinary case.
2. **The schedule has not started yet** — the new effective from date falls on or before the current version's own effective from date. There is no elapsed period to preserve, so the current version is updated in place. Versioning here would have to close the current version before it ever began, which is not a period that can be expressed.
3. **The new effective from date is before today** — rejected. Back-dating a change would rewrite what was scheduled on a date that has already passed.

Both of the first two outcomes leave every schedule version with an effective period that starts on or before it ends; the third is what keeps the past out of reach of an edit.

### Unused Schedules — Direct Correction and Deletion
A schedule that has not become part of the historical record can be corrected or removed outright. Versioning exists to protect history; a schedule that has none needs no protecting. A schedule is **unused** when, together:

1. **No class session references it** — of any status. A materialized session (§7A) is historical data even when it has no attendance: a Cancelled or Holiday session, an edited session, or one whose attendance was saved all count.
2. **Its schedule series has exactly one schedule version.** An edit that versioned it created another; the version chain is history and is never deleted.
3. **No schedule assignment (§4) on its series has started** — every assignment starts today or later in the centre's timezone (§7A "Centre Timezone"). An assignment that has already covered a past day is history.

Occurrences that were only ever projected (§7A) — including past dates nobody recorded anything for — are not sessions and do not make a schedule used.

**Direct edit.** An unused schedule is edited in place — day, time, instructor and effective dates — with no new version and no need to choose an effective date. The days work as when adding: unticking the schedule's own day and ticking another moves it; any other ticked day creates a new schedule. If students hold unstarted assignments on it, changing its day moves those assignments with it, and Review says so. Every other schedule keeps the versioned edit above.

**Delete.** An unused schedule can be deleted. Its unstarted schedule assignments are withdrawn with it (§4), and its now-empty schedule series is removed. Before confirming, Admin is told how many students are affected, and how many past occurrences were never recorded and will no longer appear. A schedule that is not unused cannot be deleted; Deactivate is how it stops.

Both are decided by the database in the same transaction as the change, not from what the screen last showed: a session materialized after the confirmation opened blocks the change instead of being lost. Deleting does not create, cancel or alter any session.

### Schedule Series
Versioning means a single real-world class — "the Monday 6:00 AM Hatha Yoga class" — is represented over time by a succession of schedule versions, each with its own effective period. A **schedule series** is the stable identity those versions share: editing a schedule creates a new version within the same series, never a new series.

The series is what everything outside the Schedule area refers to when it means "that class":

- Student schedule assignments (§4) are held against the series, so an admin editing a schedule's time or instructor never orphans the students who attend it.
- Attendance eligibility (§8) matches a class session's schedule to the series a student is assigned to, not to one particular version.

A class session still records the specific version it was generated from (§7A), so what the class actually looked like on a given date remains exact. The series answers "which class is this?"; the version answers "what were its details then?".

### Conflicts
V1 does not prevent overlapping schedules. A batch may hold more than one schedule covering the same day and time, and an instructor may be assigned to more than one schedule at the same day and time. These situations are visible to the Admin in both Schedule views — listed in the List View, and shown side by side in the Weekly Schedule grid — and are treated as an operational judgement, not a system-enforced constraint.

### Elapsed Effective Period
A schedule whose effective until date has passed remains stored as Active or Inactive exactly as the Admin left it. Status is never rewritten automatically. Where it is useful, the interface may additionally indicate that the schedule's effective period has ended, derived from the dates rather than stored.

### Specific Future Session Changes
Admin can change one specific future session without changing the recurring schedule.

### Cancellation / Holiday
A specific session can be marked Cancelled or Holiday. Such sessions do not require attendance and the recurring schedule remains unchanged.

### Deactivation
A schedule that has been used is deactivated rather than deleted — it is closed with an effective until date and marked inactive. Historical sessions and attendance remain available. Only an unused schedule (see "Unused Schedules") can be permanently deleted; a schedule with a class session, an earlier version, or a started student assignment never can.

### Online / Offline
Online/offline is not a required property of the recurring schedule. Students may attend online or offline based on their circumstances. V1 attendance records only Present or Absent.

---

## 7A. Class Sessions

Numbered 7A rather than 8 deliberately: this section was added after the
rest of the document, and renumbering the sections below it would
invalidate the section references already cited throughout the codebase.

### Purpose
A class session is one dated occurrence of a recurring schedule. It is the record attendance attaches to, and the point at which the product model stops describing a repeating pattern and starts describing a specific class that did or did not happen (§1: Batch → Recurring Schedule → Class Session → Attendance).

### Relationship to Schedule
Every class session belongs to exactly one recurring schedule. There are no ad-hoc sessions in V1 — a session cannot exist without a schedule to derive it from. Creating a one-off class therefore means creating a schedule for it, not creating a session directly.

### Projection and Materialization
Section 7 says a recurring schedule is used to "generate or identify" class sessions. That is resolved as follows.

Occurrences are **projected** from the recurring pattern for display: the system calculates which dates a schedule falls on and shows them, without storing anything. A session is **materialized** — written as a real, persistent record — the first time something must attach to that specific occurrence:

1. a session-specific change (Edit This Session),
2. marking it Cancelled or Holiday,
3. attendance being recorded against it.

Until one of those happens, no session record exists and the occurrence is purely calculated.

This avoids a generation job and avoids drift: an occurrence that nobody has touched always reflects the current schedule version, and an occurrence that someone *has* touched is fixed at the moment it was touched.

### Session Information
- Schedule — required
- Batch — snapshot
- Instructor — snapshot
- Session date
- Start time — snapshot
- End time — snapshot
- Status
- Note — optional

Duration is derived from start and end time and is never stored. A class session has no product-facing identifier: unlike Student ID and Membership ID, nothing in the product or the approved wireframes identifies a session by a code, so none is assigned.

### Session Status
Four states are persisted:

- `scheduled`
- `completed`
- `cancelled`
- `holiday`

Five statuses are displayed, exactly as listed in §3:

| Displayed | Derived from |
|---|---|
| Upcoming | persisted `scheduled`, and the current time is before the session's start time |
| Ongoing | persisted `scheduled`, and the current time falls from start time through end time, inclusive |
| Completed | persisted `scheduled` with the current time after end time, **or** persisted `completed` |
| Cancelled | persisted `cancelled` |
| Holiday | persisted `holiday` |

Upcoming and Ongoing are therefore never stored — they are readings of the same `scheduled` state at different moments, and storing either would go stale the moment the clock passed it. A projected occurrence that has not been materialized behaves as `scheduled`.

Completed is different: it has both a stored form and a purely displayed one, and the two must not be confused. A `scheduled` session whose end time has passed is *shown* as Completed the moment anyone looks at it, but its stored status stays `scheduled` — nothing about looking at a session, or the clock simply moving past its end time, ever writes to the database. The stored value only becomes `completed` when attendance is saved for the session (§8), a separate, explicit, later event. Conflating "displays as Completed" with "is recorded as completed" would let the clock silently change a stored value, which is exactly what §12's Historical Integrity rules forbid elsewhere in this product.

### Centre Timezone
Upcoming, Ongoing and the displayed-Completed reading above all depend on what time it is *at the centre*, so all three are derived against the **centre's timezone** — a single Center Setting (§11 "Regional Settings"), an IANA identifier such as `Asia/Kolkata` or `America/New_York`, whose daylight-saving rules come from the IANA time zone database. It defaults to **Asia/Kolkata**, which is what an existing centre keeps. The timezone belongs to the centre: it never depends on the browser, device or location of the admin, instructor or student viewing the app. There is no per-user, per-branch or per-schedule timezone — multi-branch management is explicitly outside V1 (§13).

### Snapshot and Historical Integrity
When a session is materialized it snapshots its batch, instructor, date, start time and end time. Those snapshot values are authoritative for that session from then on:

- A later schedule edit, version or deactivation never rewrites an existing session.
- Only future occurrences that have not been materialized follow the current schedule version.
- A specific future session is changed through Edit This Session, which affects that session alone and leaves the recurring schedule untouched (§7).

This is what makes §12's Historical Integrity rules hold in practice: a session that has already been cancelled, altered or attended keeps the details it had at the time, no matter what happens to the schedule afterwards.

### Inactive or Ended Schedules
An inactive schedule version, or one whose effective period has ended, produces no further unmaterialized occurrences. Sessions that were already materialized under it remain available and are never deleted.

### Editing a Specific Session
A specific session's instructor and/or time can be changed without changing the recurring schedule (§7 "Specific Future Session Changes"). Its date and batch cannot change on a session edit — a session belongs to exactly one schedule and date; moving it to a different day or batch is a schedule change, not a session exception.

Only a session currently displayed as Upcoming can be edited. Editing an Ongoing session is not permitted, since the class is already underway; editing a Completed session would rewrite what happened, which §12's Historical Integrity rules forbid; a Cancelled or Holiday session has nothing to reschedule.

Editing materializes the session, same as Cancellation and Holiday below, and only when the edit actually changes something — opening the edit screen, or confirming it unchanged, writes nothing.

### Cancellation and Holiday
A specific session can be marked Cancelled or Holiday, with an optional note. Doing so materializes the session. The recurring schedule is unchanged, other occurrences of it are unaffected, and the session requires no attendance (§8).

Only a session whose stored status is still `scheduled` can be marked — not one already `completed`, `cancelled` or `holiday`. This is checked against the stored status, not the displayed one: a `scheduled` session may be marked whether it currently displays as Upcoming, Ongoing, or a clock-derived Completed reading, since none of those are a real stored `completed`. Once attendance exists (§8), a session only ever becomes stored `completed` when its attendance is saved — so this same rule then also means a session with attendance already recorded cannot be cancelled or marked holiday, without needing a separate check for that.

Marking a session Cancelled or Holiday cannot be reversed in V1. There is no un-cancel action, matching how an already-cancelled membership cannot be cancelled again (§5).

### Data Requirements
- At most one session per schedule per date.
- A session always references its schedule, batch and instructor; those references restrict deletion rather than cascading.
- Sessions are never deleted — cancellation replaces deletion, matching every other entity in this product.
- Admin-only in V1. Instructors will need read access to their own sessions when Attendance is introduced (§8).

---

## 8. Attendance

### Purpose
Allow instructors and administrators to quickly record and maintain attendance for each class session.

### Eligibility
Only students meeting all four conditions are shown:
1. The student is active.
2. Active enrollment in the relevant batch, covering the class session's own date — the enrollment's status is active, its effective start date is on or before the session date, and its effective end date (if any) is on or after the session date.
3. A schedule assignment on that enrollment covering the session date, for the same schedule series the class session belongs to (§4 "Schedule Assignment", §7 "Schedule Series"). Being enrolled in the batch is not sufficient: a student assigned only to the 6:00 AM class is not eligible for the same batch's 7:00 PM class.
4. Active membership covering the class session date — the membership's start and end dates cover the session date, and the membership was not yet cancelled as of that date (see Membership below).

Eligibility is always evaluated against the class session's own date, never against today — a past session's eligible list reflects who qualified on that date, not who qualifies now. The batch used is the class session's own batch (its snapshot once materialized, §7A), not the recurring schedule's current batch; the schedule series used is the one the session's own schedule belongs to, so a session generated before a schedule edit and one generated after it both resolve to the same series and the same assigned students.

An inactive student is excluded from new eligibility from that point on; a session that already has an attendance record for a student who later became inactive keeps that record regardless (Historical Integrity, §12).

### Status
V1 supports only:
- Present
- Absent

### Workflow
- Show eligible students only.
- Students initially have an unmarked state.
- Mark individual students.
- Use Mark All Present.
- Change individual statuses.
- Save attendance.

Unmarked is never itself stored — an eligible student with no attendance record for the session is unmarked; a status other than Present or Absent does not exist as a stored value. Attendance can be saved with some or all students still unmarked; saving still completes the session (see Completion).

Attendance can only be taken for a session whose date is today or earlier, in the centre timezone (§7A). A future-dated session has nothing to record yet.

### Completion
After attendance is saved, the class session is marked Completed — regardless of how many students were marked.

### Editing
Instructors can edit attendance for their own assigned sessions. Admins can edit any attendance record.

### Deletion
Attendance records are not permanently deleted as part of normal correction. Corrections update the record while preserving historical information.

### Cancelled / Holiday
Cancelled or Holiday sessions do not require attendance and should not show a normal attendance action.

### Enrollment Changes
Students appear according to their active batch enrollment for the session. Historical attendance remains associated with the original batch/session.

### Membership
Expired membership does not remove historical attendance. A student without active membership on the session date is not normally eligible.

A membership's cancellation only affects eligibility for session dates on or after the cancellation date. Cancelling a membership today must not retroactively remove eligibility for a session that already happened while the membership was still active.

### Summary
Show:
- Total eligible students
- Present count
- Absent count
- Attendance percentage

Attendance percentage is Present ÷ Eligible × 100, not Present ÷ Marked — a session with unmarked students shows a correspondingly lower percentage rather than looking complete. A session with zero eligible students shows 0%, never an error.

### Online / Offline
Not mandatory in V1. Both online and offline participation count simply as Present. Attendance mode may be considered later if the center needs it.

---

## 9. Attendance History

### Purpose
Allow Admin and Instructors to review attendance while protecting historical information.

### Filters
- Date / date range
- Batch
- Student
- Instructor
- Attendance status

### Admin
Can view all attendance history.

### Instructor
Can view attendance history related to their assigned classes.

### Student History
Can show sessions, present count, absent count, and attendance percentage.

### Batch History
Can show sessions, attendance totals, and attendance percentage.

### Historical Integrity
Historical attendance remains available when a student changes batches, leaves a batch, membership expires, a batch becomes inactive, or a schedule changes.

### Editing
History is read-only by default. An explicit Edit action is used for corrections.

---

## 10. Reports

### Purpose
Provide useful attendance summaries without unnecessary complex analytics.

### Student Attendance Report
Filters: Student, Date range.
Shows: Sessions, Present, Absent, Attendance percentage.

### Batch Attendance Report
Filters: Batch, Date range.
Shows: Number of sessions, attendance totals, average attendance.

### Daily / Date-Range Summary
Filters: Date or date range.
Shows: Total sessions, total present, total absent, overall attendance percentage.

### Export
Admin can export attendance reports to CSV and Excel.

### Google Sheets
Google Sheets export/integration may be supported. Google Sheets is an export/report destination, not the primary data store. Supabase/PostgreSQL remains the system of record. Live two-way synchronization is not required for V1.

### Report Scope
V1 focuses on attendance reporting. Revenue, retention, marketing analytics, AI insights, and other advanced analytics are future possibilities only.

---

## 11. Settings

### Center Profile
Admin can manage:
- Yoga Center name
- Logo
- Address
- Phone
- Email

Center profile information can also be used in exported reports.

### Regional Settings
Part of Center Profile. Admin can set:
- **Time Zone** — the centre's IANA time zone (searchable by country, city or identifier). Default **Asia/Kolkata**. It is the business timezone for every date the application derives: today, session status, membership validity, attendance eligibility, schedule dates (§7A "Centre Timezone").
- **Currency** — the centre's ISO 4217 currency code (searchable by code, name or symbol). Default **INR**. It controls how amounts are displayed, and which currency **new** memberships are priced in.

Changing the currency never converts an amount. Each membership records the currency it was priced in (existing memberships are INR), so past amounts keep their original meaning after the centre changes currency; a renewal starts blank rather than carrying over an amount priced in a different currency.

The Logo is uploaded from Center Profile (PNG, JPG or WebP, up to 2 MB) and appears in the application's brand slot and on receipts.

### Instructors
Admin can:
- Add instructor
- Edit instructor
- Activate/deactivate instructor
- Assign instructor to individual schedules
- Provide instructor login access

Instructor is an independent entity and is assigned at the schedule level.

### Roles & Permissions

#### Admin
Full access to all product areas and management functions.

#### Instructor
Access to Dashboard, assigned classes, Attendance, and relevant Attendance History.

Instructor does not manage global Students, Memberships, Batches, Schedules, Reports, or Settings.

---

## 12. Core Business Rules

### Student
- Student ID is system-generated, unique, and immutable.
- Student ID uses the sequential format YC-000001.
- A student can belong to multiple batches simultaneously.
- A student can change batches.
- Batch enrollment has an effective period.
- A student has at most one active enrollment in the same batch at a time.
- Inactive enrollments for the same batch are retained, so a student can re-enroll after leaving.
- Inactive students are retained.
- Historical student data is not removed simply because the student becomes inactive.
- A batch enrollment records which of the batch's schedules the student attends.
- Schedule assignment belongs to the batch enrollment, not to the student directly.
- One enrollment can hold several schedule assignments at the same time.
- A batch enrollment should have at least one schedule assignment.
- Schedule assignments are held against a schedule series, not a single schedule version.
- Schedule assignments have an effective period and no separate status; the dates alone determine validity.
- Changing a student's schedule closes the existing assignment and creates a new one from the effective date; earlier assignments are retained, never rewritten.
- Overlapping times across a student's own schedule assignments are not blocked.

One active enrollment per batch keeps attendance eligibility unambiguous: a duplicate active enrollment would list the same student twice for a single class session.

### Membership
- Membership ID is system-generated, unique, and immutable.
- Membership ID uses the sequential format MEM-000001.
- Membership is independent of batch enrollment.
- One membership can cover multiple batch enrollments.
- Covered batch enrollments are derived from enrollment effective dates that overlap the membership period, not stored directly.
- Membership status (Upcoming/Active/Expired) is derived from the current date, not stored; cancellation overrides any date-derived status.
- A student cannot have overlapping non-cancelled membership periods.
- Cancelled memberships are excluded from the overlap rule.
- End date is calculated from plan and start date but remains editable.
- End date cannot precede start date; a same-day start and end date is allowed.
- Renewal's default start date is the previous membership's end date plus one day.
- Payment status does not determine membership status.
- Attendance eligibility requires active membership on the session date.
- Renewals create new membership records.
- Expired memberships remain in history.
- Cancelled memberships remain in history; cancellation does not delete the record.

Deriving status from dates, rather than storing it, prevents a membership from silently remaining Active after its end date passes. Overlap prevention keeps a student's eligibility unambiguous on any date — the same reasoning as one active enrollment per batch.

### Batch
- A batch can have multiple recurring schedules.
- A batch can have more than one schedule on the same weekday, at different times.
- A batch does not have a fixed time.
- Enrolling in a batch does not by itself mean attending every one of its schedules.
- Batch capacity is not required in V1.
- Short code is required.
- Short code must be unique, compared case-insensitively.
- Short codes are normalized to uppercase.
- Inactive batches remain available for historical records.

Short code uniqueness protects identification. The Weekly Schedule identifies a batch by its short code alone, without the batch name, so two batches sharing a code would make a calendar entry ambiguous.

### Schedule
- Schedules recur weekly.
- A batch can have different days/times, including several schedules on the same weekday.
- Every schedule belongs to a schedule series, the stable identity its versions share.
- Editing a schedule creates a new version within the same series, never a new series.
- Student schedule assignments and attendance eligibility refer to the series, so an edit never orphans them.
- A class session records the specific schedule version it came from, while the series identifies which class it is.
- A schedule can have its own instructor.
- Every schedule requires both a batch and an instructor.
- Day of week is stored as a lowercase value (monday–sunday).
- Default class duration is 60 minutes.
- End time is automatically calculated but editable.
- End time must be later than start time.
- Effective until, when set, cannot be earlier than effective from.
- Future schedule changes must not modify past sessions.
- Editing a schedule's day, time or instructor closes the current version and creates a new one effective from the chosen date.
- A schedule that has not started yet is edited in place instead, since it has no elapsed period to preserve.
- An edit cannot take effect before today.
- Overlapping schedules are not blocked in V1, for either a batch or an instructor.
- An elapsed effective period does not change a schedule's stored status.
- Individual future sessions can have exceptions.
- Cancelled/Holiday sessions do not require attendance.
- A schedule that has been used is deactivated rather than deleted.
- An unused schedule — no class session, a single version, no started assignment — may be deleted, and may be edited directly instead of versioned.
- A schedule with any class session (any status), an earlier version, or a started student assignment is never deleted and is never edited in place.
- A schedule version is never deleted on its own.

Versioning schedule edits is what makes "future changes only" true: a schedule that was rewritten in place would silently change what the past looked like, which §12's Historical Integrity rules forbid.

### Class Session
- Every class session belongs to exactly one recurring schedule.
- There are no ad-hoc class sessions in V1.
- At most one session exists per schedule per date.
- Occurrences are projected from the recurring pattern until a session needs a persistent record.
- A session is materialized on its first session-specific change, cancellation/holiday, or attendance.
- A materialized session snapshots its batch, instructor, date, start time and end time.
- Snapshot values win over later schedule changes.
- Schedule edits, versioning and deactivation never rewrite an existing session.
- Only future unmaterialized occurrences follow the current schedule version.
- Inactive or ended schedule versions produce no further unmaterialized occurrences.
- Materialized sessions are retained and never deleted.
- Persisted session states are scheduled, completed, cancelled and holiday.
- Upcoming, Ongoing, and a displayed Completed reading of a scheduled session past its end time are all derived from the session's date and time in the centre timezone (§7A), never stored.
- A scheduled session past its end time is never automatically persisted as completed — only displayed as Completed.
- A session's stored status becomes completed only when its attendance is saved.
- Duration is derived from start and end time.
- A class session has no product-facing identifier.
- A session's instructor and/or time can be edited without changing the recurring schedule; its date and batch cannot.
- Only an Upcoming session can be edited.
- Editing a session materializes it, and only when the edit actually changes something.
- A session can be marked Cancelled or Holiday, with an optional note, only while its stored status is still scheduled.
- Marking a session Cancelled or Holiday materializes it and does not change the recurring schedule or any other occurrence.
- Marking a session Cancelled or Holiday cannot be reversed in V1.

Materializing only on first touch is what keeps a schedule and its sessions from drifting apart: an untouched occurrence is always a live reading of the current schedule, and a touched one is a fixed historical fact. Storing every occurrence up front would require both a generation job and a reconciliation rule for what to do with rows generated from a schedule version that no longer exists.

### Attendance
- Attendance belongs to a specific class session.
- At most one attendance record exists per student per session.
- Only eligible students appear for attendance.
- Eligibility requires an active student, active batch enrollment covering the session date, a schedule assignment covering the session date for the session's own schedule series, and active membership covering the session date — all evaluated as of the session's own date.
- Being enrolled in a batch is not sufficient; the student must be assigned to the specific schedule the session belongs to.
- A membership cancellation only affects eligibility for session dates on or after the cancellation date.
- V1 statuses are Present and Absent.
- Unmarked is never stored — it is the absence of an attendance record for an eligible student, not a value.
- Attendance can only be taken for a session dated today or earlier, in the centre timezone.
- Saving attendance is allowed with some or all students unmarked, and still completes the session.
- Online/offline does not change attendance status.
- Attendance remains historically available.
- Attendance records are never deleted; a correction updates the record in place.
- Admin can edit all attendance.
- Instructor can edit attendance for their assigned sessions.

### Historical Integrity
Historical records must be protected when:
- Membership expires
- Membership is renewed
- Student changes batch
- Student leaves a batch
- Batch is deactivated
- Schedule changes
- A future session is modified or cancelled

---

## 13. MVP Scope

### Included in V1
- Admin authentication
- Instructor authentication
- Role-based access
- Dashboard
- Student management
- Multiple batch enrollment
- Membership management
- Batch management
- Recurring schedule management
- Instructor assignment
- Schedule changes and exceptions
- Class sessions
- Present/Absent attendance
- Attendance editing
- Attendance history
- Student attendance reports
- Batch attendance reports
- Daily/date-range summaries
- Attendance percentage
- CSV/Excel export
- Center profile
- Basic settings

### Not Included in V1
- Student login
- Online payment gateway
- Automatic billing
- Payment reminders
- WhatsApp/SMS/email integrations
- QR attendance
- Face recognition
- Student mobile app
- Advanced analytics
- AI features
- Multi-branch management
- Live Google Sheets synchronization

These can be evaluated later if a genuine product requirement emerges.

---

## 14. Future Possibilities

Potential future features:
- Student login and self-service profile
- Online payment integration
- Automated membership renewal
- Payment reminders
- Online/offline attendance reporting
- Notifications
- QR-based attendance
- Mobile application
- Advanced analytics
- Additional staff roles
- Multi-location support
- Google Sheets automation/synchronization

Future features should only be added when there is a clear user or business need.

---

## 15. Product Principles

### Keep attendance fast
The instructor's primary task should require minimal interaction.

### Keep the schedule flexible
The center must be able to change batches and schedules without code changes.

### Protect history
Past attendance and historical records must not be damaged by future changes.

### Separate concepts
Keep Student, Membership, Batch, Enrollment, Schedule Assignment, Recurring Schedule, Class Session, and Attendance distinct.

### Don't overbuild V1
Only add features that solve a real product need.

### Design before development
UX/UI will be designed and reviewed in Figma before main application development begins.

### Figma as Design Source of Truth
Figma is the source of truth for UX, UI, design system, layout, components, interaction design, responsive behavior, and prototype.

### MD as Product Source of Truth
This document is the living written source of truth for product decisions, requirements, business rules, scope, and important constraints. It can be updated when new product decisions are made.

---

## 16. Project Status

- Product Concept — APPROVED
- Dashboard — APPROVED
- Students — APPROVED
- Batches — APPROVED
- Memberships — APPROVED
- Schedule — APPROVED
- Class Sessions — APPROVED
- Attendance — APPROVED
- Attendance History — APPROVED
- Reports — APPROVED
- Settings — APPROVED

### Completed
- **Product Definition / Requirements** — Complete
- **UX** — Information Architecture, user flows and UX foundation complete (`02-ux.md`)
- **Wireframes** — Approved (`wireframe/Yoga Attendance.pdf`)
- **Visual Tokens** — Approved (`03-visual-tokens.md`)
- **Frontend Foundation** — Project foundation, shadcn/ui foundation and the
  Application Shell are implemented and checkpointed in Git

### Current Phase
**Frontend Implementation** — proceeding feature-by-feature.

The implementation sequence, phase status, dependencies and validation
checkpoints are maintained in `04-development-plan.md`. This document does not
track implementation sequencing.

### Where to look

| Need | Document |
|---|---|
| Product requirements, business rules, V1 scope | `01-product.md` (this document) |
| Information architecture, UX flows, screen requirements | `02-ux.md` |
| Colors, typography, spacing, radius, shadows | `03-visual-tokens.md` |
| Implementation sequence and phase status | `04-development-plan.md` |

---

## 17. Source-of-Truth Structure

This project intentionally uses a small documentation structure:

```text
docs/
├── 01-product.md              ← product requirements and business rules
├── 02-ux.md                   ← information architecture, UX flows
├── 03-visual-tokens.md        ← visual token system
├── 04-development-plan.md     ← implementation sequence and phase status
├── wireframe/                 ← approved structural/layout reference
└── ui-reference/              ← approved visual appearance reference
```

Only create or split additional documentation when it provides a clear benefit.

A case-study document may be added at the end of the project if the portfolio
goal requires it. Do not create one before then.

`01-product.md` remains the living product reference throughout the project.
