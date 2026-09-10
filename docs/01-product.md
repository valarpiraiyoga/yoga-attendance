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
- In Progress
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
A student is eligible to appear in attendance only when:
1. They have an active enrollment in the relevant batch.
2. Their membership is active on the class session date.

Membership and batch enrollment are independent. One membership can cover multiple batch enrollments.

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
A batch is not tied to one fixed time. The same batch can have multiple schedules across different days and times.

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
Admin can add new schedules anytime, edit schedules, change future schedules, deactivate schedules, assign instructors, and set effective dates.

### Future Changes
Changes to recurring schedules apply to future sessions only. Past sessions and historical attendance remain unchanged.

Editing a schedule's day, time or instructor is therefore versioned rather than applied in place: the existing schedule is closed by setting its effective until date to the day before the change takes effect, and a new schedule version is created starting from that date. The earlier version remains available, so what was scheduled on any past date can always be reconstructed.

Which of those two things happens depends on whether the schedule being edited has ever been in effect:

1. **The schedule has already started** — the new effective from date falls after the current version's own effective from date. The current version is closed at the day before the new date, and a new version carries the edited values forward. This is the ordinary case.
2. **The schedule has not started yet** — the new effective from date falls on or before the current version's own effective from date. There is no elapsed period to preserve, so the current version is updated in place. Versioning here would have to close the current version before it ever began, which is not a period that can be expressed.
3. **The new effective from date is before today** — rejected. Back-dating a change would rewrite what was scheduled on a date that has already passed.

Both of the first two outcomes leave every schedule version with an effective period that starts on or before it ends; the third is what keeps the past out of reach of an edit.

### Conflicts
V1 does not prevent overlapping schedules. A batch may hold more than one schedule covering the same day and time, and an instructor may be assigned to more than one schedule at the same day and time. These situations are visible to the Admin in both Schedule views — listed in the List View, and shown side by side in the Weekly Schedule grid — and are treated as an operational judgement, not a system-enforced constraint.

### Elapsed Effective Period
A schedule whose effective until date has passed remains stored as Active or Inactive exactly as the Admin left it. Status is never rewritten automatically. Where it is useful, the interface may additionally indicate that the schedule's effective period has ended, derived from the dates rather than stored.

### Specific Future Session Changes
Admin can change one specific future session without changing the recurring schedule.

### Cancellation / Holiday
A specific session can be marked Cancelled or Holiday. Such sessions do not require attendance and the recurring schedule remains unchanged.

### Deactivation
Schedules are deactivated rather than permanently deleted. Historical sessions and attendance remain available.

### Online / Offline
Online/offline is not a required property of the recurring schedule. Students may attend online or offline based on their circumstances. V1 attendance records only Present or Absent.

---

## 8. Attendance

### Purpose
Allow instructors and administrators to quickly record and maintain attendance for each class session.

### Eligibility
Only students meeting both conditions are shown:
1. Active enrollment in the relevant batch.
2. Active membership covering the class session date.

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

### Completion
After attendance is saved, the class session is marked Completed.

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

### Summary
Show:
- Total eligible students
- Present count
- Absent count
- Attendance percentage

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
- A batch does not have a fixed time.
- Batch capacity is not required in V1.
- Short code is required.
- Short code must be unique, compared case-insensitively.
- Short codes are normalized to uppercase.
- Inactive batches remain available for historical records.

Short code uniqueness protects identification. The Weekly Schedule identifies a batch by its short code alone, without the batch name, so two batches sharing a code would make a calendar entry ambiguous.

### Schedule
- Schedules recur weekly.
- A batch can have different days/times.
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
- Schedules are deactivated rather than permanently deleted.

Versioning schedule edits is what makes "future changes only" true: a schedule that was rewritten in place would silently change what the past looked like, which §12's Historical Integrity rules forbid.

### Attendance
- Attendance belongs to a specific class session.
- Only eligible students appear for attendance.
- Eligibility requires active enrollment + active membership.
- V1 statuses are Present and Absent.
- Online/offline does not change attendance status.
- Attendance remains historically available.
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
Keep Student, Membership, Batch, Enrollment, Recurring Schedule, Class Session, and Attendance distinct.

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
