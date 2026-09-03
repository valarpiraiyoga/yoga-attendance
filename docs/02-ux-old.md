# Yoga Center Attendance Management App — UX

## Purpose
UX source of truth after Product Requirements. Defines Information Architecture, roles, key user flows, UX relationships, and Figma planning. Product requirements remain in `01-product.md`.

## Information Architecture

### Admin Primary Navigation
- Dashboard
- Students
- Memberships
- Batches
- Schedule
- Attendance
- Attendance History
- Reports
- Settings

### Student Details
```text
Student Details
├── Overview
├── Memberships
├── Batch Enrollments
└── Attendance
```

### Batch Details
```text
Batch Details
├── Overview
├── Students
└── Schedules
```

### Schedule
```text
Schedule
├── Weekly Schedule       ← Default
└── List View
    └── Schedule Details
        ├── Overview
        ├── Recurring Pattern
        └── Upcoming Sessions
```

### Attendance
```text
Attendance
├── Today's Sessions      ← Default
├── All Sessions
└── Session Details
    ├── Overview
    ├── Eligible Students
    └── Attendance
```

### Attendance History
```text
Attendance History
└── History
    ├── Filters
    ├── Session Results
    └── Attendance Details
```

### Reports
```text
Reports
├── Student Attendance    ← Default
├── Batch Attendance
└── Attendance Summary
```

### Settings
```text
Settings
├── Center Profile
├── Instructors
└── Roles & Permissions
```

## Role-Based IA

### Admin
Full navigation and management access.

### Instructor
Focused operational access:
- Dashboard
- Assigned Classes
- Attendance
- Attendance History

Instructor sees only classes assigned to them.

## Core UX Relationships

```text
Student
   │
   ├───────────────┐
   ↓               ↓
Membership      Enrollment
                   │
             ┌─────┴─────┐
             ↓           ↓
          Batch A      Batch B
             │           │
             └─────┬─────┘
                   ↓
              Schedule
                   ↓
             Class Session
                   ↓
              Attendance
```

Attendance eligibility:

```text
Active Batch Enrollment
          +
Active Membership on Session Date
          ↓
Eligible for Attendance
```

Membership alone does not make a student eligible for a particular batch.

## Critical User Flows

### 01 — Instructor: Take Attendance
```text
Instructor Login
      ↓
Dashboard
      ↓
Today's Classes
      ↓
Select Class Session
      ↓
Check Eligible Students
      ↓
Mark All Present
      ↓
Change Absent Students
      ↓
Review Summary
      ↓
Save Attendance
      ↓
Session → Completed
```

Cancelled/Holiday:
```text
Today's Classes → Session → Cancelled/Holiday → No Attendance
```

### 02 — Admin: Add Student
```text
Students
  ↓
Add Student
  ↓
Student Details
  ↓
Save Student
  ↓
Student Details
  ↓
Add Membership
  ↓
Membership Details
  ↓
Save Membership
  ↓
Add Batch Enrollment
  ↓
Select Batch
  ↓
Set Enrollment Start Date
  ↓
Save Enrollment
  ↓
Student Ready for Attendance
```

New-student setup is a guided flow. Creating a student alone does not make them attendance-eligible.

### 03 — Admin: Create Batch + Schedule
```text
Batches
  ↓
Add Batch
  ↓
Batch Details
  ↓
Save
  ↓
New Batch → Schedules
  ↓
Add Schedule
  ↓
Select Day
  ↓
Start Time
  ↓
End Time automatically +1 hour
  ↓
Edit End Time if needed
  ↓
Select Instructor
  ↓
Effective From
  ↓
Save
  ↓
Schedule Active
```

### 04 — Admin: Change Recurring Schedule
```text
Schedule
 ↓
Weekly Schedule
 ↓
Select Schedule
 ↓
Edit
 ↓
Change Time / Instructor / Details
 ↓
Set Effective From
 ↓
Review Change
 ↓
Confirm
 ↓
Save
```

Review must explain that future sessions change while past sessions and attendance remain unaffected.

### 05 — Admin: Change One Specific Session
```text
Schedule
 ↓
Weekly Schedule / Upcoming Sessions
 ↓
Select Specific Session
 ↓
Edit This Session
 ↓
Change Time / Instructor
 ↓
Review Exception
 ↓
Confirm
 ↓
Save
```

The UI must state that the change applies only to that session and does not change the recurring schedule.

### 06 — Admin: Cancel / Holiday
```text
Schedule
 ↓
Select Specific Session
 ↓
Mark Session
 ↓
Cancelled / Holiday
 ↓
Optional Note
 ↓
Review Change
 ↓
Confirm
 ↓
Save
```

Cancelled/Holiday sessions do not require attendance.

### 07 — Admin/Instructor: Correct Attendance
```text
Attendance History
      ↓
Filter / Search
      ↓
Select Session
      ↓
View Attendance
      ↓
Edit Attendance
      ↓
Change Present / Absent
      ↓
Review Changes
      ↓
Confirm
      ↓
Save
```

Instructor can edit their assigned sessions. Admin can edit any attendance. History is read-only by default.

### 08 — Admin: Reports
```text
Reports
   ↓
Select Report
   ├── Student Attendance
   ├── Batch Attendance
   └── Attendance Summary
          ↓
     Select Filters
          ↓
     Generate Report
          ↓
      View Results
          ↓
        Export
       /   |       CSV  Excel  Google Sheets*
```

Google Sheets is a later export/integration destination; Supabase remains the source of truth.

## Important UX Patterns

### Review Before Important Changes
Use:
```text
Edit → Review → Confirm → Save
```
for recurring schedule changes, one-session exceptions, cancellation/holiday, and attendance corrections.

### Protect Historical Data
Make it clear when a change affects future records only. Past attendance must not be silently changed by schedule, batch, membership, or student-status changes.

### Fast Attendance
Primary instructor path:
```text
Dashboard → Today's Class → Take Attendance
```

### Avoid Duplication
Use contextual entry points without creating duplicate concepts:
- Student attendance from Student Details
- Batch schedules from Batch Details
- Session attendance from Attendance
- Historical records from Attendance History
- Summaries from Reports

## Figma Planning

### Wireframe Priority
1. Instructor Dashboard
2. Attendance Session
3. Admin Dashboard
4. Student List
5. Add Student guided flow
6. Student Details
7. Memberships
8. Batch List
9. Batch Details
10. Weekly Schedule
11. Schedule Details/Edit
12. Session Exception
13. Attendance History
14. Reports
15. Settings

### Design Sequence
```text
UX Flows
   ↓
Low-Fidelity Wireframes
   ↓
UX Review
   ↓
Design System
   ↓
High-Fidelity UI
   ↓
Responsive States
   ↓
Clickable Prototype
   ↓
Usability Review
   ↓
Approval
   ↓
Development
```

Do not start frontend development until the core UX/UI has been reviewed and approved.

## UX Principles
1. Operational first — prioritize frequent admin/instructor actions.
2. Simple attendance — V1 is Present/Absent only.
3. Flexible scheduling — add, change, deactivate, or make one-time exceptions.
4. Historical integrity — future changes must not damage past records.
5. Clear relationships — Student, Membership, Enrollment, Batch, Schedule, Session, Attendance remain distinct.
6. Guided setup — new student and batch setup guide the Admin through required steps.
7. Role clarity — Admin has full access; Instructor has focused access.
8. Don't overbuild — add complexity only for a real requirement.

## Status

- Information Architecture — **APPROVED**
- User Flows — **APPROVED**
- UX Foundation — **COMPLETE**

### Next Phase
**Figma Wireframes**

Start with the highest-priority workflow:
**Instructor Dashboard → Today's Class → Take Attendance**
