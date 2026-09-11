# Development Plan

## Yoga Center Attendance System

This document defines **implementation sequence and phase status only**.

---

## 1. Scope of This Document

This document answers: *what gets built next, in what order, and what must
exist first.*

It does **not** define:

| Concern | Authoritative source |
|---|---|
| Product requirements, business rules, V1 scope | `01-product.md` |
| Information architecture, UX flows, screen requirements | `02-ux.md` |
| Colors, typography, spacing, radius, shadows | `03-visual-tokens.md` |
| Structural/layout reference per screen | `wireframe/Yoga Attendance.pdf` |
| Visual appearance reference | `ui-reference/` |
| Coding, architecture and validation rules | `CLAUDE.md` |

If this document ever appears to contradict one of the above, the source above
wins and this document is the one that must be corrected.

Requirements are never introduced here. If a phase below implies functionality
that is not in `01-product.md`, that is a defect in this document.

---

## 2. Phase Status

| # | Phase | Status |
|---|---|---|
| 0 | Project foundation | ✅ Complete |
| 1 | shadcn/ui foundation | ✅ Complete |
| 2 | Documentation / reference organization | ✅ Complete |
| 3 | Application Shell | ✅ Complete |
| 4 | App Shell visual-density refinement | ✅ Complete |
| 5 | Documentation / source-of-truth cleanup | ✅ Complete |
| 6 | App Shell structural validation | ✅ Complete |
| 7 | Reusable layout primitives | ✅ Complete |
| 8 | Login + Supabase authentication foundation | ✅ Complete |
| 9 | Settings → Instructors | ✅ Complete |
| 10 | Batches | ✅ Complete |
| 11 | Students + Batch Enrollment | ✅ Complete |
| 12 | Memberships | ✅ Complete |
| 13 | Schedule | ✅ Complete |
| 14 | Class Sessions | ✅ Complete |
| 15 | Attendance | ✅ Complete — Slices 1–3 (foundation, Eligible Students, Take Attendance) plus Instructor Access: migration `0014`, A1–A11 database/RLS verification (25/25 PASS), two-instructor and Admin-regression browser QA all passed |
| 15A | Schedule assignment architecture correction | ✅ Complete — migration `0013` applied; `lib/schedules`, `lib/enrollments` and `lib/attendance` updated to the schedule-scoped eligibility rule |
| 16 | Attendance History | ⬜ Not started |
| 17 | Reports | ⬜ Not started |
| 18 | Dashboard (real data) | ⬜ Not started |
| 19 | Settings → remaining areas | ⬜ Not started |
| 20 | Integration & business-rule validation | ⬜ Not started |
| 21 | Responsive and UX/UI audit | ⬜ Not started |
| 22 | Production / case-study readiness | ⬜ Not started |

---

## 3. Completed Phases

| Phase | Commit | Outcome |
|---|---|---|
| Project foundation | `a172f66` | Inter via `next/font`, Tailwind v4 CSS-first tokens, base styles, accessibility foundation |
| shadcn/ui foundation | `cb83f6e` | shadcn/ui initialized, design tokens reconciled to `03-visual-tokens.md` |
| Documentation organization | `556504c` | `docs/wireframe/` and `docs/ui-reference/` established |
| Application Shell | `c12664b` | AppShell, Header, Sidebar, MobileMenu, UserMenu, NavList, navigation data |
| Shell visual refinement | `2c1a44c` | Header/Sidebar density aligned to approved references |
| Documentation / source-of-truth cleanup | `76fdcf7` | UX document reference reconciled; this development plan established |
| App Shell structural validation | `5efce33` | Sidebar became the full-height column; Header scoped to the main column |
| App Shell validation record | `711bc81` | Structural decision recorded in this document |
| Reusable layout primitives | `cef5811` | `Container`, `Section`, `PageHeader` |
| Login + Supabase authentication foundation | `ea1d519` | Real Supabase Auth (email + password), cookie session handling, route protection via `proxy.js` backed by the DAL, Admin/Instructor roles in `public.profiles` with RLS |
| Settings → Instructors | `8ae52f0` | Instructor CRUD under Settings, plus login access and the invite flow |
| Batches | `45f0b7c` | Batch CRUD, list filters, Batch Details with its Overview tab; short code unique case-insensitively |
| Students + Batch Enrollment | `41f0335` | Student CRUD with `YC-000001` IDs, the Add Student guided flow, and batch enrollment with at most one active enrollment per batch |
| Memberships | `798d904` | Membership CRUD with `MEM-000001` IDs, derived Upcoming/Active/Expired/Cancelled status, non-overlap enforcement, renewal and cancellation |
| Schedule | `3471c11`, `2c20e1b`, `b5cc4d4` | Recurring weekly schedules with effective-date versioning; both approved views — List View and the Weekly Schedule week grid; Weekly Schedule corrected to the default view |
| Class Sessions | `801737b`, `2d54330`, `f94daea`, `6801bb0` | Projected + materialized session model, Today's Sessions, All Sessions, Session Details addressed by `(scheduleId, date)`; Flow 06 Edit This Session; Flow 07 Cancel/Mark Holiday |

Stack, architecture rules and validation requirements are defined in
`CLAUDE.md` and are not restated here.

---

## 4. Dependency Map

Derived from the core product model in `01-product.md` and the UX relationships
in `02-ux.md`. **This drives the sequence — not convenience.**

```text
Instructors ──────────────┐
                          ↓
Batches ──────────────► Schedule ──► Class Sessions ──┐
                                                      │
Students ──┬──► Batch Enrollment ─────────────────────┤
           │                                          ↓
           └──► Membership ──────────────────────► Attendance
                                                      │
                                    ┌─────────────────┴───────────┐
                                    ↓                             ↓
                            Attendance History                 Reports
```

Stated explicitly:

- **Schedule** depends on **Batches** + **Instructors**
  (`01-product.md` §7: a schedule carries its own instructor; instructors are
  assigned at schedule level).
- **Attendance** depends on **Students** + **Memberships** + **Batch
  Enrollments** + **Batches** + **Schedule / Class Sessions**, because
  eligibility requires an active enrollment *and* an active membership on the
  session date.
- **Attendance History** depends on **Attendance**.
- **Reports** depend on **Attendance**, plus Students/Batches for filters.
- **Dashboard** depends on **Students**, **Batches**, **Schedule / Class
  Sessions** and **Attendance**, because it summarises all of them.

### Three sequencing consequences

**1. Instructors must precede Schedule.**
Instructors live under Settings in the IA, but Schedule cannot be completed
without instructor records to assign. Settings is therefore split: the
**Instructors** area is built before Schedule (phase 9); **Center Profile** is
introduced with or before Reports, because exported reports may carry center
information (`01-product.md` §11); **Roles & Permissions** comes last as the
V1 permission matrix (phase 19). This is an implementation ordering decision
only — it does not change the approved IA, where Instructors remains under
Settings.

**2. Batches must precede Students + Batch Enrollment.**
`02-ux.md` Flow 02 (Admin: Add Student) is a guided flow that ends in
*Add Batch Enrollment → Select Batch*, and states that creating a student alone
does not make them attendance-eligible. A batch must already exist before an
enrollment can select one. Batches is therefore built at phase 10, before
Students + Batch Enrollment at phase 11.

Combined with consequence 1, the prerequisite chain is:

```text
Instructors → Batches → Students + Batch Enrollment → Memberships → Schedule
```

**3. Dashboard is sequenced late, not early.**
The Dashboard is an aggregation surface. Building it before its underlying
feature areas exist would mean building it against placeholder data and then
rebuilding it. It is therefore implemented once its data sources exist
(phase 18), and it additionally needs instructor-specific filtering for
assigned classes and sessions (`01-product.md` §3).

The Dashboard *route* already exists, but the current `app/page.js` is only a
layout-primitives validation scaffold — **it is not the final Dashboard.**

---

## 5. Phase Definitions

### Phase 5 — Documentation / source-of-truth cleanup
Establish consistent, non-contradictory documentation before feature work.
No application code changes.

### Phase 6 — App Shell structural validation

**Structural decision — RESOLVED.**

Approved shell structure:

```text
AppShell
├── Sidebar
└── MainColumn
    ├── Header
    └── MainContent
```

- The Sidebar is the full-height left column and begins at the top of the
  viewport, remaining vertically continuous.
- The Header is scoped to the main content column and does **not** span across
  the Sidebar.
- Main content begins below the Header.
- Desktop: Sidebar 256px wide, Header 48px high, main content starting at
  x=256 / y=48.
- Mobile: the desktop Sidebar is hidden and the existing drawer navigation
  behaviour is used.

Validation basis: independently confirmed against the approved visual
references, then verified in a real browser using computed layout measurements
across desktop and mobile viewports, with lint and build passing.

The shell is now a stable foundation for feature screens, and phase 7 may
proceed.

### Phase 7 — Reusable layout primitives
`Container`, `Section`, `PageHeader`.

Built **after** the shell structure is settled and **before** the first feature
screen, so that every feature screen composes the same primitives rather than
re-inventing page scaffolding. Building them earlier risks designing them
against a shell that then changes; building them later guarantees rework across
already-built screens.

These are presentation primitives only — no feature logic.

### Phase 8 — Login + Supabase authentication foundation
Admin and Instructor authentication, role-based access, and the Supabase
foundation that carries it. This is the first data-driven feature, so it is
where Supabase enters (see §6).

**In scope:**

- Supabase project and client foundation
- Environment configuration
- Admin authentication
- Instructor authentication
- Email + password login
- Forgot password / password reset
- Role storage (Admin | Instructor only)
- Session handling
- Route protection
- Authenticated role passed to `AppShell`, replacing its placeholder default
- Login UI based on wireframe p1
- `Input`, `Label`

**Explicitly out of scope:** Students, Memberships, Batches, Instructors entity
management, Schedules, Class Sessions, Attendance, Reports, the final
Dashboard, and the complete product database schema.

#### Login decisions

**Decision 1 — Login identifier: Email + password.**
Wireframe p1 shows "EMAIL OR PHONE", but `01-product.md` does not establish
phone authentication. V1 uses the simpler supported path — email + password —
and is not expanded into phone authentication.

**Decision 2 — Forgot password: included.**
Wireframe p1 explicitly includes "Forgot password?", and the product
requirements do not exclude password reset. The V1 exclusion of general
WhatsApp/SMS/email integrations does not extend to the authentication
provider's own password-reset email mechanism. Implemented through that
provider mechanism.

⚠️ `ui-reference/login.png` shows Remember me, Google Sign-In and a theme
toggle. **None are approved V1 functionality.** See `CLAUDE.md` →
"Known reference conflict: `login.png`".

**Status — Complete.** Implemented and committed in `ea1d519`. Verified
against a real Supabase project: Admin login, session persistence across
refresh, role resolution from `public.profiles`, Admin navigation, logout, and
route protection for unauthenticated access. The authentication foundation is
now in place, and phase 9 may proceed.

### Phases 9–19 — Feature areas
Implemented in dependency order:

Instructors → Batches → Students + Batch Enrollment → Memberships → Schedule →
Class Sessions → Attendance → Attendance History → Reports → Dashboard →
remaining Settings

Each feature area follows the progression defined in `CLAUDE.md`:

```text
Feature UI → business logic → validation → data access → Supabase integration
```

### Phase 13 — Schedule

Phase 13 delivers **recurring weekly schedules only**. Class Sessions remain
**Phase 14**, and Attendance remains **Phase 15**; the three are separate
phases, in that order, as listed in §2.

`01-product.md` §7 says a recurring schedule is used to "generate or identify"
class sessions. Phase 13 resolves that deliberately open wording as follows:
future occurrences are **computed from the recurring pattern for display
only**. Nothing about a session is persisted in this phase, so there is no
generation job, no stored session state, and no possibility of drift between
a schedule and rows generated from an older version of it. Persisting class
sessions — which Attendance needs a stable record to attach to — is Phase 14's
work.

**In scope**

- `schedules` table and its migration: batch and instructor foreign keys, day
  of week, start/end time, effective from/until, status, admin-only RLS, and
  no delete grant or policy — matching the Students, Batch Enrollments and
  Memberships migrations.
- Schedule data access, validation and server actions.
- An instructor option list for the schedule form's instructor picker,
  alongside the existing batch option list.
- Both approved Schedule views, switched by the wireframe's toggle:
  - **List View** — Batch / Instructor / Status filters, search, and
    pagination.
  - **Weekly Schedule** — a week grid with Today / Previous week / Next week
    controls and the week's date range, Monday–Sunday columns, and a fixed
    6:00 AM–10:00 PM hour-by-hour time axis that scrolls vertically when it
    does not fit. Each recurring schedule is a card placed at its weekday and
    start/end time showing batch short code, time range and instructor;
    overlapping schedules render side by side and are never hidden. It reads
    the same `schedules` records the List View reads and only visualises them;
    it persists nothing. The time-axis range and the overlap treatment are
    decisions resolving wireframe ambiguities — see `02-ux.md`.
- Add Schedule, Edit Schedule (versioned per `01-product.md` §7), and
  Deactivate Schedule, each following Review → Confirm → Save where
  `02-ux.md` Flows 04 and 05 require it.
- Schedule Details with its Overview and Recurring Pattern tabs, plus the
  Upcoming Sessions tab as a computed read-only projection.
- Batch Details' Schedules tab and its Overview panel.

**Out of scope**

- The `class_sessions` table, in any form.
- Session persistence, generation jobs, or scheduled tasks.
- Session exceptions, and marking a session Cancelled or Holiday
  (`02-ux.md` Flows 06 and 07) — these are Class Sessions work.
- Session Details, Today's Sessions, and the session list under Attendance.
- Eligible-student calculation, attendance marking, attendance history and
  reports.
- Any calendar view beyond the approved Weekly Schedule week grid — no month
  view and no day view. Only the week grid the wireframe draws is in scope.
- Editing a schedule from within the Weekly Schedule grid: no
  drag-to-reschedule, no resizing a card to change its time, and no conflict
  prevention or warning on overlaps. The grid is display-only; schedules are
  changed through Edit Schedule.
- Rendering anything other than recurring schedules in the Weekly Schedule
  grid. In particular it must not show session status, attendance counts,
  cancellations or holidays, since none of those exist until Phase 14.
- Instructor-facing Assigned Classes, and any relaxation of admin-only RLS.
- Batch Details' **Students** tab and its Overview panel. That placeholder
  dates from Phase 11 and is tracked as a Phase 11 follow-up in §7 — it is
  deliberately excluded here rather than folded into Phase 13.

Membership and enrollment are untouched by this phase. Attendance eligibility
depends on the *session date*, which does not exist while a recurring schedule
is being defined, so eligibility stays entirely within Attendance
(`01-product.md` §8).

### Phase 14 — Class Sessions

Phase 14 turns the recurring patterns Phase 13 delivered into dated class
sessions, and gives Attendance (Phase 15) a stable record to attach to. The
product rules it implements are in `01-product.md` §7A and §12's Class
Session rules; this section covers only what is built and what is not.

The persistence model is the defining decision: occurrences stay **projected**
from the recurring pattern, and a session is **materialized** into a stored
row only on its first session-specific change, cancellation/holiday, or
attendance. There is no generation job and no scheduled task. Phase 13's
existing projection is reused rather than reimplemented.

Phase 14 owns the `/attendance` route and establishes its two list views.
Phase 15 then adds attendance data and actions to those same screens.

**Today's Sessions / All Sessions — approved implementation decisions**

The first implementation pass materialized on view and treated All Sessions
as a materialized-only history table. Neither matches `01-product.md` §7A or
`02-ux.md`, and both were corrected before this phase shipped. The approved
model:

- **Viewing never materializes.** Materialization stays limited to its three
  documented triggers — a session-specific change, cancellation/holiday,
  attendance (§7A "Projection and Materialization"). Opening Today's
  Sessions, All Sessions, or Session Details never writes to
  `class_sessions`, for a projected occurrence or otherwise.
- **All Sessions shows projected and materialized occurrences together**,
  exactly like Today's Sessions — `02-ux.md`'s "Both lists ... show sessions
  whether or not they have been materialized" applies to both list screens,
  not only the default one. A materialized row is authoritative and keeps
  its snapshot values when its schedule is later edited, deactivated, or its
  effective period ends; every other occurrence in range follows the
  schedule's current version. Each `(schedule, date)` pair appears at most
  once — a materialized row suppresses the projected occurrence for the same
  pair, never both.
- **All Sessions defaults to today through the next 90 days** when no Date
  Range filter is applied, so an open-ended active schedule is never
  projected indefinitely. The Date Range filter can explicitly request a
  different window, including one reaching into the past — there is no
  generation job either way; a past date with no materialized row is simply
  projected from the schedule the same as a future one.
- **All Sessions sorts nearest-first** — `session_date` ascending, then
  `start_time` ascending — since its primary use is seeing what is coming
  up, not a most-recent-first history.
- **The Session Status filter uses the five displayed values** (Upcoming /
  In Progress / Completed / Cancelled / Holiday), matching the STATUS badge
  shown on every row. The four persisted values are a storage detail, never
  a user-facing filter option — "Scheduled" is not a status this product
  exposes.
- **Session Details is addressed by `(scheduleId, date)`**
  (`/attendance/[scheduleId]/[date]`), not a `class_sessions` id — a class
  session has no product-facing identifier (§7A), and a projected
  occurrence has no id to address it by. The materialized row is used when
  one exists for that pair; otherwise the occurrence is resolved from the
  schedule, read-only.

**Flow 06 — Edit This Session — approved implementation decisions**

- **Editable fields are instructor and start/end time only.** Date and
  batch never change on a session edit — moving a class to a different day,
  or a different batch, is a schedule change, not a session exception.
  Start time changing recalculates end time using the same 60-minute
  default the Schedule form uses (`calculateEndTime`); the admin can still
  edit the result.
- **Editable status is Upcoming only.** Editing an In Progress, Completed,
  Cancelled or Holiday session is rejected — for Completed, editing would
  rewrite history (§12 Historical Integrity); the others have already
  happened, been cancelled, or are a non-class day. The "Edit This Session"
  action is hidden on Session Details outside Upcoming, and
  `updateClassSession` re-checks the same rule server-side regardless of
  the UI, against the occurrence read fresh at submit time — not whatever
  status the page showed when it first loaded.
- **No note field.** Flow 06's approved steps have no note step; a note is
  exclusive to Flow 07 (Cancel/Holiday), where `0010_class_sessions.sql`
  already scopes the column.
- **Materialization happens only after Confirm, and only when the
  submitted values actually differ** from the occurrence's current
  instructor/start/end. Opening Session Details or the Edit form is a
  read — `getSessionOccurrence` — with no write of any kind. A no-op save
  (the admin opens the form and confirms without changing anything) must
  not create a `class_sessions` row either; `updateClassSession` compares
  before calling `materializeClassSession`, and skips both the
  materialization and the update entirely when nothing changed.
- **The recurring schedule is never touched.** Only `class_sessions` is
  written, and only its `instructor_id`/`start_time`/`end_time` columns —
  `status` is never part of this action. Review must state that the change
  applies only to this session and does not modify the recurring schedule,
  and that the session will no longer follow future changes made to the
  recurring schedule (the snapshot/detachment consequence of
  materializing, §7A).
- **No dedicated wireframe.** Like Flow 04 (Edit Schedule) and Flow 05
  (Deactivate), this is composed from already-approved patterns — the
  existing form layout plus Review → Confirm → Save
  (`components/ui/confirm-dialog.jsx`), not a new screen design.

**Flow 07 — Cancel / Mark Holiday — approved implementation decisions**

- **One action, one dialog, no new route.** "Mark Cancelled / Holiday" on
  Session Details opens a dialog with a status choice (Cancelled or
  Holiday) and an optional note, not two separate buttons and not a
  dedicated page — the status choice is one step inside the flow's own
  diagram ("Mark Session → Cancelled / Holiday"), not a fork in the entry
  point. Two `ConfirmDialog` instances in sequence implement the flow's
  Compose → Review Change → Confirm steps: the first captures the status
  and note (still read-only), the second shows them back for review and is
  the only step that can write anything.
- **Eligibility is checked against the *persisted* status, not the
  displayed one** — deliberately different from Flow 06's Upcoming-only
  rule. A session whose stored status is still `scheduled` can be marked
  regardless of whether it currently displays as Upcoming, In Progress, or
  a clock-derived Completed reading; a session already `completed`,
  `cancelled` or `holiday` is rejected. Once Phase 15 exists, stored
  `completed` is only ever written when attendance is saved (§7A, §8), so
  this one rule also becomes "cannot cancel a session with attendance
  already recorded" automatically, without `markSessionException`
  referencing attendance at all.
- **Cancelled uses destructive confirmation styling; Holiday uses
  standard styling** — a holiday is a planned closure, not a loss.
- **Not reversible in V1.** There is no un-cancel or reactivate action,
  matching every other one-directional status change in this product
  (membership cancellation, schedule deactivation). The Review step states
  this plainly.
- **Only `status` and `note` are written**, and only on Confirm, after
  `materializeClassSession` (unchanged) guarantees a row exists. Instructor,
  time, date and batch are never touched by this flow — that is Flow 06's
  disjoint column set. The recurring schedule is never modified, and no
  other occurrence of it is affected.
- **The note is shown in Session Information only when present** — most
  sessions never have one, and a projected occurrence's `note` is always
  null.
- **Inline success/error feedback**, not a redirect with a `?success=`
  query flag — `markSessionException` is called directly via
  `useTransition` (matching `deactivateSchedule`/`cancelMembership`), not
  as a form action, so there is no page navigation to attach a query flag
  to; the status badge changing is the primary visible confirmation.
- **No dedicated wireframe.** Composed the same way as Flow 06.

**In scope**

- `class_sessions` table and its migration: schedule, batch and instructor
  foreign keys (all `on delete restrict`), session date, start/end time,
  persisted status (`scheduled` / `completed` / `cancelled` / `holiday`),
  optional note, one-session-per-schedule-per-date uniqueness, admin-only
  RLS, and no delete grant or policy — matching every prior feature table.
- Class session data access, validation and server actions, including the
  materialize-on-first-touch helper and the status derivation that maps the
  four persisted states onto the five displayed ones.
- Session status derived against the fixed centre timezone, Asia/Kolkata —
  a display-time calculation only; the persisted status never changes just
  because the clock passed a session's end time.
- `/attendance` — **Today's Sessions** (default) and **All Sessions**, the
  latter with search, date range, Batch, Instructor and Session Status
  filters plus pagination.
- **Session Details** with its Overview tab's Session Information panel.
- Flow 06 — Change One Specific Session (time and/or instructor), Review →
  Confirm → Save, affecting that session only.
- Flow 07 — Mark a session Cancelled or Holiday with an optional note,
  Review → Confirm → Save.
- Linking Schedule Details' Upcoming Sessions tab through to a session where
  one exists.

**Out of scope**

- Attendance marking, editing, or saving in any form — including the
  `scheduled` → `completed` transition, which Phase 15 performs when
  attendance is saved.
- Eligible-student calculation, and the Eligible Students column and tab.
- The Attendance column, its Present/Absent counts, and the Attendance
  Summary panel on Session Details' Overview.
- Take Attendance / View Attendance actions.
- Attendance history and reports.
- Instructor-facing Assigned Classes, and any relaxation of admin-only RLS.
  Instructors will need read access to their own sessions in Phase 15; the
  migration notes it but does not grant it.
- Ad-hoc sessions with no schedule behind them (`01-product.md` §7A).
- Deleting sessions, in any form.
- Bulk generation of future sessions, cron, or any scheduled task.
- Any change to Phase 13's Schedule behaviour beyond the default-view
  correction (§3, `b5cc4d4`).

Students, Batch Enrollments and Memberships are untouched by this phase.
Attendance eligibility needs all three, but it is evaluated against a session
date at attendance time, which is Phase 15's concern — Phase 14 must not
import from those feature areas.

### Phase 15 — Attendance

Phase 15 implements the attendance records Phase 14 deliberately left out,
and everything on the `/attendance` screens that depended on them:
eligibility, Take Attendance, View/Edit Attendance, the Attendance Summary
panel, the Eligible Students and Attendance tabs, the list columns, and the
`scheduled` → `completed` transition (`01-product.md` §8, §12).

Phase 15 is split into slices. This section covers the first; Slice 2
(Eligible Students) followed it, and **Phase 15A below interrupts the
sequence with a schedule-assignment architecture correction that must land
before Slice 3 (Take Attendance)**. The eligibility rule recorded in this
section is superseded on one point by Phase 15A: eligibility resolves by
schedule, not by batch alone.

**Foundation slice — approved implementation decisions**

- **One attendance record per (class session, student).** Present or
  Absent only — there is no third persisted status. Unmarked is never
  stored: an eligible student with no row for a session is unmarked, by
  absence rather than by value (`supabase/migrations/0011_attendance.sql`).
- **Eligibility (D1–D3)** requires all three: an active student; an active
  batch enrollment in the session's own `batch_id` (the snapshot, not the
  schedule's current batch) covering the session date
  (`effective_start_date <= session_date` and `effective_end_date is null
  or >= session_date`); an active membership covering the session date. A
  membership's `cancelled_at` only excludes dates on or after the
  cancellation date — cancelling a membership today must not retroactively
  invalidate eligibility for an earlier session. Evaluated against the
  session's own date, never "today" — a past session's eligibility reflects
  who qualified on that date.
- **`resolve_eligible_students` is the single source of the eligibility
  rule.** Both the read path (a later slice's Eligible Students tab) and
  the write path (`save_session_attendance`'s own re-validation) call this
  one `SECURITY DEFINER` function rather than each encoding the rule
  separately.
- **Attendance percentage (D4)** is Present ÷ Eligible × 100, not Present ÷
  Marked — a session with unmarked students shows a correspondingly lower
  percentage. Zero eligible students returns 0, never a division-by-zero.
- **Attendance can only be taken for `session_date <= today`** in
  Asia/Kolkata (D5). Rejected inside `save_session_attendance` itself, not
  only in a later UI — the same "enforce independently of the UI" standard
  Phase 14's materialization and status rules already hold to.
- **Instructors get no access in this slice (D6).** `attendance` stays
  admin-only RLS, matching every table Phase 15 touches. Both new
  functions are `SECURITY DEFINER`, gated by an internal `is_admin()`
  check rather than by their grant — the same pattern `is_admin()` and
  `current_instructor_id()` themselves already establish
  (`0002_instructors.sql`, `0004_instructor_identity.sql`) — so a later
  instructor-access slice can broaden the internal check without changing
  who may call the function at all.
- **Saving attendance is atomic.** `save_session_attendance` validates the
  session exists, rejects Cancelled/Holiday and future dates, re-resolves
  eligibility, rejects any submitted student who is not eligible, upserts
  exactly the submitted marks (never deleting an existing one), and sets
  the session `completed` — all inside one database function, so a partial
  failure can never leave a session completed with some marks silently
  dropped.
- **Saving with some or all students unmarked is allowed (D10)**, and still
  completes the session — the workflow does not require full coverage
  before Save is meaningful.
- **No `marked_by` or other audit column (D11).** `updated_at` alone shows
  a correction happened; nothing in the approved decisions asks for who
  made it.
- **The materialization boundary is deliberate, not a gap.**
  `save_session_attendance` takes an existing `class_sessions.id` — it does
  not materialize a projected occurrence itself, and does not reimplement
  `materializeClassSession`'s insert-with-retry logic in SQL. A later
  Take Attendance action calls the existing, unchanged
  `materializeClassSession` (Phase 14) first, then this function — the same
  two-call shape `updateClassSession` (Flow 06) and `markSessionException`
  (Flow 07) already use, for the same reason: PostgREST gives no
  multi-statement transaction spanning a plain insert and a separate RPC
  call. The narrow window between the two calls is not a new risk —
  `save_session_attendance`'s own checks (session state, date, eligibility)
  are the authoritative gate at the moment of saving, so a session that
  became ineligible in that window is rejected there, not silently
  corrupted.

**Foundation slice — in scope**

- `attendance` table and its migration
  (`0011_attendance.sql`): class session and student foreign keys (both
  `on delete restrict`), Present/Absent status, one-record-per-student-
  per-session uniqueness, admin-only RLS, no delete grant or policy —
  matching every prior feature table.
- `resolve_eligible_students(batch_id, session_date)` and
  `save_session_attendance(class_session_id, marks)`, both `SECURITY
  DEFINER`, admin-gated internally.
- `lib/attendance/{data,validation,actions}.js`: date-parameterised
  eligibility reads, attendance-summary derivation, and
  `saveSessionAttendance` (the materialize-then-save action described
  above). No caller exists yet — this slice is the foundation only.

**Foundation slice — out of scope**

Every UI element: the Eligible Students tab, the Attendance tab, Take
Attendance, View Attendance, Edit Attendance, Mark All Present, the
Attendance Summary panel, and the Today's/All Sessions list columns and
actions. Also out of scope: instructor access of any kind (its own later
slice, per D6); Attendance History; Reports; Dashboard; a dedicated
Assigned Classes screen (D9); attendance deletion; un-completing a
session; a third attendance status; bulk attendance across sessions;
`marked_by`/audit columns (D11); any change to `0010_class_sessions.sql`.

### Phase 15A — Schedule assignment architecture correction

**This runs before any further Phase 15 work.** Slices 1 and 2 were built on
an eligibility rule that resolves students by *batch*; the product actually
requires resolving them by *schedule*, because a batch may run several
schedules — including several on the same weekday — and a student attends
only the ones they are assigned to (`01-product.md` §4 "Schedule
Assignment", §6, §8). Continuing to Take Attendance before correcting this
would build the marking UI on a rule known to be wrong, and would put
attendance records against students who never attended that class.

**Already applied — do not edit or recreate**

`0011_attendance.sql` and `0012_attendance_eligibility_membership_details.sql`
are both applied to the database. Every correction below is additive, in a
new migration. `0010_class_sessions.sql` likewise stays untouched.

**Why a junction table, not a column on `batch_enrollments`**

One enrollment may hold several schedule assignments at once, so the
relationship is many-to-many; a `schedule_id` column on `batch_enrollments`
could only ever express one. Assignments also carry their own effective
period, independent of the enrollment's — a student can switch from the
6:00 AM to the 7:00 PM class without their enrollment changing at all.

**Why assignments reference a series, not a schedule**

Editing a schedule versions it: the current row is closed and a **new row
with a new id** is inserted (`updateSchedule`, Phase 13). An assignment
pointing at the closed version would silently stop matching every session
generated from the new one, and the affected students would simply vanish
from Take Attendance with no error anywhere. `schedule_series` is the stable
identity the versions share, so assignments survive schedule edits by
construction rather than by remembering to migrate them.

**Migration 0013 responsibilities**

1. `schedule_series` — the stable schedule identity: `id`, `batch_id`
   (`on delete restrict`), `created_at`. Admin-only RLS,
   `select/insert/update` grants, no delete, matching every prior table.
2. `schedules.series_id` — added, backfilled one series per existing
   schedule row, then set `not null`, `on delete restrict`, indexed.
   Existing version chains cannot be reconstructed (no linking column has
   ever existed), so each existing row becomes its own series. That is
   harmless: no assignments exist yet, and every assignment created from
   here on sits on a correctly-maintained series.
3. `enrollment_schedules` — the junction:
   `batch_enrollment_id` → `batch_enrollments(id)`,
   `schedule_series_id` → `schedule_series(id)`, both `on delete restrict`;
   `effective_start_date` required, `effective_end_date` nullable;
   `created_at`/`updated_at`. **No status column** — the dates alone
   determine validity, mirroring `memberships` rather than
   `batch_enrollments`, so there is only one source of truth for whether an
   assignment applies on a given date.
4. Overlap prevention — an `EXCLUDE USING gist` constraint on
   (`batch_enrollment_id`, `schedule_series_id`, the assignment's date
   range), mirroring `memberships_no_overlap_per_student`
   (`0008_memberships.sql`; `btree_gist` is already installed). This blocks
   a duplicate or overlapping assignment to the same schedule for the same
   enrollment, while still allowing re-assignment after a genuine gap.
   Overlapping *times across different schedules* are deliberately not
   blocked (`01-product.md` §7 "Conflicts").
5. Replace `resolve_eligible_students` — signature becomes
   `(p_batch_id uuid, p_schedule_id uuid, p_session_date date)`, adding the
   assignment condition and resolving the session's schedule to its series.
   The existing membership tie-break and D1–D3 rules are carried forward
   unchanged.
6. Replace `save_session_attendance` — its internal eligibility call passes
   the session's `schedule_id`. Required because `0011` is applied and
   cannot be edited; nothing else about the function changes.
7. Backfill existing enrollments — see below.

**Backfill strategy**

The rule change makes every existing enrollment eligible for nothing until
it has assignments, so `0013` backfills: each existing active enrollment is
assigned to every currently-effective schedule series of its batch, dated
from the enrollment's own effective start date. That reproduces today's
behaviour exactly — a student enrolled in a batch currently attends all of
its schedules — so the correction changes what the system *can* express
without changing what it currently *says* about any existing student.

**Schedule versioning behaviour after this change**

- `createSchedule` creates a series and references it.
- `updateSchedule`'s versioning branch copies `series_id` from the row it
  supersedes, so a new version joins the existing series. Versioning is
  otherwise unchanged — same close-and-insert, same rules about which
  branch applies.
- `deactivateSchedule` is unaffected: it closes the row in place, produces
  no further occurrences, and assignments to it simply stop mattering.
- Class sessions keep snapshotting the specific `schedule_id` they came
  from (§7A). Nothing about existing materialized sessions or saved
  attendance changes.

**Implementation order**

1. Documentation (this change).
2. Migration `0013`, applied and verified before any code depends on it.
3. `lib/schedules` — series on create, series inheritance on versioning.
4. `lib/enrollments` + the enrollment UI — schedule selection, dated
   assignment changes, Student Details display.
5. `lib/attendance` + Session Details — pass the session's schedule through
   to eligibility; Slice 2's Eligible Students becomes schedule-scoped.
6. Only then, Phase 15 Slice 3 (Take Attendance).

**QA and test-data reset order**

Existing test data from earlier phases is **retained** through the
documentation and migration steps, so the backfill can be verified against
real rows. The controlled test-data reset happens only after the
correction is implemented and verified — reset first and the backfill would
have nothing to prove itself against. QA order: verify the backfill
reproduced current eligibility, then verify the new rule discriminates
between same-weekday schedules, then verify schedule versioning does not
orphan assignments, then reset and re-seed for Slice 3.

### Phase 15 — Instructor Access

Completes Phase 15: Slice 3 (Take Attendance) followed Phase 15A's
schedule-scoped eligibility correction, and Instructor Access is the final
slice — an active instructor can use Attendance for their own sessions only,
with every ownership boundary enforced at the database, not in application
code.

**Migration `0014_instructor_attendance_access.sql`**

- `can_access_session(schedule_id, session_date)` — the single ownership
  predicate: true for an admin; for an instructor, true only when the
  materialized session's `instructor_id` (snapshot ownership wins) or,
  absent a materialized row, the schedule's own `instructor_id` matches
  `current_instructor_id()` — which is itself null for a signed-out,
  unlinked, or deactivated instructor (`0004_instructor_identity.sql`).
- Additive instructor `select` policies on `schedules`, `class_sessions`,
  `attendance` (via a join to the owning session), and `batches` — every
  existing admin policy is unchanged.
- `students`, `batch_enrollments` and `memberships` remain admin-only with
  no new policy: an instructor never reads them directly.
- `resolve_eligible_students` broadened from `is_admin()` to
  `is_admin() or can_access_session(...)`, and now returns each student's
  `full_name`/`phone`/`student_code` directly alongside the membership
  dates it already returned — the only path by which an instructor's
  eligible students are ever visible to them. The eligibility rule itself
  is unchanged.
- `materialize_class_session(schedule_id, session_date)` — a new
  `SECURITY DEFINER` function giving an instructor an authorized
  materialize-on-first-touch path, since they hold no `class_sessions`
  insert policy and never will. Snapshots batch/instructor/time from the
  schedule, never from caller input.
- `save_session_attendance` broadened to admin-or-owning-instructor,
  checked against the locked session row's own snapshot `instructor_id`.
  Remains the only writer of `attendance` rows; no instructor
  insert/update policy exists on `attendance` or `class_sessions`.

**Security verification** — `supabase/verification/verify_0014_instructor_access.sql`
impersonates real users via `request.jwt.claims` + `set local role
authenticated` (no service key), runs entirely inside a transaction that
ends in `rollback`, and covers A1–A11: own-data visibility, zero visibility
into `students`/`batch_enrollments`/`memberships`, cross-instructor denial
on `resolve_eligible_students`/`save_session_attendance`/
`materialize_class_session`, denial of direct `attendance`/`class_sessions`
writes and role self-escalation, unchanged admin access, and access
revocation on instructor deactivation. Result: **25/25 PASS**.

**Application layer**

- `lib/attendance/data.js` — `listEligibleStudents` reads the display
  fields straight from `resolve_eligible_students`; the second
  `.from("students")` query is removed, since it would have silently
  returned nothing for an instructor.
- `lib/class-sessions/actions.js` — `materializeClassSession` now branches
  on role: unchanged direct-insert path for admin, the new RPC for an
  instructor. `updateClassSession` (Flow 06) and `markSessionException`
  (Flow 07) are untouched and remain admin-only.
- Route/action guards widened to admin-or-instructor: `app/attendance/layout.js`,
  `app/attendance/page.js`, `app/attendance/[scheduleId]/[date]/page.js`,
  and `saveSessionAttendance`. `[scheduleId]/[date]/edit` and the two
  session-management actions above stay admin-only; Session Details hides
  "Edit This Session" and "Mark Cancelled / Holiday" for an instructor.
- `app/data/navigation.js` — an instructor's nav is now Dashboard and
  Attendance only. "Assigned Classes" and "Attendance History" are
  narrowed out of the instructor role (Admin's own entries and order are
  unchanged) rather than left pointing at a 404 — neither screen is built
  yet (D9 defers Assigned Classes; Attendance History is Phase 16).

**Browser QA** — two linked instructor accounts, each with their own
session on the same day, confirmed: Attendance loads; each sees only their
own sessions and eligible students; Take Attendance and Edit Attendance
(through the Review/Confirm dialog) succeed for an owned session; a direct
URL to the other instructor's session resolves not-found; session
management controls are absent. Full Admin regression across Slices 1–3
and Phases 9b–14 passed unchanged.

**Known minor gap** — the All Sessions Instructor filter dropdown is still
shown to the instructor role; it does nothing harmful (RLS already scopes
every result to their own sessions regardless of the filter value) but is
unnecessary chrome. Hiding it is a small follow-up, not a security item.

### Phase 20 — Integration & business-rule validation
End-to-end verification of the historical-integrity rules in `01-product.md`
§12 — particularly that membership expiry/renewal, batch changes, student or
batch deactivation, and schedule changes never alter past attendance.

### Phase 21 — Responsive and UX/UI audit
Desktop / tablet / mobile review against the approved wireframes and visual
references, plus an accessibility pass.

### Phase 22 — Production / case-study readiness
Final polish. A case-study document may be created at this point if the
portfolio goal requires it.

---

## 6. Supabase / Backend Integration

Supabase integration is **progressive and feature-oriented**, not a separate
backend-first phase.

Per `CLAUDE.md`:

- Do not build the entire backend before implementing features.
- Do not create the complete database schema prematurely.
- Each feature area carries its own schema, data access and integration work
  through to completion before the next feature begins.

The schema therefore grows feature by feature, in the dependency order in §4.

**Supabase enters at phase 8**, with Login — the first data-driven feature.
Phase 8 introduces only the Supabase foundation plus the minimum auth and role
data required at that point. It does **not** introduce the product schema.

Product entities are added later, each with its own feature:

```text
instructors · students · memberships · batches · batch_enrollments
schedules · class_sessions · attendance · center_profile
```

---

## 7. Open Items Requiring Decision

| Item | Status |
|---|---|
| **Brand logo asset** | No approved logo/lotus asset exists in the repository. Branding is currently text-only. Requires a supplied asset or an explicit decision to remain text-only. |
| **Batch Details → Students tab** | Still shows the "not available yet" placeholder written before Phase 11, although Students and Batch Enrollment shipped in phase 11. Tracked as a Phase 11 follow-up; explicitly **not** part of Phase 13 (see §5). Needs scheduling into its own small phase or a follow-up commit. Once Phase 15A lands, this tab should also show each student's assigned schedules. |
| **Backfill scope (Phase 15A)** | The `0013` backfill is specified for existing **active** enrollments. Whether inactive/historical enrollments should also receive assignments — and if so, dated to what — is undecided. Recommended: active enrollments only, since historical eligibility for past sessions is only consulted through screens that would show the same students either way. |
| **Backfill date vs. schedule age (Phase 15A)** | The backfill dates each assignment from the enrollment's own start date, which can predate a schedule that was created later. Harmless in practice (eligibility also requires the schedule to have produced a session on that date) but it does store an assignment period wider than the schedule ever existed for. Alternative: date each assignment from the later of the enrollment start and the schedule series' first effective date. |
| **Enforcing "at least one schedule assignment"** | Recorded as a product rule (`01-product.md` §4). Not expressible as a simple database constraint — the enrollment must exist before its assignments can reference it — so it is planned as form-level validation. Confirm that application-level enforcement is acceptable rather than a deferred constraint or trigger. |

The AppShell structural relationship between Sidebar and Header previously
listed here is **resolved** — see Phase 6 in §5.

The Schedule default view previously listed here is **resolved** —
`b5cc4d4` (§3) corrected `/schedule` to open Weekly Schedule by default,
with List View still reachable through the existing view toggle.

---

## 8. Validation Checkpoints

Every phase must satisfy the validation requirements in `CLAUDE.md` before it
is considered complete:

- `npm run lint` passes
- `npm run build` passes
- Behaviour verified in a real browser, not only via build success
- Approved UX preserved (`02-ux.md`)
- Approved visual tokens used (`03-visual-tokens.md`)
- Responsive behaviour across desktop / tablet / mobile
- Accessibility: semantics, keyboard navigation, visible focus, contrast
- No invented requirements
- Business rules from `01-product.md` upheld

Feature phases additionally require the relevant business rules to be verified,
not assumed.

---

## 9. Git Checkpoints

One focused commit per completed phase, following the `CLAUDE.md` Git
Discipline rules.

- Documentation changes are not mixed into feature commits.
- Each phase is reviewed before it is committed.
- Commit messages follow the established convention
  (`chore:`, `docs:`, `feat:`, `fix:`).

---

## 10. Maintenance

Update this document when a phase completes or when sequencing changes.

Do not update it to record product, UX or visual decisions — those belong in
`01-product.md`, `02-ux.md` and `03-visual-tokens.md` respectively.
