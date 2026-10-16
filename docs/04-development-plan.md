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
| 16 | Attendance History | 🟨 In progress — list, Details, Edit, Review and Confirm & Save built; **gated on Phase 16A's implementation sequence step 6 (below), not yet complete** |
| 16A | Historical eligibility snapshot (historical-integrity correction) | 🟨 In progress — migration `0015` applied, verified, and backfilled (Aerial Yoga 2026-09-11 confirmed Eligible 2 / Present 1 / Absent 1, matching step 7's QA target); **implementation sequence step 6, the enrollment effective-date validation in `lib/enrollments/`, is implemented locally (not committed; browser QA partly performed: the start-date block and an end-date/status-only save verified; schedule/batch-change, create-path and later-date save not yet verified)** — a start date or schedule/batch change date with existing attendance is refused server-side; steps 7–9 remain open |
| 17 | Reports | 🟨 In progress — data layer and `report_session_facts`/`session_attendance_summaries` (migrations `0016`, `0017`) applied and verified; Student/Batch/Attendance Summary report UIs and CSV/XLSX export implemented; **not yet committed, browser QA not yet performed** |
| 18 | Dashboard (real data) | 🟨 In progress — real Today's/Upcoming Classes and role-appropriate summary tiles implemented for both roles; **not yet committed, browser QA not yet performed** |
| 19 | Settings → remaining areas | 🟨 In progress — Center Profile and Roles & Permissions implemented; migration `0018` written and its verification script fixed; **recorded in migration history (§6A), but its expected database objects and seed data have not been independently verified**; not yet committed, browser QA not yet performed |
| FS | V1 Fee Structure (packages, fee history, discounts, audited corrections, class-count expiry edit) | 🟨 In progress — business rules approved 2026-10-13 and recorded in `01-product.md` §5/§5A/§8/§11/§12 and `02-ux.md`; **FS-1 complete** (pure JavaScript pricing/date library and unit tests, `lib/packages/`; not yet committed); FS-2 onwards not started, awaiting approval. See §5 "Phase FS". |
| DOC | Central Documents register (Phase 1: a read-only list at `/documents`) | ✅ Complete (Phase 1) — commit `fa52f38`; Documents KPI tiles enhancement ✅ complete, implemented locally and not yet committed (see "Central Documents register — Phase 1 plan") |
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
  Ongoing / Completed / Cancelled / Holiday), matching the STATUS badge
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
- **Editable status is Upcoming only.** Editing an Ongoing, Completed,
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
  regardless of whether it currently displays as Upcoming, Ongoing, or
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

### Phase 16 — Attendance History

Attendance History depends on Attendance (§4 Dependency Map) and reviews what
Phase 15 already recorded — it introduces no new attendance data, no new
eligibility rule, and no new persistence path. Its purpose is exactly
`01-product.md` §9: *"Allow Admin and Instructors to review attendance while
protecting historical information."* This section records approved decisions
ahead of any code, the same way Phase 15's foundation slice and Phase 15A did
before their own implementation began.

**Approved wireframe references** (`docs/wireframe/Yoga Attendance.pdf`) —
the authoritative layout source for every screen below, extracted and
verified page-by-page before these decisions were finalized:

- **p.6** — Attendance History (Instructor's own list view).
- **p.30** — Attendance History (Admin's list view).
- **p.31** — Attendance Details (read-only).
- **p.32** — Edit Attendance.
- **p.33** — Review Attendance Changes.
- **p.34** — Attendance Details, post-save confirmation state.
- **p.10** — Student Details' "Recent Attendance" panel and "View Full
  Attendance History" link — the contextual entry point into Student
  History.
- **p.17–18** — Batch Details (Overview/Students tabs). Confirmed to carry
  **no** attendance or history panel of any kind — the wireframe's own
  absence of one here is what settles decision 4 below.

**Approved implementation decisions**

1. **Attendance History has role-specific list views, not one shared
   screen with a hidden filter.** Admin's list (wireframe p.30) filters on
   Date From, Date To, Batch, Instructor, Search (student name or batch),
   and Attendance Status. Instructor's list (p.6) filters on Date Range,
   Search, **Assigned Classes** (not Batch — an instructor has no reason to
   filter by a batch they don't teach), and Attendance Status; it carries
   no Instructor filter, since the list is already implicitly theirs.
   **Admin sees all attendance history; an instructor sees only attendance
   for sessions they are authorized to access** — the same ownership rule
   Instructor Access already established (`can_access_session`,
   `current_instructor_id()`, `0014_instructor_attendance_access.sql`),
   reused here rather than reimplemented.
2. **One history result row represents one class session**, showing that
   session's own attendance summary (Eligible/Present/Absent/Attendance %,
   per the wireframe's column set) — not a per-student row. A student's or
   batch's aggregate view is produced by filtering this same row set
   (decisions 3–4), not by a second, differently-shaped query.
3. **Student History is not a separate page.** Student Details' existing
   "Recent Attendance" panel and its "View Full Attendance History" link
   (wireframe p.10) open Attendance History pre-filtered to that student —
   the same list from decision 1, not a new screen. This matches
   `02-ux.md`'s "Avoid Duplication" principle (*"Student attendance from
   Student Details [...] Historical records from Attendance History"*) and
   the wireframe's own structure: no page titled "Student History" exists
   anywhere in the approved deck.
4. **Batch History is not a separate page**, for the same reason: filtering
   Attendance History by batch **is** the batch history view. Unlike
   Student Details, Batch Details carries no contextual entry point for
   it — confirmed by wireframe p.17–18 showing no attendance/history panel
   at all on Batch Details' Overview tab. **No new Batch Details panel is
   added.** A batch's history is reached only through Attendance History's
   own Batch filter.
5. **Attendance Details (wireframe p.31) is its own Phase 16
   surface, distinct from the existing tabbed Session Details screen**
   (`app/attendance/[scheduleId]/[date]/page.js`). The wireframe draws it
   without Session Details' Overview/Eligible Students/Attendance tabs, and
   reaches it with its own breadcrumb ("Back to Attendance History") rather
   than Session Details' ("Back to Attendance") — two different entry
   contexts into what is substantially the same underlying data. Attendance
   Details reuses the existing attendance data functions
   (`getAttendanceSummary`, `getAttendanceForSession`,
   `listEligibleStudents` — `lib/attendance/data.js`) rather than
   duplicating the eligibility rule or the summary computation a second
   time; only the page/route is new, not the business logic behind it.
6. **Attendance Details is read-only by default** and shows, per the
   wireframe: the attendance summary, the student attendance roster
   (Student/Phone/Attendance status), pagination matching the wireframe's
   shape, and an "Edit Attendance" action. No attendance can be changed
   from this view without taking that explicit action — matching §9's
   "History is read-only by default. An explicit Edit action is used for
   corrections."
7. **Editing reuses Phase 15's existing correction model exactly**: Edit →
   Review → Confirm & Save (`02-ux.md` Flow 08), the same shape
   `attendance-panel.js`'s "Edit Attendance" already implements for Session
   Details. **Admin may edit any session; an instructor may edit only a
   session they are authorized to access** (`01-product.md` §9 "Editing":
   *"Instructors can edit attendance for their own assigned sessions.
   Admins can edit any attendance record"*) — enforced the same way
   decision 1's list visibility is, not by a second rule.
8. **The existing Phase 15 review UI is upgraded to match the approved
   Phase 16 wireframe (p.33), not replaced or redesigned.** The current
   `attendance-panel.js` `ConfirmDialog` shows only aggregate
   Present/Absent/Unmarked counts; the wireframe additionally shows, for a
   correction: a per-student **Current Status → New Status** table (only
   the students whose mark actually changed), a **before/after attendance
   comparison** (e.g. "Current: 17 Present · 1 Absent · 94.4% → After
   Changes: 18 Present · 0 Absent · 100%"), the Confirm & Save action, and
   the historical-integrity note ("This change updates attendance for this
   class session only. Historical session and schedule information remain
   unchanged.") already present in `attendance-panel.js`'s dialog copy.
   This is a presentation upgrade to the one review dialog every Edit
   Attendance path already shares — reached from Session Details **or**
   from the new Attendance Details page — not a second, Phase-16-specific
   dialog and not a change to what gets saved or how (see decision 9).
9. **Persistence and authorization are entirely reused, not
   reimplemented.** Every edit, from either entry point, still calls the
   existing `saveSessionAttendance` (`lib/attendance/actions.js`), which
   still calls the existing `save_session_attendance` database function —
   the same atomic validate/re-resolve-eligibility/upsert/complete sequence
   Phase 15 built, with the same admin-or-owning-instructor check enforced
   at the database. **No ownership or authorization check is duplicated in
   JavaScript** for Attendance History's own list or detail views; a
   weaker client-side approximation of `can_access_session` is exactly what
   this decision forbids.
10. **Historical Integrity (§9, §12) is a guarantee Phase 16 verifies, not
    one it builds.** The five listed scenarios — a student changes batch,
    a student leaves a batch, a membership expires, a batch becomes
    inactive, a schedule changes — are already structurally satisfied by
    the snapshot architecture Phase 14/15 already shipped (materialized
    `class_sessions` rows snapshot batch/instructor/time; `attendance` rows
    are never deleted, only corrected in place). Phase 16's QA must
    demonstrate this holds for the History list and Attendance Details
    specifically, not assume it because the underlying tables already
    behave this way.
11. **Explicitly out of scope, deferred to their own later phases:** CSV/
    Excel export and the Google Sheets export path (`01-product.md` §10 —
    Reports, Phase 17); the Reports screens themselves (Student
    Attendance, Batch Attendance, Attendance Summary — wireframe p.35–37,
    which visually resemble but are not Attendance History); and the
    Assigned Classes screen (D9, still deferred). None of these are built,
    wired, or linked to as part of this phase.
12. **All completed Phase 15 / 15A behavior is preserved exactly.** Take
    Attendance, the Eligible Students tab, the Attendance Summary panel on
    Session Details' Overview, the Today's/All Sessions list columns and
    actions, and every RLS policy and `SECURITY DEFINER` function from
    `0011`–`0014` are unchanged by this phase. Decision 8's review-dialog
    upgrade touches presentation only and must not alter
    `saveSessionAttendance`'s behavior, its authorization, or any existing
    caller's contract.

**In scope**

- Admin and Instructor Attendance History list views (decision 1), reading
  existing `attendance`/`class_sessions` data under existing RLS — no new
  table, no new migration.
- The Attendance Details page (decisions 5–6), reusing existing data
  functions.
- Wiring Student Details' existing "Recent Attendance" panel's "View Full
  Attendance History" link to Attendance History, filtered to that student
  (decision 3).
- The Edit → Review → Confirm & Save correction path reached from
  Attendance Details, and the review-dialog content upgrade (decisions
  7–8), shared with Session Details' existing Edit Attendance entry point.
- QA demonstrating Historical Integrity (decision 10) for the History list
  and Attendance Details specifically.

**Out of scope**

- Any new Batch Details attendance panel (decision 4).
- CSV/Excel export, Google Sheets export, and every Reports screen
  (decision 11; `01-product.md` §10, Phase 17).
- The Assigned Classes screen (D9).
- Any new migration, RLS policy, or `SECURITY DEFINER` function — Phase 16
  reads and corrects through what `0011`–`0014` already provide.
  **Superseded by Phase 16A below**: browser QA proved that reading
  completed-session eligibility live is itself the defect, which cannot be
  fixed without a new table and new function bodies. The rest of this
  bullet list still stands.
- Any change to eligibility, the materialization boundary, or the
  attendance completion rule — all Phase 15/15A concerns, unchanged here.
  **Phase 16A narrows this**: *when* eligibility is resolved for an
  already-completed session changes; the eligibility *rule* itself, the
  materialization boundary, and the completion rule do not.

### Phase 16A — Historical eligibility snapshot (historical-integrity correction)

**This runs before Phase 16 can be called complete.** Phase 16's screens are
built and working, but browser QA proved that a completed session's
attendance summary and roster still change when a student's enrollment
changes later — a direct violation of `01-product.md` §9 "Historical
Integrity" and §12 ("Past attendance must not be silently changed by …
student batch changes or leaving a batch"). Shipping Attendance History on
top of that would mean shipping a history screen that rewrites history.

**The defect**

`computeAttendanceSummary(eligibleStudents.length, marks)` combines two
different time bases: `marks` (`getAttendanceForSession`) is a stored
historical fact, while `eligibleStudents` (`resolve_eligible_students`) is
recomputed live against mutable enrollment/assignment/membership/status
rows.

Motivating case, reproduced in QA (no application code was changed to
produce it):

- Aerial Yoga, 2026-09-11, instructor Subha Kannan — recorded Eligible 2,
  Present 1, Absent 1, 50%. Venkatesh was one of the two eligible students
  and was recorded **Absent**.
- Venkatesh was then moved to Hatha Yoga Intermediate with the schedule
  change effective 2026-09-11. `updateEnrollment`
  (`lib/enrollments/actions.js`) correctly closed the old assignment the
  day before, at 2026-09-10.
- The same historical session then showed Eligible 1, Present 1, Absent 1,
  **100%** — two stored marks against one "eligible" student, an
  arithmetically impossible state, with Venkatesh's recorded Absent mark no
  longer rendered on any roster at all (every roster iterates the eligible
  list and looks marks up by student id).

Five independent predicates in `resolve_eligible_students` leak live state
into a historical answer, and each maps onto one of the five scenarios
`01-product.md` §9 requires to hold:

1. `es.effective_end_date >= p_session_date` — assignment closed later
   (schedule changes). **This is the case above.**
2. `be.effective_end_date >= p_session_date` — enrollment end moved back
   (student changes batch).
3. `be.status = 'active'` — **not date-scoped**: deactivating an enrollment
   removes the student from *every* past session (student leaves a batch).
4. `s.status = 'active'` — **not date-scoped**: deactivating a student does
   the same (D1 intends this for *new* eligibility only).
5. `m.start_date`/`m.end_date` — membership rows are freely editable
   (membership expires).

A fourth consequence, beyond the wrong numbers and the vanishing roster
row: `save_session_attendance` re-validates submitted marks against live
eligibility and raises `22023` for anyone no longer eligible, so an
affected session's attendance can no longer be corrected at all from
Session Details.

This is **systemic and predates Phase 16** — Phase 15 Slice 3 introduced
the live `eligibleCount`; Phase 16 only made it visible.

**Approved architecture — A2: snapshot the eligible student set**

- A full **eligible-student snapshot per class session**, not merely an
  `eligible_count`. The count alone would fix the arithmetic while leaving
  the roster wrong and leaving corrections blocked.
- The snapshot preserves the exact set used when attendance was first
  saved. Later enrollment, membership, batch, student-status or schedule
  changes must not alter it.
- **An empty eligible set is valid and must be distinguishable from "no
  snapshot"** (zero eligible students is legal — D4/D10). A child table
  alone cannot express that difference, so the presence of a snapshot is
  recorded on the session itself, separately from its rows.
- The snapshot-versus-live decision belongs **inside
  `resolve_eligible_students`**, which already receives
  `(batch_id, schedule_id, session_date)` and can resolve the session
  itself from `(schedule_id, session_date)`. Prefer the snapshot when one
  exists; otherwise resolve live exactly as today. Every existing caller —
  `listEligibleStudents`, `listEligibleStudentIds`, `getAttendanceSummary`,
  every Phase 15 and Phase 16 screen, and `save_session_attendance`'s own
  re-validation — then becomes historically correct with **no change to
  any existing read path**, and the `22023` correction defect resolves
  itself. (Phase 16A does change one application file overall — the
  enrollment effective-date validation below — but nothing that reads
  eligibility needs touching.)
- The branch keys off **snapshot existence, not `status = 'completed'`**: a
  completed session from before the backfill has no snapshot and must still
  fall back to live resolution rather than reporting an empty set.

**Snapshot timing**

- Created on the **first successful attendance save**, inside
  `save_session_attendance`, in the same transaction as the attendance rows
  and the `status = 'completed'` flip.
- **Not at materialization.** Flow 06 and Flow 07 materialize sessions that
  may be days in the future, where eligibility legitimately still changes
  before the class runs; freezing then would record the wrong set. The
  moment attendance is first recorded is the moment the eligible set
  becomes a historical fact — and it is already the exact set the function
  used to validate those marks.
- Ordering falls out correctly: a first save happens while the session is
  still `scheduled` with no snapshot, so eligibility resolves live and the
  snapshot is written from that result; a correction happens with a
  snapshot present, so it validates against the frozen set.
- **Corrections never recalculate live eligibility**, and never rewrite the
  snapshot — it is write-once.

**Provenance**

Each snapshot records how it was obtained, so an inferred set is never
later mistaken for a proven one:

- `save` — captured during the original attendance save. Exact.
- `backfill_consistent` — reconstructed later, where current evidence is
  consistent with every recorded mark.
- `backfill_drift` — reconstructed later, where current state has already
  drifted; preserves the recorded attendance evidence plus the
  best-supported eligibility.

**Historical eligibility is never invented where evidence is insufficient.**

**What the database can actually prove**

Audited before choosing the backfill strategy:

- **Attendance rows are the only proof.** A mark exists ⟹ that student
  passed eligibility at save time, because `save_session_attendance`
  rejects ineligible students outright.
- Enrollment, assignment and membership rows are **mutated in place** with
  no prior values retained, and enrollment effective dates have no
  back-dating guard, so their current values cannot be read as historical.
- **No audit or history table exists** anywhere in the schema.
- **`updated_at` is not maintained.** There is no `set_updated_at` trigger
  on any table and no application code sets it on update; the only place it
  is ever written is `save_session_attendance`'s upsert on `attendance`. It
  therefore cannot date any mutation outside that one table.
- Schedule *versions* are retained and `class_sessions.schedule_id` pins
  the exact one, and `class_sessions` freezes batch/instructor/date/time —
  but neither says which students were eligible.

**Existing-session backfill**

1. **Dry run first** — classify every completed session and report the
   tier counts, writing nothing.
2. **Consistent sessions** (every student with a mark is still explained by
   current records) — backfill as `backfill_consistent`.
3. **Drift sessions** (a student has a mark but is no longer live-eligible
   — provably mutated after the fact) — backfill as `backfill_drift` using
   the approved evidence strategy: recorded attendance evidence plus the
   best-supported current eligibility, **never less than the set of
   students who already have a mark**.
4. **Sessions with zero or no reliable evidence** — including sessions
   completed with no marks at all (legal under D10) — **remain
   unsnapshotted** and continue to fall back to live resolution. Nothing is
   fabricated for them.
5. **Post-condition, asserted for every completed session: the snapshot
   never excludes a student who has an existing attendance mark.** This
   assertion alone would have caught the original defect.
6. The backfill runs transactionally and is one-way; the dry-run report is
   reviewed before it is applied.

Permanently unrecoverable, and accepted as such: students who were eligible
but left **unmarked** and have since dropped out of live eligibility. No row,
no stored count, no trace — `save_session_attendance` returns
`eligible_count` to its caller but has never stored it.

**Enrollment effective-date business rule**

Because enrollment effective dates are **date-only**, a change effective on
date D and a session already completed on date D cannot be ordered relative
to one another. The Venkatesh case is exactly that: a same-day change, made
after that morning's session had already been completed — and therefore not
caught by the existing back-dating guard in `validateScheduleChangeDate`,
which only rejects dates before today.

Approved rule — **in scope for Phase 16A**, as an application-layer
validation step (step 6 of the sequence below):

- Enrollment and batch effective dates **remain date-only**.
- If attendance already exists for that student on the proposed effective
  date, the enrollment/batch change is **blocked**.
- The user is asked to **choose a later effective date**.
- **Date-time effective dates are explicitly not introduced.** Adding a
  time component would resolve the ordering precisely but would change the
  enrollment model, every enrollment form, and the eligibility rule's date
  comparisons throughout. A deliberate business simplification for this
  product: the centre does not need intra-day enrollment precision.

This validation protects against the specific historical conflict the
Venkatesh 2026-09-11 scenario exposed — a same-day change landing on a date
whose session was already completed. **It does not replace the A2
historical eligibility snapshot**, and neither substitutes for the other:
the validation stops new same-day conflicts from being created, while the
snapshot is what makes already-recorded history immutable regardless of any
later change. Phase 16A ships both.

**Instructor changes need no equivalent restriction**

`class_sessions` already snapshots `instructor_id` at materialization
(§7A), so a later instructor assignment change cannot alter a historical
session's instructor, its attendance, or its eligible set. Flow 06's
per-session instructor reassignment writes that column directly and is
likewise historical. No new rule is required here.

**Scope decisions**

- Phase 16A delivers **two** things, not one: the A2 eligibility snapshot
  (database) **and** the enrollment effective-date validation
  (application layer, `lib/enrollments/`). The validation is **not** a
  separate phase, a follow-up, or optional — it is step 6 of the sequence
  below and Phase 16 is not complete without it.
- **No admin "re-snapshot" escape hatch now.** Once snapshotted, a
  session's eligible set is immutable — which is the point. The
  operational question of whether an admin ever legitimately needs to add a
  student to a past session's roster is recorded in §7 as an open item, not
  answered by inventing a mechanism here.
- Phase 16A is **not** an opportunity to expand Phase 16. No Reports, no
  exports, no Assigned Classes, no Student/Batch contextual entry links, no
  UI redesign. The enrollment validation above is the *only* application
  code Phase 16A changes.

**Implementation sequence**

1. Documentation (this change).
2. Migration `0015` — snapshot table, snapshot-presence marker, indexes,
   grants and RLS (mirroring `attendance`: no instructor write policy,
   reads flowing through the existing `SECURITY DEFINER` path so instructors
   still never read `students` directly), plus the two function bodies.
3. Verification script, in the style of
   `supabase/verification/verify_0014_instructor_access.sql`: instructor
   isolation, admin unchanged, snapshot preferred when present, live
   fallback when absent, write-once, and corrections validating against the
   snapshot.
4. Backfill dry run, reviewed.
5. Approved backfill, with the post-condition assertion above.
6. **Enrollment effective-date validation** (application layer,
   `lib/enrollments/` — validation and the enrollment/batch change action
   that calls it). Blocks a batch/enrollment change from taking effect on a
   date where that student already has recorded attendance, and asks for a
   later effective date. Date-only throughout; no date-time support
   introduced. Sequenced here deliberately: after the snapshot exists, so
   the two protections are QA'd together in steps 7–8 rather than the
   validation masking whether the snapshot itself holds.
7. Historical-integrity QA — re-verify the Aerial Yoga 2026-09-11 session
   reports Eligible 2, Present 1, Absent 1, 50% with Venkatesh visible, and
   that it stays correct across all five §9 scenarios. Separately verify
   that a same-day enrollment change onto a date with existing attendance
   is now refused with a clear message, and that a later effective date is
   accepted.
8. Phase 15 / Phase 16 regression QA, both roles; confirm the snapshot work
   itself required no application-code change beyond step 6's enrollment
   validation.
9. Phase 16 complete.
10. Phase 17 — Reports.

**Step 6 status (written locally; not committed; browser QA partly performed):** implemented as `lib/enrollments/attendance-conflict.js` (`findAttendanceOnDate`, `attendanceConflictMessage`) and wired into `createEnrollment` and `updateEnrollment` in `lib/enrollments/actions.js`, server-side, before any write: a new enrollment's start date, a CHANGED start date, and the schedule/batch change date are refused when the student has recorded class-session attendance (any batch or series) on that date, with the field message "This student already has attendance recorded on {date}. Choose a later effective date." End dates, status, instructor changes and class-count attendance are not checked. No migration. Tests: `lib/enrollments/attendance-conflict.test.js`. Browser QA so far (as reported by the user): the start-date attendance-conflict block was verified against real attendance (Kannan T, 2026-09-28), and an end-date/status-only save was verified. **Not yet verified end-to-end:** the schedule/batch-change check, the new-enrollment (create) check, and a successful save with a later attendance-free date. Steps 7–9 (QA, regression, completion) remain open.

**Status of this sequence (as of the snapshot work)** — steps 1–5 are done: migration `0015` is
applied, its structural and behavioural verification both passed, the
backfill dry run was reviewed, and the approved backfill ran and was
verified (Aerial Yoga 2026-09-11 confirmed Eligible 2 / Present 1 /
Absent 1, matching step 7's QA target below). **Step 6 — the enrollment
effective-date validation — has not been implemented**:
`validateScheduleChangeDate` (`lib/enrollments/validation.js`) still only
rejects a date before today; it does not check for existing attendance on
the incoming effective date. Steps 7–9 therefore remain open, and Phase 16
cannot be marked complete until step 6 closes the same gap that produced
the original defect. Work beyond this sequence (Reports data layer and UI,
Dashboard, Settings) proceeded in parallel and is tracked in the status
table above — none of it depends on step 6.

### Phase FS — V1 Fee Structure

**Requirements source.** The approved rules (decided 2026-10-13) are in
`01-product.md` §5 "Packages and Fee Structure", "Class-Count Packages",
"Membership Information", "End Date", "Renewal"; §5A "Stored Document and
Snapshot", "The Receipt Follows the Membership"; §8 "Class Count Attendance";
§11 "Packages and Fees"; §12 "Membership"; and `02-ux.md` Settings, Flow 09
and "Membership fee, discounts and class-count packages". This section plans
the work only; it introduces no requirement.

**Confirmed facts (repository inspection, 2026-10-13)**

- No package, fee-history or discount objects exist in code or migrations.
  The Settings tabs are Center Profile, Invoice / Receipt, Instructors and
  Roles & Permissions (`app/settings/settings-tabs.js`).
- Memberships are created and edited by direct table writes in
  `lib/memberships/actions.js` (`createMembership`, `updateMembership`).
  `authenticated` holds a whole-table `UPDATE` grant on `memberships`
  (0008); admin RLS is the only database barrier, so any admin client can
  change `amount`, dates or `end_date` without the server action.
- `calculateMembershipEndDate` (`lib/memberships/validation.js`) rolls
  calendar overflow forward (31 January + 1 month → 3 March, end 2 March).
  The approved rule clamps (end 27 February). Postgres
  `date + interval 'n months'` clamps, matching the approved rule.
- Amount must be greater than 0 in `validateMembershipInput` and in the
  0008 CHECK, which matches the approved "> ₹0" rule.
- Renewal (`app/memberships/[id]/renew/page.js`) copies the previous plan
  and amount; class-count renewal starts today with no expiry.
- Overpayment is refused server-side (`record_membership_payment`, deferred
  total checks, 0034); payment edits are audited (0038, 0040).
- A membership with recorded payments is documented per payment and never
  receives a new membership-level document (0036/0039, `01-product.md` §5A).
  Because a new membership is Paid only through payments, a package-linked
  membership should never hold a membership-level document — **derived from
  the rules, not yet enforced by a dedicated guard.**
- Class-count recording requires a membership usable today and an
  attendance date within validity (0045 `record_class_count_attendance`);
  reversal never touches `end_date`. A class-count `end_date` can today be
  changed through the generic Edit form, unaudited; the 0045 history guard
  allows it.
- `plan` drives document descriptions (`issue_*_core`), `lib/status.js`
  `PLAN`, the dashboard and list filters, and is constrained by
  `memberships_plan_valid` / `invoices_plan_valid` (0042). Keeping `plan`
  populated on package-linked memberships avoids touching those consumers.
- Existing column-grant pattern: 0025, 0027, 0028, 0036, 0041.

**Requires investigation before or during implementation**

- Behaviour of 0031–0045 on the development database is **not verified**
  (§6A); run their behaviour scripts, with approval, before FS-5.
- Whether any legacy class-count memberships (created since 0042) exist on
  the development database, and how many.
- The exact database path by which a membership-level document could still
  be issued (auto-issue trigger, Issue Invoice) for a package-linked
  membership, to design the FS-5 guard.
- How many legacy membership-level receipts exist on the development
  database, and how many have already been changed by the sync (needs an
  approved read-only query; FS-D).

**Legacy document sync — investigation result (O1, repository only, 2026-10-13)**

- **Path.** `memberships_sync_invoice_trigger` (0030) is an `AFTER UPDATE OF
  amount, plan, start_date, end_date` row trigger on `memberships`, firing
  only when one of those values actually changes. It calls
  `memberships_sync_invoice()` (0030), which calls
  `sync_invoice_from_membership(membership_id)`. Its current body is 0044's;
  earlier bodies are 0030, 0031, 0033 and 0036.
- **What it changes.** It acts only on the membership-level document
  (`invoices.payment_id is null`, since 0036). Inside the same transaction it
  sets `yoga.invoice_sync` to that invoice's id, and `invoices_freeze_snapshot`
  (current body 0037) then allows exactly eight columns to change: `plan`,
  `description`, `period_start`, `period_end`, `total_amount`,
  `taxable_amount`, `tax_amount` and `service_details` (the last only for a
  tracked receipt whose start date moved). Number, prefix, dates, currency,
  tax terms and snapshots stay frozen. Payment documents never follow.
- **Who triggers it.** Within the application, only Edit Membership
  (`updateMembership`, `lib/memberships/actions.js`) writes those four
  columns. Payment recording and editing change `payment_status`/
  `payment_date`, which do not fire it. Any direct admin `UPDATE` (whole-table
  grant, 0008) would also fire it.
- **No membership-level correction path exists.** Cancel-and-reissue is
  payment-documents-only: `correct_payment_document` refuses a document with
  no payment (SQLSTATE 55000, 0037), and `invoices_correction_payment_only`
  (0037) forbids a cancelled or replacing membership-level document. So
  "use the existing cancellation and reissue process" has no existing
  process for legacy membership-level receipts.
- **Impact if the sync were simply removed.** A legacy edit of amount, plan
  or dates would leave the issued receipt showing the old values with no way
  to correct it. Therefore the trigger stays unchanged until FS-D's design is
  approved.

**FS-D implementation record (2026-10-15 — migration 0054 applied and verified).** Approved design: remove the sync path instead of narrowing it — `drop trigger if exists memberships_sync_invoice_trigger`, `drop function if exists memberships_sync_invoice()` and `drop function if exists sync_invoice_from_membership(uuid)`, with preconditions that the snapshot protection (`invoices_freeze_snapshot`), the auto-issue function, `update_invoice_details` and 0049 exist. It changes no row, restores nothing, and leaves issuance, numbering, number/date edits, `invoices_freeze_snapshot` (including its now-unused `yoga.invoice_sync` exemption) and payment-document correction untouched. **Accepted limit:** legacy membership-level receipts have no cancel-and-reissue correction yet; a receipt can now differ from its membership. Re-running 0030 re-installs the trigger and 0031/0033/0036/0044 re-install the function; re-apply 0054 afterwards (0049 would refuse, because it requires `memberships_sync_invoice()`). UI: the Invoice page and panel descriptions, the Edit-invoice dialog description and a notice on the legacy Edit Membership form for a Paid membership with an issued receipt. Verification: `verify_0054_legacy_receipt_protection.sql` (read-only catalog check) and the rollback-only `verify_0054_legacy_receipt_protection_behavior.sql` (baseline run before applying: 35 passed, 11 expected failures, cleanup clean). **Results after applying (all reported by the user):** catalog verification 15/15 passed; behaviour verification 46 passed, 0 failed, 0 not tested; cleanup confirmed — 54 receipts, 49 reserved numbers, no leftover test students or memberships. **Core browser QA passed (reported by the user):** the Edit Membership notice appeared, saving the Notes succeeded, and the issued invoice's details remained unchanged; editing the amount, plan and dates is covered by the behaviour script rather than reported from the browser. **Deferred (accepted limit):** a correction workflow (cancel-and-reissue) for legacy membership-level receipts is not built; it remains a later decision.

**Conflicts between approved rules and current implementation — proposed resolutions**

| # | Approved rule | Current implementation | Proposed resolution |
|---|---|---|---|
| C1 | Clamped calendar end date | `addMonthsUTC` rolls forward | New clamped helper for package-linked memberships (FS-1) and SQL calculation in the create function (FS-5). The legacy helper is left unchanged, because legacy memberships keep their current edit workflow. |
| C2 | No manual End date for package-linked duration memberships | End Date always editable | FS-6 form renders it read-only; FS-5 guard refuses direct changes. |
| C3 | Fee resolved server-side from the start date | Amount typed by hand | FS-5 `create_membership_from_package` resolves and calculates in the database; the form only previews. |
| C4 | Renewal priced on the new start date, no inherited discount | Renewal copies plan and amount | FS-6 renewal uses the package flow. |
| C5 | Audited expiry edit for **every** class-count membership (O3) | Generic edit, unaudited | FS-7 function + audit table; a guard refuses any other `end_date` change on any `kind = 'class_count'` membership, legacy or package-linked; the Edit form stops offering it. |
| C6 | Audited corrections of agreed fee and terms | `updateMembership` writes `amount`/dates freely | FS-8 correction function; FS-5 guard restricts package-linked rows only. Legacy rows unchanged. |
| C7 | Issued documents never change silently, legacy and package-linked (O1) | 0030 sync rewrites a legacy membership-level receipt when its legacy membership is edited; no membership-level cancel-and-reissue exists | Package-linked memberships never hold membership-level documents (guard in FS-5). The legacy sync was removed by FS-D (migration 0054, applied and verified 2026-10-15); a membership-level correction workflow remains deferred. |
| C8 | Database-level enforcement | Whole-table `UPDATE` grant | FS-5 guard trigger on package-linked rows (column grants would also lock legacy rows, which must keep their workflow). |

**Implementation phases** (each one reviewable commit, each needing approval;
migration numbers are proposals, nothing is created)

| Phase | Scope | Depends on | Likely files / objects | Safeguards | Verification and acceptance |
|---|---|---|---|---|---|
| **FS-0** Readiness | Wireframes for Settings → Packages & Fees, the package-linked Membership Details actions and the Custom Fee Plan flow; authorized behaviour verification of 0031–0045; investigation of legacy class-count memberships on the development database; verification of every path that can create or rewrite a membership-level document; settle the working tree | — | Docs, wireframes, §6A | No database writes beyond rollback-only scripts, each separately authorized | Approvals recorded in §7; wireframes approved; verification results recorded in §6A |
| **FS-D** Legacy document protection (O1) — separate readiness task | ✅ **Complete (2026-10-15): the sync path is removed by migration 0054, applied and verified** (catalog 15/15; behaviour 46 passed, 0 failed, 0 not tested; core browser QA passed — all reported by the user) (see "FS-D implementation record"); the audited cancel-and-reissue workflow below is **not** built and is **deferred** as a later decision. *Earlier recommended design, kept on record:* Recommended design: an **audited cancel-and-reissue workflow for legacy membership-level receipts**. The design must establish: (1) how the original issued document is preserved, unchanged and viewable; (2) how cancellation and replacement numbering work (which sequence the replacement uses; reservations under 0030 so no number is reused); (3) how correction history and audit records are kept (who, when, reason, link original ↔ replacement); (4) which functions, triggers, constraints and application paths need protection — at least `memberships_sync_invoice_trigger` / `memberships_sync_invoice` / `sync_invoice_from_membership` (0030 → 0044), `invoices_freeze_snapshot` (0037), `invoices_correction_payment_only` and `correct_payment_document` (0037), `memberships_auto_issue_invoice` and `issue_invoice` (0036), `updateMembership` (`lib/memberships/actions.js`); (5) how the legacy Edit workflow continues safely (for example: the edit saves, the receipt stays as issued, and the Admin is offered cancel-and-reissue); (6) how unauthorized direct database updates are prevented from rewriting issued documents (the whole-table `UPDATE` grant on `memberships`, 0008). Alternatives still on record: refusing such legacy edits outright, or another approved approach. | FS-0; approved read-only count of affected legacy receipts | Design note in this section; later a migration replacing the 0030 sync behaviour | `memberships_sync_invoice_trigger` **unchanged** until the design is approved; no document rewritten, renumbered or cancelled automatically | Design approved; then behaviour scripts proving a legacy edit changes no issued document and the cancel-and-reissue path preserves the original, its number and its history |
| **FS-1** Pricing and date library — ✅ **Complete (2026-10-13)**, see "FS-1 completion record" | Pure functions: clamped month arithmetic and inclusive end date; fee-entry resolution by start date; standard fee (monthly base × months, including Custom whole months); package discount (against standard fee; none for Monthly; Custom months chosen per membership, discount of the largest standard duration not exceeding them, none if that duration has none configured); individual discount (against remaining fee); half-up rounding per step; limits (combined ≤ standard fee, final > 0); reason validation; "no valid standard fee" (no entry in effect, or entry in another currency); Custom Fee Plan validation (custom fee > 0, mandatory reason; the amount is the final fee and no discount is applied). Not wired to any screen. See "FS-1 implementation plan" below. | Approval of S1–S3 in the FS-1 implementation plan. **No** database, receipt-trigger or wireframe dependency. | New `lib/packages/pricing.js`, `lib/packages/validation.js`, tests | Integer paise arithmetic, as in `lib/memberships/payments-core.js` | Unit tests incl. ₹1,500 × 3 − 300 − 200 = 4,000; Custom 2/5/7/10/12/13 months → no / Quarterly / Half Yearly / Half Yearly / Annual / Annual discount; Custom 5 months on a package with no Quarterly discount → no package discount; fee entry in another currency → no valid standard fee; Custom Fee Plan > 0 with reason accepted, ≤ 0 or no reason refused; 31 Jan, 29 Feb, 30/31 month ends; percentage rounding at .005; combined = standard; final = 0 refused. `npm test`, lint. |
| **FS-2** Catalogue schema — ✅ **implemented; migration 0046 applied, its structure script (94 checks) and behaviour script (171 passed / 0 failed / 0 not tested) passed (reported by the user, 2026-10-15)** (§6A) | `packages`; duration options (terms, edited in place); effective-dated fee entries (monthly base fee + per-option package discounts, or class-count price; currency); package audit events (actor required on insert; an event can only name a fee entry of its own package; a `fee_cancelled` event's `in_effect` flag is checked against the entry and the centre's date). RLS: admin SELECT only; writes only through functions. Triggers refuse ordinary statements from every role, including the table owner; an owner can still disable or replace them. 0046 checks the events it receives; it does **not** guarantee that an event exists for every change. | FS-1 | Migration `0046_packages_and_fee_history.sql` + `verify_0046_*` + `lib/packages/packages-migration.test.js` | Unique (package, effective date) among non-cancelled entries; type immutable once used; no DELETE grant; `ON DELETE RESTRICT`; a cancellation is stamped `now()`. Re-run only as one transaction, and run the structure script afterwards: `CREATE TABLE IF NOT EXISTS` does not repair drift | Structural (read-only) and behaviour (rollback-only, repeatable-read fingerprints) scripts, including Instructor and anonymous refusal (reported NOT TESTED when there is no Instructor profile); §6A row |
| **FS-3** Package and fee functions — ✅ **implemented; migration 0047 applied, its behaviour script passed — 36 passed / 0 failed / 0 not tested (reported by the user, 2026-10-15)** (§6A) | Create/update package (name snapshot rule), terms edit (audited, future purchases only), activate/deactivate, schedule/edit/cancel fee entry before effective, cancel or correct an entry in effect with a reason. **Fee-conflict detection is not part of FS-3**: it is implemented and tested in FS-5, when package-linked memberships exist. | FS-2 applied and verified | `0047_package_fee_functions.sql`; `lib/packages/actions.js`, `data.js` | SECURITY DEFINER with `is_admin()`, pinned `search_path`; package row lock; every change writes its audit event in the same transaction (see "FS-3 acceptance criteria") | Behaviour: duplicate date refused; edit after effective refused; each cancel and correct writes exactly one audit event atomically; ordering and `now()` rules below |
| **FS-4** Settings → Packages & Fees UI — ✅ **implemented (2026-10-13); lint, tests and build pass; an unauthenticated request to `/settings/packages` redirects to `/login`. Browser QA (desktop and mobile) and authenticated testing against the database passed in FS-9 (reported by the user, 2026-10-15)**. Built without a separate wireframe on the Admin's explicit approval, following the Settings screens; the affected-memberships view waits for FS-5 | List, create, edit, terms, fee history, activate/deactivate, affected-memberships view | FS-3, wireframe | `app/settings/packages/*`, `settings-tabs.js` | Admin-only route guard (`requireRole`) | Lint, build, Browser QA desktop/mobile, empty/error/conflict states |
| **FS-5** Membership pricing in the database — ✅ **implemented; migration 0048 applied and its behaviour script passed, 39 passed / 0 failed (reported by the user, 2026-10-13)** (§6A). The commit-time conflict check through the API is not yet verified. Fee-conflict detection is a deferred constraint trigger on every fee-entry change rather than re-created cancel/correct functions; the legacy membership-level receipt sync is still FS-D | Nullable package-linked columns on `memberships` (package, fee entry, name snapshot, duration months, standard fee, package discount, individual discount type/value/amount, reason code/note; pricing mode `standard` / `custom_fee_plan` with the Custom Fee Plan reason and confirmed-by/at); consistency CHECK; `create_membership_from_package` (resolves a valid fee in the centre's current currency or accepts an explicit Custom Fee Plan, calculates end date in SQL, snapshots currency, refuses a deactivated package); guard trigger on package-linked rows; guard refusing membership-level documents for package-linked memberships | FS-3; 0031–0045 behaviour verified | `0048_package_linked_memberships.sql` + verification | No backfill; legacy rows untouched (byte-for-byte fingerprint check); deferred consistency checks; `amount` = final agreed fee | Behaviour: priced by start date; clamped end date; SQL result = FS-1 result for shared cases; direct UPDATE of protected columns refused; legacy edit unaffected |
| **FS-6** Membership workflow UI — ✅ **implemented (2026-10-13), seven steps.** Package mode (duration and class-count packages, Custom months, individual discount with its reason, explicit Custom Fee Plan, breakdown preview, Review with confirmation of the final fee, Record Payment Now checked against the resolved fee) in the standalone Add Membership, Student Details → Add Membership, guided step 2 and Renew; the recorded pricing on Membership Details; the notes-only Edit form for package-linked memberships (the ordinary update action refuses them, and the 0048 guard is the last line); and package options in the Plan filter (`?package=`). Pricing and dates stay database-authoritative: the form sends no price, amount or end date. A renewal never carries an individual discount. Legacy creation, editing and renewal are unchanged. **Verification:** `npm test`, lint and build pass. **Browser QA was reported complete by the user (2026-10-13); no findings were shared with the assistant, and no automated browser tests were run.** **Not verified:** the preview/database price agreement beyond the shared examples; a commit-time fee-conflict error through the API; legacy class-count expiry editing remains until FS-7. | Package mode in Add Membership, Student Details → Add Membership, guided step 2 and Renew; Custom months input; "no valid standard fee" state; explicit Custom Fee Plan choice with fee, reason and confirmation; breakdown and Review; Record Payment Now validated against the resolved fee; Membership Details breakdown; Edit form hides protected fields for package-linked rows; list Plan filter offers packages | FS-4, FS-5 | `app/memberships/membership-form.js`, `lib/memberships/actions.js`, `app/memberships/[id]/renew/page.js`, `app/memberships/[id]/page.js`, `app/memberships/membership-filters.js`, guided-flow pages | Server action calls the database function; client values are previews only | Browser QA of all four entry points; payment and enrollment failure paths keep the membership; regression of payments and documents |
| **FS-7** Class-count expiry edit (all class-count memberships, O3) — ✅ **implemented and verified, steps 1 and 2 (2026-10-14).** Step 1: migration 0049 (audit table, `edit_class_count_expiry`, the guard on a class-count `end_date`, the re-created 0048 package guard and 0030 sync trigger) exists in the demo database and `verify_0049_class_count_expiry_edits_behavior.sql` returned **40 passed, 0 failed, 0 not tested** (both reported by the user). Step 2: Edit expiry on Membership Details for every class-count membership, the expiry history, the `Attendance after current expiry` flag, and an ordinary Edit form that no longer edits a class-count expiry; **browser QA reported performed by the user** (no findings shared with the assistant; no automated browser tests were run). `npm test` (1549), lint and build pass. (§6A) | Audit table and `edit_class_count_expiry` (date or No expiry, reason) for every `kind = 'class_count'` membership, legacy or package-linked; guard refusing any other `end_date` change on class-count rows; Edit form stops offering it; flagged records (attended after current expiry, not reversed) shown with the informational flag `Attendance after current expiry`, no acknowledgement; Membership Details action and Class Attendance panel flag | FS-0 (wireframe for the Membership Details action); independent of FS-2–FS-6 | `0049_class_count_expiry_edits.sql`; `lib/class-count-attendance/*`, `lib/memberships/actions.js`, `app/memberships/membership-form.js`, `app/memberships/[id]/*` | Never touches fee, allowance, attendance or reversal rows; legacy class-count memberships are not linked to packages | Behaviour: extend re-enables recording; shorten keeps and flags records; reversal does not extend; Instructor refused |
| **FS-8** Agreed-fee and term corrections — ✅ **implemented and verified (2026-10-15): migration 0050 applied, its behaviour script 35 passed / 0 failed / 0 not tested, and browser QA passed (all reported by the user)** (§6A). A switch between a Custom Fee Plan and standard pricing is allowed in both directions (the open question is closed); a correction keeps the membership's type, student and currency, never touches payments or documents, and leaves a class-count expiry to the audited expiry edit. **One Edit Membership workflow (2026-10-15):** the Edit Membership page for a package-linked membership has Membership, Pricing and Notes sections; a notes-only change is a plain save, a change of a protected term shows the revised price and needs a reason and the confirmed final fee (the FS-8 correction); Membership Details keeps the read-only Corrections history | Audit table and correction function for fee, discounts and start date (re-resolve fee for a new start date, confirm the revised price, recalculate the end date); refuses a final fee ≤ 0 or below payments recorded; a Custom Fee Plan membership's correction never applies discounts (whether a correction may switch between Custom Fee Plan and standard pricing is still to be decided, §7) | FS-5 | `0050_membership_term_corrections.sql`; Membership Details | Payments and documents untouched; links to existing correction actions | Behaviour: audit row with old/new/reason/actor; payment-status recalculation follows existing rules; issued documents unchanged |
| **FS-9** Integration regression — ✅ **complete (2026-10-15), as reported by the user; see the FS-9 integration regression record below** | Full regression across memberships, payments, documents, attendance, class-count, reports, dashboard | All | — | — | `npm test`, lint, build; all relevant behaviour scripts; Browser QA both roles |

**FS-9 integration regression record (2026-10-15 — ✅ complete for the scope below; one documentation item stays open, see section F).** Built from the Phase FS plan and the §6A ledger. Every result below is **as reported by the user**; browser QA findings were not shared with the assistant and no automated browser tests were run.

*A. Verification scripts and their recorded results*

| Migration | Script(s) | Recorded status |
|---|---|---|
| Migrations 0026–0033 | `verify_0026`…`verify_0033` structure and `_behavior` scripts | No result recorded in this plan (the ledger lists these as *Recorded only*). |
| Migrations 0034–0045 | `verify_0034`…`verify_0045` `_behavior` scripts | Catalog fingerprint passed (ledger). **No behaviour-script result recorded** (section F). |
| Migration 0046 | `verify_0046_packages_and_fee_history.sql`; `…_behavior.sql` | Structure: 94 checks passed. Behaviour: first run 170 passed and 1 failed (Test O4, a test-script defect, fixed); re-run after the fix **171 passed, 0 failed, 0 not tested**. |
| Migration 0047 | `verify_0047_package_fee_functions_behavior.sql` | **36 passed, 0 failed, 0 not tested**; the eight functions confirmed present. |
| Migration 0048 | `verify_0048_package_linked_memberships_behavior.sql` | **39 passed, 0 failed, 0 not tested** (after the script was updated for the 0051 join-date guard). |
| Migration 0049 | `verify_0049_class_count_expiry_edits_behavior.sql` | 40 passed, 0 failed, 0 not tested. |
| Migration 0050 | `verify_0050_membership_term_corrections_behavior.sql` | 35 passed, 0 failed, 0 not tested. |
| Migration 0051 | `verify_0051_enrollment_membership_date_rules_behavior.sql` | 39 passed, 0 failed, 0 not tested (concurrency and the reactivation race untested). |
| Migration 0052 | `verify_0052_instructor_class_count_history_behavior.sql` | **58 passed, 0 failed, 0 not tested.** |
| Migration 0053 | `verify_0053_instructor_class_count_recording_behavior.sql` | **23 passed, 0 failed, 0 not tested.** |
| Migration 0054 | `verify_0054_legacy_receipt_protection.sql`; `…_behavior.sql` | Catalog 15/15; behaviour 46 passed, 0 failed, 0 not tested; cleanup confirmed (54 receipts, 49 reserved numbers, no leftover test rows). |

*B. Earlier gaps — closed*

1. **0046** behaviour re-run after the Test O4 fix: 171 passed, 0 failed, 0 not tested.
2. **0047** behaviour script run: 36 passed, 0 failed, 0 not tested; the eight FS-3 functions confirmed present (the "applied by inference" status is replaced by direct evidence).
3. **0052** and **0053** behaviour scripts run: 58 and 23 passed, 0 failed, 0 not tested.
4. **FS-2, FS-3 reconciliation:** the FS-2 and FS-3 rows said "not applied, not verified"; the ledger and the results above show 0046 and 0047 applied and behaviour-verified. Those rows are corrected to match.
5. Still not testable in a single rollback-only transaction: concurrency (noted for 0051 and 0054). FS-5's commit-time conflict check "through the API" is covered only as far as the 0048 script's forced check (its own stated limitation).

*C. FS-4 browser QA* — **passed, as reported by the user** (desktop and mobile; Admin; an Instructor is refused `/settings/packages`), against the FS-4 checklist: list, create, edit details and terms, fee history (schedule, edit, cancel, correct), activate/deactivate, and the empty, error and conflict states. The individual steps were not itemised to the assistant, and no findings were shared.

*D. Browser QA paths (Admin and Instructor)* — **passed, as reported by the user**, across memberships, payments, documents, attendance, class-count, Attendance History, reports, dashboard and settings. The paths below are the checklist that was prepared for this QA; the individual steps were not itemised to the assistant:

| Area | Admin | Instructor |
|---|---|---|
| Memberships | List and filters; Add Membership (legacy and package modes); Membership Details; Edit Membership — legacy form with the FS-D receipt notice, package editor with review/reason/confirmation; Renew; Cancel; Corrections panel; Edit expiry | Cannot open Memberships (redirected) |
| Payments | Record and edit per the 0034–0040 rules; balance and status recalculation | Not reachable |
| Documents | Issue Invoice / receipt; per-payment documents; number and date edit; cancel-and-reissue of a payment document; legacy receipt unchanged after a membership edit (FS-D) | Cannot reach any invoice or receipt |
| Attendance | Today's / All Sessions; mark and save; Review and Confirm | Own sessions only |
| Class-count | Record, reverse, used-up list, Renew; Edit expiry; "Attendance after current expiry" flag | The tab is offered; authorized students only, no phone, no reverse / edit expiry / Renew |
| Attendance History | Calendar, Quick dates, filters, Class count section per date | Own sessions and authorized class-count records only |
| Reports | Every report and filter | Cannot open Reports |
| Dashboard | Admin dashboard and panels | Instructor Dashboard only |
| Settings | Packages & Fees, Center Profile, Invoice / Receipt settings, Roles & Permissions | Cannot open Settings |

*E. Final acceptance gates*

1. `npm test` — **1,685 passed, 0 failed, 0 skipped.**
2. `npm run lint` — **0 errors, 1 pre-existing warning** (`components/ui/avatar.js`, `@next/next/no-img-element`).
3. `npm run build` — **passed.**
4. Behaviour scripts for 0046–0054 — **passed** (section A), 0 failed and 0 not tested in every run.
5. Browser QA for both roles and FS-4 — **passed as reported** (sections C and D).
6. The FS-2, FS-3 and FS-4 rows and the §6A ledger and evidence summary are reconciled to this evidence.

*F. Open documentation items* (not blockers recorded as failures; no result exists to record): the behaviour-script results of migrations 0026–0045 are not recorded in this plan. They were not re-run for FS-9, and no failure is known. Run and record them only if a later phase needs that evidence.

**Cancel Document and Correct & Reissue record (migrations 0055 and 0056 — ✅ complete 2026-10-16).** Every result below is as reported by the user unless it says it was run here. The business rules are in `01-product.md` §5A "Corrections" and the screens in `02-ux.md` "Payment Documents — Cancel Document and Correct & Reissue".
- **Behaviour.** Two separate Admin actions on an issued payment document. **Cancel Document** cancels it with a required reason and issues nothing; the payment stays locked. **Correct & Reissue** cancels it, optionally corrects the payment's methods and amount (the payment date unchanged; the corrected total within the membership's remaining balance, the corrected payment excluded from the other payments), and issues a linked replacement with a new number in the same series, carrying corrected customer, business and (tax invoice only) GSTIN details and a chosen valid invoice date. It is one database transaction, refuses a replacement that differs from the total and tax the Admin reviewed, and writes the audit row (previous and new amount and allocation, reason, cancelled document). A lower amount records no refund.
- **Snapshot.** A replacement carries the original's plan, description, period, service details and tracked marker exactly (0055); correction never refreshes them. For a NEW first document, service details are resolved at the membership start date, else at the date of issue (0056). This came from INV-831, issued with an empty snapshot that its replacements correctly inherited; no existing document was rewritten.
- **Application.** Pure rules and the recalculated review in `lib/invoices/document-correction.js`; the read-only context in `correction-context.js`; the RPC calls, error mapping and server actions (`cancelPaymentDocument`, `previewPaymentDocumentCorrection`, `correctAndReissuePaymentDocument`) in `invoice-core.js`, `actions.js` and `data.js`. UI: the dedicated correction page and form, the Cancel Document dialog, and **View Cancelled Invoice** in the Payments section (the payments query also reads `cancelled_at`). The reason-only dialog was removed. The shared payment fields gained an opt-out of the payment date. The Phase 1 architecture guards were extended narrowly: the preview module may calculate tax for the review (the database remains authoritative), may reuse the GSTIN validator, and the context reader may read the three tax columns.
- **Verification.** Migration 0055: applied and verified. Migration 0056: applied, local and remote migration histories match, `verify_0056_service_details_issue_date_fallback_behavior.sql` 20 passed, 0 failed, 0 not tested. Run here on 2026-10-16: `npm test` 1,769 passed, 0 failed; lint 0 errors (the one existing `<img>` warning in `components/ui/avatar.js`); build passed. Browser QA passed for every scenario: Cancel Document, Correct & Reissue, Issue Document, payment and balance handling, invoice history, View Cancelled Invoice and the service-details fallback. No automated browser tests were run.
- **Not covered, by decision.** A cancel or correction workflow for legacy membership-level receipts is still deferred. Concurrency of two corrections or a correction and a new payment cannot be staged in the rollback-only scripts; the locks (membership, settings, document, in that order) are pinned in the unit tests.

**Central Documents register — Phase 1 plan (approved 2026-10-16; implemented and complete).** Requirements: `01-product.md` §5A "Documents Register" and `02-ux.md` "Documents — central register".
- **Scope.** A read-only, Admin-only list of every stored document in the existing `invoices` table at `/documents`: payment-level tax invoices, payment receipts and legacy membership-level receipts, issued and cancelled, replacements included. Columns: document number, stored title, snapshot customer name and code, membership number, document date, amount, status. Search (document number, snapshot customer name, customer code); filters (document series, status, document date range); newest-first sorting with a stable tie-break; pages of 10; Table from `lg`, Cards below. **No** summary figures, **no** correction-history column, **no** export and no write or issuance action in Phase 1.
- **Dependencies.** Migrations 0026, 0030, 0036, 0037 and 0055 (the `invoices` model, its status and replacement link, the Admin-only RLS policy `invoices_select_admin`); the Memberships list pattern (`ListToolbar`, `ResultsHeader`, `Pagination`, `buildListHref`, the filter, table and card components); `formatInvoiceNumberOf` and `DOCUMENT_TITLE_LABEL`; the existing document pages. **No migration is expected**: every column the register reads exists, the queries are paged, and the sizes involved are a single centre's documents. An index on `invoice_date` is not needed at this volume; if one is ever wanted it needs its own approved migration.
- **Files (proposed).** New: `app/documents/layout.js` (Admin shell, mirrors `app/memberships/layout.js`), `page.js`, `loading.js`, `document-filters.js`, `document-list.js`, `document-table.js`, `document-card-item.js`; `lib/documents/data.js` (server wrapper, `requireRole(ROLES.ADMIN)` first) and `lib/documents/list-core.js` (pure filter parsing, document-number search parsing, row mapping, the detail-route rule; takes the Supabase client so it is testable). Changed: `app/data/navigation.js` (the Admin-only Documents item directly after Memberships) and the navigation pin test.
- **Data.** One paged read of `invoices` with an embedded `memberships(membership_code)`, exact count, filters as plain `eq` / `gte` / `lte`, a number search by the digits typed (the number is matched in either series, so both rows can appear), snapshot name and code by `ilike`. It reads the document's own snapshot, never the student record. Routing: `payment_id` set → `/memberships/[id]/documents/[documentId]`; `payment_id` null → `/memberships/[id]/invoice`.
- **Cancelled and replacement documents.** Every row is shown; none is hidden, merged or summed, so a payment with a cancelled document and a replacement appears as two rows and is never counted twice. The Cancelled status is the only marker in Phase 1.
- **Acceptance criteria.** (1) An Admin sees all documents across memberships, newest first, 10 per page, with the columns above. (2) Search by `INV-837`, `837`, a snapshot customer name and a customer code each find the right rows; the student's current name does not. (3) Series, status and date-range filters work alone and together, the URL carries them, and changing one returns to page 1. (4) Cancelled documents and their replacements are both listed. (5) Each document number opens the right page (payment-level versus legacy), and the membership number opens Membership Details. (6) An Instructor has no navigation item and the route and data function refuse them (and RLS returns nothing). (7) The layout is a table from `lg` and cards below, with empty and no-match states. (8) Numbering, issuing, cancellation, correction, payments, memberships and service-detail snapshots are unchanged, and no table or migration is added. (9) `npm test`, lint and build pass; browser QA as Admin and Instructor.
- **Tests (proposed).** Pure core: filter and search parsing (prefix or digits, injection-safe escaping), row mapping and the routing rule for both document kinds, status and series mapping. Data function with a fake client: the exact filters, ordering, range and count, and no write call. Page and wiring pins: Admin check first in the layout, page and data function; the navigation item (Admin only, directly after Memberships); the components reused from the Memberships list. A guard that the register reads no student table and no summary figure.
- **Status.** Implemented in commit `fa52f38` — `feat: add the read-only Documents register for Admins`. Implementation, automated checks (`npm test`, lint, build), browser QA and real-data checks were reported as passing. No migration or dependency was added.
- **Documents KPI enhancement (✅ complete; implemented locally, not committed or pushed at the time of implementation).** Four compact KPI tiles above the toolbar on `/documents`, on the shared list-page tile component (`StatTile` / `StatTileGroup`): **Total Documents** (every stored document, issued and cancelled), **Issued**, **Cancelled**, and **Issued Value** (the sum of issued documents only; cancelled documents are never counted, and it is not labelled revenue or payments collected). The figures are center-wide and ignore the search and filters. Data: `fetchDocumentSummary` in `lib/documents/list-core.js` (three head counts and a paged read of issued amounts on the existing `invoices` table, added in whole paise; currencies are never added together) with the Admin-only wrapper `getDocumentSummary` in `lib/documents/data.js`; `app/documents/document-summary.js`. States: the loading skeleton shows four tile placeholders; an empty register shows zeros; a failed summary shows a dash and "Summary unavailable" and the list still loads. Layout: two tiles per row on small screens, four from `lg`. No database or migration change; no date filter or new business rule. Verification reported (2026-10-16): `npm test` 1,817 passed, 0 failed; lint 0 errors with the existing `<img>` warning in `components/ui/avatar.js`; build passed. Tests: `lib/documents/summary.test.js`. Browser QA is not recorded here. `01-product.md` §5A and `02-ux.md` still describe Phase 1 as having no summary figures; they were not changed by this entry.
- **Future enhancements (not approved).** A correction-history column ("Replaces" / "Replaced by", one extra indexed read per page); summary figures beyond the four KPI tiles above (only Issued documents may be summed); export; search by the student's current name.

**Class-count attendance visibility (implemented locally, 2026-10-15; no migration).** Student Details → Recent Attendance merges session and class-count records into one newest-first list of 5 with a Session / Class count type label, and Attendance History adds a separate Class count section within each date group (class-count-only dates included in the Admin calendar and Quick dates). Batch, instructor and Present / Absent filters hide class-count records; search matches student name or membership code. Reversed records stay visible and are never valid use; "Attendance after current expiry" only on non-reversed records after the current expiry; class-count records are kept out of every session list, count, total and report; Instructor access is unchanged (Admin-only RLS from 0043 and 0045, and the Instructor page never reads them). Read-only reads through the RLS client (`lib/class-count-attendance/data.js`), pure rules in `lib/class-count-attendance/attendance-rows.js`. Not browser-tested; not committed.

**Instructor class-count history visibility (written locally, 2026-10-15).** Extends the visibility above to an Instructor, read-only: migration `0052` adds three SECURITY DEFINER functions (the authorization rule `class_count_student_visible`, `list_class_count_attendance_history`, `list_class_count_attendance_dates`) and no table, policy or grant; the class-count tables stay Admin only. An Instructor sees records only for students with an active enrollment and current assignment on a series they teach, or attendance on a session they own, with the Reversed status but no reason or time, and no Membership link. Recording, reversal and the Class Count Attendance route are unchanged (Admin only). Pure rules in `lib/class-count-attendance/attendance-rows.js`, scoped reads in `lib/class-count-attendance/data.js`, rollback-only script `verify_0052_instructor_class_count_history_behavior.sql`. **Not applied, not verified, not browser-tested; not committed.** Apply 0052 before the application change reaches Instructors: until then an Instructor's class-count section shows "could not be loaded" and the sessions are unaffected.

**Instructor class-count recording (written locally, 2026-10-15).** An Instructor records class-count attendance for the students they are authorized for (the 0052 visibility rule), from the existing Class Count Attendance tab, now offered to both roles. Migration `0053` re-creates `record_class_count_attendance(membership, request, date)` and `list_class_count_eligible()` from 0045 with only the authorization changed (a unit test proves the rest of each body is identical to 0045); the Instructor's list excludes other students and the phone number; reversal, expiry editing, renewing, the two-argument recorder and every table, policy and grant are untouched. Application: `/attendance/class-count` and `recordClassCount` admit an Instructor, `reverseClassCount` and `editClassCountExpiry` do not, and the used-up list and Renew are Admin only. Rollback-only script `verify_0053_instructor_class_count_recording_behavior.sql`. **Not applied, not verified, not browser-tested; not committed.**

**FS-3 acceptance criteria (audit and ordering)** — added after the FS-2 local review

Migration 0046 checks every audit event it receives (shape, reasons, a required actor, a fee entry of the event's own
package, the `in_effect` flag) but it **does not guarantee** that an event exists for every change: a cancellation or a
correction made by an ad-hoc statement leaves none. The guarantee therefore belongs to the FS-3 functions, and FS-3 is not
complete until all of this is demonstrated by its behaviour script against the functions (not against raw statements):

1. **Exactly one audit event per change, atomically.** Each function that changes a package or a fee entry — create,
   update details, update terms, activate, deactivate, schedule, edit, cancel, correct — writes exactly one
   `package_events` row for that change, in the same transaction as the change. A failed change leaves no event and no
   change. A correction writes one `fee_corrected` event (not a `fee_cancelled` plus a `fee_scheduled`).
2. **The actor is the Admin** (`auth.uid()`), never null; the event carries the before and after states described in the
   FS-2 specification, including the package name.
3. **Reasons.** A correction, and the cancellation of a fee in effect, take a required reason (3–500 characters);
   scheduling, editing and cancelling a scheduled fee take an optional one. The function sets `in_effect` truthfully; the
   0046 trigger refuses a flag that does not match the entry.
4. **Order of writes.** Uniqueness is immediate, not deferred: a correction must cancel the old entry before inserting
   the replacement (only a cancelled entry frees its date), then write the replacement's discounts, then the event. To
   swap the dates of two scheduled entries a temporary date is needed in between. FS-3 must say so to its callers.
5. **Cancellation time.** A cancellation stamps `cancelled_at` with `now()` (the transaction time), not
   `clock_timestamp()` or a caller-supplied value: the 0046 guard compares it with `now()`.
6. **Currency** is stamped from the centre profile, never taken from the caller; **a duration package keeps at least
   one offered option**, enforced in the functions.
7. **No conflict check in FS-3** (approved: FS-5). Because no package-linked membership can exist before FS-5, cancelling
   or correcting an entry in effect is allowed in FS-3; FS-5 re-creates those functions with the conflict check and its
   acceptance tests.
8. **Verification** covers: one event per change; no event on failure; the refused calls (Instructor, anonymous); and a
   scan showing that every cancelled entry and every entry with a `corrects_entry_id` has a matching event.

**Required regression tests**

- Payments: installments, mixed methods, overpayment refusal, payment edits
  (0034–0040 behaviour scripts; `lib/memberships/*payment*.test.js`).
- Documents: tax invoice and payment receipt numbering, duplicate guard,
  cancel-and-reissue, GSTIN, PDF and receipt layouts unchanged
  (0036–0041, 0044 scripts; `lib/invoices/*.test.js`).
- Legacy memberships: current edit workflow, membership-level receipt
  sync (0030), Paid → Pending guard, unchanged rows.
- Session attendance eligibility for duration memberships
  (`resolve_eligible_students`), including package-linked memberships.
- Class-count: recording, net count, reversal, renewal fresh balance
  (0043–0045 scripts; `lib/class-count-attendance/*.test.js`).
- Enrollment: duplicate active enrollment refused; enrollment failure never
  cancels a membership or reverses a payment.
- Authorization: Instructor and anonymous callers refused on every new
  function and table; Admin-only routes.
- Pricing: Custom months and discount mapping (O2a, O2b), currency validity
  (O5), Custom Fee Plan creation with reason and confirmation (O8); JS and SQL
  give the same result for shared cases.
- Class-count expiry: `Attendance after current expiry` flag shown, records
  and balance unchanged (O7).

**FS-1 completion record** (2026-10-13)

- **Status:** ✅ Complete. Implemented to the plan below with S1–S3 approved.
  Not yet committed.
- **Files added:** `lib/packages/duration.js`, `lib/packages/pricing.js`,
  `lib/packages/validation.js` and the matching `duration.test.js`,
  `pricing.test.js`, `validation.test.js`. No existing source file changed;
  nothing imports the new modules yet.
- **Functions:** `resolveDurationMonths`, `packageDiscountDurationFor`,
  `calculateDurationEndDate`, `validateDiscountInput`,
  `validateIndividualDiscountReason`, `calculateDiscountPaise`,
  `resolveStandardFeeEntry`, `priceStandardMembership`, `priceCustomFeePlan`.
- **Results:** 57 new unit tests pass. Full `npm test`: 1,376 passing,
  0 failing. `npm run lint`: 0 errors, 1 pre-existing warning
  (`components/ui/avatar.js`, `<img>`). `npm run build`: successful.
- **Not changed:** no SQL, migrations, database records, receipt triggers or
  UI. Nothing staged or committed.
- **Deviations from the plan:**
  1. Additional error fields for invalid inputs the contract table did not
     cover: `months` (`calculateDurationEndDate`, `priceStandardMembership`),
     `start_date` (`resolveStandardFeeEntry`), `kind` and `fee`
     (`priceStandardMembership`, for an unknown package type or an invalid fee
     entry).
  2. An exported `requiredReasonText` helper (shared by the Other explanation
     and the Custom Fee Plan reason) and exported constants
     (`STANDARD_DURATION_MONTHS`, `DURATION_OPTIONS`, `CUSTOM_MONTHS_MIN/MAX`,
     `DISCOUNT_TYPES`, `INDIVIDUAL_DISCOUNT_REASONS`, `REASON_MIN_LENGTH`,
     `REASON_MAX_LENGTH`, `MAX_PERCENT_BASIS_POINTS`).
  3. Messages use the currency-independent wording "greater than 0" rather
     than "greater than ₹0".
  4. `packageDiscountSource` is `"monthly"` (with a package discount of 0)
     for 1–2 month durations.
  5. `fromPaise` was not needed; only `toPaise` is reused from
     `lib/memberships/payments-core.js`.
- **Not claimed:** these JavaScript results are the calculation contract
  only. Agreement with the database calculation is **not** verified; that is
  part of FS-5.

**FS-1 implementation plan** (prepared 2026-10-13; implemented — see the
completion record above)

*Scope.* Pure JavaScript calculation and validation functions plus unit
tests. No database, server action, UI, receipt-trigger or wireframe
dependency; nothing imports them yet. They establish the calculation
contract; the database stays authoritative in FS-5, and JS/SQL agreement is
**not** claimed until FS-5 verifies it.

*Conventions reused.* Node's built-in test runner (`npm test` →
`node --test "lib/**/*.test.js"`), co-located `*.test.js` files using
`node:test` and `node:assert/strict`; plain ES modules with relative `.js`
imports (as in `lib/memberships/validity.js`); a new feature folder
`lib/packages/`; validators return `{ success: true, data }` or
`{ success: false, errors: { field: message } }` with user-facing messages
(as in `lib/memberships/validation.js`); money as integer paise using
`toPaise` / `fromPaise` from `lib/memberships/payments-core.js` (no imports
of server-only code). No new dependency, no TypeScript. Existing files are
not changed; in particular `calculateMembershipEndDate` (legacy, rolls
forward) stays as it is.

*Files (proposed).* `lib/packages/duration.js`, `lib/packages/pricing.js`,
`lib/packages/validation.js`, and `duration.test.js`, `pricing.test.js`,
`validation.test.js` beside them.

*Functions and contracts.*

| Function | Input | Output | Errors |
|---|---|---|---|
| `STANDARD_DURATION_MONTHS` (constant) | — | `{ monthly: 1, quarterly: 3, half_yearly: 6, annual: 12 }` | — |
| `resolveDurationMonths(option, customMonths)` (`duration.js`) | option `monthly` \| `quarterly` \| `half_yearly` \| `annual` \| `custom`; `customMonths` string or number (custom only) | `{ success, data: months }` | `duration_option`: unknown option; `custom_months`: not a whole number in the allowed range (S2) |
| `packageDiscountDurationFor(months)` (`duration.js`) | whole months ≥ 1 | the largest standard option not exceeding `months` (`monthly` for 1–2, `quarterly` 3–5, `half_yearly` 6–11, `annual` ≥ 12) | — (callers pass validated months) |
| `calculateDurationEndDate(startDate, months)` (`duration.js`) | `YYYY-MM-DD`; whole months ≥ 1 | `{ success, data: "YYYY-MM-DD" }`: add calendar months, clamp to the last day of a shorter month, minus one day | `start_date`: not a valid calendar date |
| `validateDiscountInput({ type, value })` (`validation.js`) | `type` `fixed` \| `percent`; `value` string | `{ success, data: { type: "fixed", valuePaise } \| { type: "percent", basisPoints } }` | `discount`: unknown type, not a positive amount with at most two decimals (fixed), or outside the allowed percentage range (S1) |
| `validateIndividualDiscountReason({ code, note })` (`validation.js`) | `code` `promotional_offer` \| `returning_member` \| `special_approval` \| `other`; `note` string | `{ success, data: { code, note } }` | `discount_reason`: missing or unknown code; `discount_note`: missing for `other`, or outside the allowed length (S3) |
| `calculateDiscountPaise(basePaise, discount)` (`pricing.js`) | integer paise; validated discount | integer paise: fixed → `valuePaise`; percent → `floor((basePaise × basisPoints + 5000) / 10000)` (round half up to the paisa) | — |
| `resolveStandardFeeEntry(entries, startDate, centreCurrency)` (`pricing.js`) | fee entries `{ effectiveFrom, currency, cancelled, monthlyFeePaise?, packageDiscounts?, pricePaise? }[]` | `{ success, data: entry }`: the non-cancelled entry with the latest `effectiveFrom` ≤ `startDate` | `fee`: no entry in effect; `fee`: the entry in effect is in another currency (never converted, never falls back to an older entry); `fee`: two non-cancelled entries share that date (ambiguous) |
| `priceStandardMembership({ kind, entry, months, individualDiscount })` (`pricing.js`) | `kind` `duration` \| `class_count`; resolved entry; months (duration); validated individual discount or null | `{ success, data: { pricingMode: "standard", standardFeePaise, packageDiscountSource, packageDiscountPaise, individualDiscountPaise, finalFeePaise } }`. Standard fee = `monthlyFeePaise × months` or `pricePaise`; package discount (duration only) from `packageDiscountDurationFor(months)`, none for `monthly` or when that option has none configured; individual discount against `standard − package` | `package_discount`: configured discount exceeds the standard fee; `individual_discount`: combined discounts exceed the standard fee; `final_fee`: final fee not greater than 0 |
| `priceCustomFeePlan({ amount, reason, packageDiscount, individualDiscount })` (`pricing.js`) | amount string; reason string; any discount input | `{ success, data: { pricingMode: "custom_fee_plan", standardFeePaise: null, packageDiscountSource: null, packageDiscountPaise: null, individualDiscountPaise: null, finalFeePaise, reason } }` | `custom_fee`: not a positive amount with at most two decimals, or 0; `custom_fee_reason`: missing or outside the allowed length (S3); `discount`: any package or individual discount supplied ("A Custom Fee Plan takes no discounts") |

Explicit confirmation, Admin identity and timestamp belong to the server
action and database (FS-5/FS-6), not FS-1.

*Unit tests (minimum).*

- Monthly: ₹1,500 → standard ₹1,500, no package discount even if one is
  configured for `monthly`.
- Quarterly / Half Yearly / Annual: fixed and percentage package discounts
  against `monthly × months`; the brief's example ₹1,500 × 3 − ₹300 − ₹200 =
  ₹4,000.
- Custom 2 / 5 / 7 / 10 / 12 / 13 months → Monthly (none) / Quarterly /
  Half Yearly / Half Yearly / Annual / Annual; Custom 5 when Quarterly has no
  discount configured → none (no search for another option).
- Package discount then individual discount; individual percentage computed
  on the remaining fee, not the standard fee.
- Half-up rounding at each stage: a percentage yielding x.xx5 rounds up; a
  value just below rounds down; each stage rounded before the next.
- Combined discounts equal to the standard fee → refused (final would be 0);
  greater → refused; final ₹0.01 → accepted.
- Class-count: standard fee = price; no package discount; individual
  discount allowed.
- Custom Fee Plan: valid amount + reason → final fee = amount; with a
  package entry that has discounts, and with an individual discount
  supplied → refused; result never contains a discount; amount 0, negative,
  three decimals or non-numeric → refused; empty reason → refused.
- Fee resolution: latest entry on or before the start date; future and
  cancelled entries ignored; order of the array irrelevant; start date
  before every entry → no valid fee; entry in effect in another currency →
  no valid fee (and no conversion, no fallback); duplicate effective date →
  ambiguous error.
- End dates: 15 Jan + 1 → 14 Feb; 31 Jan 2027 + 1 → 27 Feb 2027;
  31 Jan 2028 + 1 → 28 Feb 2028 (leap year); 29 Feb 2028 + 12 → 27 Feb 2029;
  30 Nov 2026 + 3 → 27 Feb 2027; 31 Aug 2026 + 6 → 27 Feb 2027;
  15 Dec 2026 + 1 → 14 Jan 2027 (year boundary); 1 Mar + 1 → 31 Mar;
  invalid date (`2026-02-30`, `2026-13-01`, empty) → error.
- Invalid inputs: unknown duration option or discount type; Custom months
  0, 1.5, "abc", outside range; percentage 0, above 100, too many decimals;
  fixed discount negative or above the base; reason codes outside the list;
  `other` without a note.
- These tests do not repeat what `lib/memberships/*.test.js` already covers
  (payments, legacy end dates, validity).

*Specification details to confirm before FS-1 starts* (they set validation
contracts; none reopens an approved rule):

- **S1 — discount values.** Proposed: a discount is optional; when given it
  must be greater than 0; a fixed amount has at most two decimals; a
  percentage is greater than 0 and at most 100, with at most two decimals.
- **S2 — Custom months range.** Proposed: a whole number from 1 to 120.
- **S3 — reason text length.** Proposed: the `Other` explanation and the
  Custom Fee Plan reason are trimmed and 3 to 500 characters, the same rule
  as Class Count Attendance reversals (0045) and document corrections
  (0037); a note for the other reason codes is optional, at most 500.

**Open items** — see §7 (Fee Structure O1–O8, O2a, O2b, Custom Fee Plan
discount handling, business-rule status, readiness summary).

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

## 6A. Migration Reconciliation Ledger

Record of which repository migrations are known to be applied to the
development database, and on what evidence. This ledger is a statement of
evidence, **not** a claim that every migration is fully verified.

**Target:** Supabase project `yoga-attendance-demo` (`hrrkzrdihvkauyudhtqf`).
**Audit date:** 2026-10-12. **Scope:** `supabase/migrations/0001`–`0045` audited; `0046` was added to the repository afterwards and has not been applied (see its row).

**What was established**

- **Migration history** (`supabase_migrations.schema_migrations`) contains
  versions `0001`–`0045`. History names have not yet been compared with the
  repository file names.
- **Catalog checks passed** for `0007`, `0014`, `0016`, `0017` and `0021`
  (a read-only query reconstructed from the migration files during the
  audit; it is not saved under `supabase/verification/`).
- **Fingerprint checks were reported as passed** for `0034`–`0045`. The
  query and its exact checks are not stored in the repository.
- Results were reported by the person who ran the queries; raw outputs are
  not stored in the repository.
- **No migration was applied, repaired or re-run** during the audit, and
  `supabase db push` was not used.

**Limits of this evidence.** Catalog checks show that objects exist with
the expected definitions. They do **not** prove data backfills or seed rows,
RLS policies or their effect, trigger behaviour, or runtime behaviour of
functions. Migration history rows show that a version was *recorded* as
applied; they do not prove the schema matches. A migration whose objects
were later replaced is **superseded, not missing**: the database holds only
the latest definition.

**Status legend**

| Status | Meaning |
|---|---|
| **Catalog-confirmed** | History row present and a catalog or fingerprint check passed for its objects |
| **Recorded only** | History row present; not catalog-checked |
| **Repository only** | The migration file exists in the repository; it has **not** been applied to the development database, so there is no history row and no catalog evidence |
| *Superseded by* | Later migrations that replace or redefine this migration's functions, policies, constraints or indexes |
| *Not verified* | Data effects, policies, triggers or behaviour that no check in this audit covered. Applies **in addition** to the status. Runtime behaviour is unverified for every migration. |

| Migration | Status | Catalog evidence | Superseded by | Not verified |
|---|---|---|---|---|
| `0001` | Recorded only | — | `handle_new_user`: 0003 | Profile RLS policies; `on_auth_user_created` trigger |
| `0002` | Recorded only | — | — | Instructor RLS policies |
| `0003` | Recorded only | — | — | Body-only change (role hard-coded in `handle_new_user`) |
| `0004` | Recorded only | — | — | `instructors_select_self` policy |
| `0005` | Recorded only | — | — | Batch RLS policies |
| `0006` | Recorded only | — | — | Student-code triggers; RLS policies |
| `0007` | Catalog-confirmed | Table; PK; `student_id`/`batch_id` FKs `ON DELETE RESTRICT`; status CHECK; `batch_enrollments_end_after_start`; partial unique index `batch_enrollments_one_active_per_batch`; `batch_enrollments_batch_id_idx` | — | RLS and its three policies |
| `0008` | Recorded only | — | Plan CHECK: 0031; payment-status CHECK: 0034; `memberships_no_overlap_per_student`: 0042 | Membership-code triggers; RLS policies |
| `0009` | Recorded only | — | — | Schedule RLS policies |
| `0010` | Recorded only | — | — | Class-session RLS policies |
| `0011` | Recorded only | — | `resolve_eligible_students`: 0012, 0013, 0014, 0015, 0024, 0042; `save_session_attendance`: 0013, 0014, 0015, 0024 | Attendance RLS policies |
| `0012` | Recorded only | — | `resolve_eligible_students(uuid, date)` dropped and replaced by 0013 | — |
| `0013` | Recorded only | — | `resolve_eligible_students`: 0014, 0015, 0024, 0042; `save_session_attendance`: 0014, 0015, 0024 | **Data backfill:** `schedule_series`, `schedules.series_id`, `enrollment_schedules`; RLS policies |
| `0014` | Catalog-confirmed | `can_access_session(uuid, date)`, `materialize_class_session(uuid, date)`: exist, `SECURITY DEFINER`, pinned `search_path`, expected return type, `EXECUTE` for `authenticated` | `resolve_eligible_students`: 0015, 0024, 0042; `save_session_attendance`: 0015, 0024 | Four instructor SELECT policies; RLS behaviour (`verify_0014_instructor_access.sql` not re-run) |
| `0015` | Recorded only | — | `resolve_eligible_students`: 0024, 0042; `save_session_attendance`: 0024 | Snapshot **backfill** (separate script; recorded as done in §5 Phase 16A, not re-checked); RLS policies |
| `0016` | Catalog-confirmed | `report_session_facts(date, date, uuid, uuid)`: exists, `SECURITY INVOKER`, `STABLE`, pinned `search_path`, returns `TABLE`, `EXECUTE` for `authenticated` | — | Function output |
| `0017` | Catalog-confirmed | `session_attendance_summaries(jsonb)`: exists, `SECURITY INVOKER`, `STABLE`, pinned `search_path`, returns `TABLE`, `EXECUTE` for `authenticated` | — | Function output |
| `0018` | Recorded only | — | — | **Seed row** in `center_profile`; RLS policies |
| `0019` | Recorded only | — | `profile_photos_delete_admin` policy: 0026 | **Storage bucket row**; storage policies |
| `0020` | Recorded only | — | `enrollment_schedules_delete_unstarted_admin` policy: 0024 | Policy behaviour |
| `0021` | Catalog-confirmed | `schedule_usage(uuid, date)`, `delete_unused_schedule(uuid)`, `correct_unused_schedule(uuid, text, uuid, time, time, date, date)`: exist, `SECURITY DEFINER`, pinned `search_path`, return `jsonb`, `EXECUTE` for `authenticated`, not `anon`. Live bodies are the 0024 definitions (expected). | All three functions: 0024 | Runtime behaviour |
| `0022` | Recorded only | — | — | **Data backfill:** `phone_country_code = '+91'` on students and instructors |
| `0023` | Recorded only | — | — | — |
| `0024` | Recorded only | — | `resolve_eligible_students`: 0042 | Timezone trigger; re-created policy |
| `0025` | Recorded only | — | — | **Seed row** in `invoice_settings`; payment-rules trigger |
| `0026` | Recorded only | — | `invoice_settings_guard`: 0027, 0036, 0041; `invoices_freeze_snapshot`: 0030, 0033, 0037; `issue_invoice_core`: 0027, 0029, 0030, 0031, 0033, 0036, 0041, 0044; `issue_invoice`, `memberships_auto_issue_invoice`, `memberships_invoice_guard`, `update_invoice_details`: 0036; `invoices_invoice_number_unique`, `invoices_membership_id_unique`: re-created 0036 | **Storage bucket row**; invoice triggers; RLS and storage policies |
| `0027` | Recorded only | — | `invoice_settings_guard`: 0036, 0041; `issue_invoice_core`: 0029, 0030, 0031, 0033, 0036, 0041, 0044 | — |
| `0028` | Recorded only | — | — | Bank-account trigger; RLS policies |
| `0029` | Recorded only | — | `issue_invoice_core`: 0030, 0031, 0033, 0036, 0041, 0044 | — |
| `0030` | Recorded only | — | `invoices_freeze_snapshot`: 0033, 0037; `invoices_reserve_number`: 0036; `issue_invoice_core`: 0031, 0033, 0036, 0041, 0044; `sync_invoice_from_membership`: 0031, 0033, 0036, 0044 | **Data backfill** of `invoice_number_reservations`; sync triggers |
| `0031` | Recorded only | — | `memberships_plan_valid`, `invoices_plan_valid`: 0042; `issue_invoice_core`: 0033, 0036, 0041, 0044; `sync_invoice_from_membership`: 0033, 0036, 0044 | — |
| `0032` | Recorded only | — | — | Function output |
| `0033` | Recorded only | — | `invoices_freeze_snapshot`: 0037; `issue_invoice_core`: 0036, 0041, 0044; `sync_invoice_from_membership`: 0036, 0044 | — |
| `0034` | Catalog-confirmed (reported fingerprint) | Fingerprint passed | `record_membership_payment`: 0035 | Payment triggers and behaviour; RLS policies |
| `0035` | Catalog-confirmed (reported fingerprint) | Fingerprint passed | — | Behaviour |
| `0036` | Catalog-confirmed (reported fingerprint) | Fingerprint passed | `issue_payment_document`: 0037; `invoices_payment_id_unique`: re-created 0037; `invoice_settings_guard`: 0041; `issue_invoice_core`: 0041, 0044; `sync_invoice_from_membership`: 0044 | Numbering and document behaviour |
| `0037` | Catalog-confirmed (reported fingerprint) | Fingerprint passed | `issue_payment_document_core`: 0038, 0039, 0041, 0044 | Correction behaviour |
| `0038` | Catalog-confirmed (reported fingerprint) | Fingerprint passed | `issue_payment_document_core`: 0039, 0041, 0044 | Edit-history behaviour; RLS policy |
| `0039` | Catalog-confirmed (reported fingerprint) | Fingerprint passed. Body-only migration: shows only that the guard is present in the current body. | `issue_payment_document_core`: 0041, 0044 | Guard behaviour |
| `0040` | Catalog-confirmed (reported fingerprint) | Fingerprint passed | — | Behaviour |
| `0041` | Catalog-confirmed (reported fingerprint) | Fingerprint passed | `issue_invoice_core`, `issue_payment_document_core`: 0044 | **Initial GSTIN value** in `invoice_settings`; behaviour |
| `0042` | Catalog-confirmed (reported fingerprint) | Fingerprint passed | — | Eligibility behaviour |
| `0043` | Catalog-confirmed (reported fingerprint) | Fingerprint passed | `class_count_attendance_guard`, `list_class_count_eligible`, `record_class_count_attendance`: 0045 | Read-only triggers; RLS policy |
| `0044` | Catalog-confirmed (reported fingerprint) | Fingerprint passed | `memberships_class_count_history_guard`: 0045 | History-guard behaviour |
| `0045` | Catalog-confirmed (reported fingerprint) | Fingerprint passed | — | Read-only triggers; reversal behaviour; RLS policy |
| `0046` | Applied to `yoga-attendance-demo` by the user; structure script passed (94 checks); behaviour script passed — 171 passed, 0 failed, 0 not tested (both reported by the user) | — | — | V1 Fee Structure, FS-2: the five package tables `packages`, `package_duration_options`, `package_fee_entries`, `package_fee_entry_discounts`, `package_events`, with their guards, RLS and no client write grants. It does **not** guarantee that an audit event exists for every change (the FS-3 functions do), and its triggers do not stop an owner who disables or replaces them. The behaviour script first reported 170 passed and 1 failed (Test O4, a test-script defect, since fixed); after the fix it was re-run and reported 171 passed, 0 failed, 0 not tested. Source file still uncommitted. |
| `0047` | Applied; behaviour script passed — 36 passed, 0 failed, 0 not tested; the eight functions confirmed present (reported by the user, 2026-10-15) | — | — | Everything. Written locally on 2026-10-13 (V1 Fee Structure, FS-3: eight Admin-only functions `create_package`, `update_package_details`, `update_package_terms`, `set_package_status`, `schedule_fee_entry`, `edit_fee_entry`, `cancel_fee_entry`, `correct_fee_entry`, and nine internal helpers). Each change writes exactly one audit event in the same transaction. No table, trigger or policy changes; no fee-conflict check (FS-5). **Applied and verified:** `verify_0047_package_fee_functions_behavior.sql` returned 36 passed, 0 failed, 0 not tested and confirmed all eight functions present (reported by the user, FS-9). Its SQL text is also pinned by unit tests (`lib/packages/package-functions-migration.test.js`). |
| `0048` | Applied to `yoga-attendance-demo` by the user; behaviour script passed — 39 passed, 0 failed, 0 not tested (reported by the user, after the script was updated for the 0051 join-date guard) | — | — | V1 Fee Structure, FS-5: nullable package-linked columns on `memberships`, the `memberships_package_consistency` CHECK, `create_membership_from_package` (fee resolved by start date in the centre currency or an explicit confirmed Custom Fee Plan, end date and discounts calculated in SQL, final-fee rules), guards on package-linked memberships and on membership-level documents, and a deferred fee-conflict check on every fee-entry change with `package_fee_conflicts()` for the screens. Changes no existing row. **Reported by the user (2026-10-13):** `verify_0048_package_linked_memberships_behavior.sql` — 39 passed, 0 failed; the leftover-fixtures query returned 0 packages and 0 students. **Still not verified:** the commit-time behaviour of the deferred conflict check through the API (the script forces it with `SET CONSTRAINTS … IMMEDIATE`); concurrency; the behaviour of 0031–0045 (the plan's FS-5 prerequisite). The legacy membership-level receipt sync is FS-D. |
| `0049` | Applied to `yoga-attendance-demo`; behaviour script passed — 40 passed, 0 failed, 0 not tested (both reported by the user) | — | — | Everything. Written locally on 2026-10-13 (V1 Fee Structure, FS-7 step 1: the append-only `class_count_expiry_edits` audit table, `edit_class_count_expiry(membership, new expiry or NULL, reason)` — Admin only, trimmed 3–500 character reason, for every class-count membership, legacy or package-linked — a guard refusing any other change of a class-count `end_date`, 0048's package guard re-created with the one expiry-edit exemption, and the legacy receipt-sync trigger re-created so an expiry edit never rewrites an issued membership-level receipt). Changes no existing row. **Applied** to the demo database, and `verify_0049_class_count_expiry_edits_behavior.sql` returned **40 passed, 0 failed, 0 not tested** (both reported by the user, 2026-10-14). The screens are FS-7 step 2 (browser QA reported performed by the user). Its SQL text is also pinned by unit tests (`lib/memberships/class-count-expiry-edits-migration.test.js`). **If migration 0030 or 0048 is re-run afterwards, re-apply 0049:** it replaces `memberships_sync_invoice_trigger` (0030) and `memberships_package_guard()` (0048), and a re-run of either puts the old definition back. |
| `0050` | Applied; behaviour script passed — 35 passed, 0 failed, 0 not tested (both reported by the user, 2026-10-15) | — | — | V1 Fee Structure, FS-8 (written 2026-10-15; the number reserved since FS-5): the audit table `membership_term_corrections` (append-only: who, when, reason, the values before and after, the payments recorded, the payment status before and after), `membership_correction_core` (internal: prices and checks a correction exactly as `create_membership_from_package` prices a new membership, in the membership's own currency, refusing a final fee that is not above 0 or is below the payments recorded), `preview_membership_correction` and `correct_membership_terms` (Admin only; the revised final fee must be confirmed and equal the calculated one; the payment status is recalculated from the payments; no payment, document, attendance or session is touched) and `memberships_package_guard()` re-created from 0049 with one more exemption, for the correction of that membership, which still cannot change the student, type or currency. Changes no row. **Applied**, and `verify_0050_membership_term_corrections_behavior.sql` returned **35 passed, 0 failed, 0 not tested** (both reported by the user); browser QA of the unified Edit Membership workflow was reported passed. Concurrency remains untested (it cannot be tested in one transaction). Its SQL text is pinned by unit tests (`lib/memberships/term-corrections.test.js`, including that the guard equals 0049's apart from the exemption and that the pricing lines equal 0048's). **If 0048 or 0049 is re-run afterwards, re-apply 0050.** |
| `0051` | Applied to `yoga-attendance-demo`; behaviour script passed — 39 passed, 0 failed, 0 not tested (both reported by the user) | — | — | Join-date rules and the enrollment start-date cascade (written 2026-10-15; `0050` stays reserved for FS-8). Triggers only, no table, column or grant: an enrollment or membership cannot START before the student's join date (judged on insert and when the start date changes), a join date cannot move later than an active enrollment's or a non-cancelled membership's start, and an enrollment start-date edit moves, in the same statement, only the schedule assignments that start on its old start (an overlap or an end-before-start rolls everything back). Changes no existing row; existing violating records remain until the join date is corrected. **Applied** to the demo database, and `verify_0051_enrollment_membership_date_rules_behavior.sql` returned **39 passed, 0 failed, 0 not tested**; the leftover-fixtures query returned 0 students, 0 batches, 0 instructors and 0 packages; the four 0051 triggers are present and enabled; and `npx supabase migration list` shows the local and remote histories matching through `0051` (all reported by the user, 2026-10-15). **Still not verified:** concurrency between a join-date change and an enrollment or membership write (it rests on row locks and cannot be tested in one transaction), and the accepted, low-probability **reactivation race** (setting an out-of-range enrollment from inactive to active takes no student-row lock, so it can commit alongside a join-date move and leave an active enrollment starting before the join date; documented in the script header, untested). Records that already started before their student's join date are unchanged until the join date is corrected. Its SQL text is also pinned by unit tests (`lib/students/join-date-migration.test.js`). |
| `0052` | Applied by the user (reported 2026-10-15); behaviour script passed — 58 passed, 0 failed, 0 not tested (reported by the user) | — | — | Instructor read access to class-count attendance history (written 2026-10-15; `0050` stays reserved for FS-8). Three functions only, no table, column, policy or grant, no row changed: `class_count_student_visible` (Admin all; an active Instructor only a student with an active enrollment and current assignment on a series they teach, or attendance on a session they own), `list_class_count_attendance_history` and `list_class_count_attendance_dates` (the records and per-date counts for Attendance History; an Instructor gets the Reversed status but never the reversal reason or time, and no phone, email, recorder or amount). The class-count tables stay Admin only, and recording, reversal and eligibility are untouched. **Applied**, as reported by the user; `verify_0052_instructor_class_count_history_behavior.sql` returned 58 passed, 0 failed, 0 not tested, so its behaviour is verified (reported by the user) (it needs an Admin and two active linked instructors). Its SQL text is pinned by unit tests (`lib/class-count-attendance/instructor-history-migration.test.js`). Concurrency cannot be tested in one transaction. |
| `0053` | Applied by the user (reported 2026-10-15); behaviour script passed — 23 passed, 0 failed, 0 not tested (reported by the user) | — | — | Instructor recording of class-count attendance (written 2026-10-15; `0050` stays reserved for FS-8, `0052` is applied). Re-creates two functions from 0045 and nothing else: `record_class_count_attendance(uuid, uuid, date)` admits an Admin as before and an active Instructor only for a membership of a student authorized for them (`class_count_student_visible`, 0052), an unknown and an unauthorized membership refused identically (42501), every later rule unchanged and the audit `recorded_by` the caller; `list_class_count_eligible()` admits an Instructor with only their own students' eligible memberships and no phone. No table, policy, trigger, grant of a table or row is changed; reversal and expiry editing stay Admin only. **Applied**, as reported by the user; `verify_0053_instructor_class_count_recording_behavior.sql` returned 23 passed, 0 failed, 0 not tested, so its behaviour is verified (reported by the user) (it needs an Admin and two active linked instructors). Its SQL text is pinned by unit tests (`lib/class-count-attendance/instructor-recording-migration.test.js`, including that the re-created functions equal 0045's apart from the authorization). If 0043 or 0045 is re-run afterwards, re-apply 0053. |
| `0054` | Applied; catalog verification 15/15 passed; behaviour script passed — 46 passed, 0 failed, 0 not tested; cleanup confirmed (all reported by the user, 2026-10-15) | — | — | V1 Fee Structure, FS-D (written 2026-10-15): drops `memberships_sync_invoice_trigger`, `memberships_sync_invoice()` and `sync_invoice_from_membership(uuid)` so an issued legacy membership-level receipt is never rewritten by a membership edit. Three idempotent drops after dependency preconditions; no row, table, policy or grant changed. Re-running 0030, 0031, 0033, 0036, 0044 or 0049 afterwards can reinstall the sync path (0049 refuses; the others do not) - re-apply 0054. |
| `0055` | Applied and verified (reported by the user, 2026-10-16) | — | — | Cancel Document and Correct & Reissue for payment documents (written 2026-10-15). Adds `cancel_payment_document` and `correct_and_reissue_payment_document`, `edit_payment_core` (with `edit_payment` as its unchanged wrapper) and a five-argument `issue_payment_document_core` with whitelisted customer / business overrides (the four-argument form is its wrapper); two additive nullable columns on `membership_payment_edits` (`correction_reason`, `corrected_document_id`). A replacement copies the original's plan, description, period, service details and tracked marker (it never calls `membership_service_details`), for `correct_payment_document` (0037) as well. The balance rule (the corrected total at most the membership amount less its OTHER payments) is enforced in the database under the membership lock. No row changed. Re-running 0040 or 0044 replaces its wrappers: re-apply 0055. |
| `0056` | Applied; local and remote migration histories match; behaviour script passed — 20 passed, 0 failed, 0 not tested (all reported by the user, 2026-10-16) | — | — | Service details of a NEW document (written 2026-10-16). Re-creates only `membership_service_details(uuid)`: the classes at the membership's start date, and only when none apply there, at the centre's date of issue; NULL when neither finds one. Same query, output shape, ordering and security as 0033; no document, table, trigger or grant touched, nothing backfilled. Re-running 0033 puts the start-date-only lookup back: re-apply 0056. |

**Summary by evidence**

- Catalog-confirmed (17): `0007`, `0014`, `0016`, `0017`, `0021`, `0034`–`0045`.
- Recorded only (28): `0001`–`0006`, `0008`–`0013`, `0015`, `0018`–`0020`,
  `0022`–`0033`.
- Applied by the user, structure and behaviour scripts passed as reported (1): `0046` — structure 94 checks; behaviour 171 passed, 0 failed, 0 not tested.
- Applied by the user, behaviour script passed as reported (3 more): `0047` — 36 passed, 0 failed, 0 not tested; `0052` — 58 passed, 0 failed, 0 not tested; `0053` — 23 passed, 0 failed, 0 not tested.
- Applied by the user, behaviour script passed as reported (3): `0048` — 39 passed, 0 failed, 0 not tested; `0049` — 40 passed, 0 failed, 0 not tested; `0051` — 39 passed, 0 failed, 0 not tested (concurrency and the reactivation race untested).
- Applied by the user, behaviour script passed as reported (1 more): `0050` — 35 passed, 0 failed, 0 not tested.
- Applied by the user, catalog and behaviour scripts passed as reported (1 more): `0054` — 15/15 catalog checks; 46 passed, 0 failed, 0 not tested.
- Applied and verified as reported (2 more): `0055` — applied and verified; `0056` — applied, local and remote migration histories match, behaviour script 20 passed, 0 failed, 0 not tested.
- No mismatch between migration history and catalog objects is indicated by
  the evidence above.
- Not established by this audit for any migration: data backfills and seed
  rows, RLS policy effect, trigger behaviour, runtime function behaviour.

**Open follow-ups** (each is a separate, approved step)

1. Save the `0034`–`0045` fingerprint query and the `0007`/`0014`/`0016`/
   `0017`/`0021` catalog query under `supabase/verification/` so the
   evidence is reproducible.
2. Optional read-only fingerprint check of the 28 recorded-only migrations,
   including a comparison of history names with repository file names.
3. Before work that builds on memberships, payments or documents
   (`0031`–`0045`), run the relevant `*_behavior.sql` scripts on approval.
   They write rollback-only fixtures.
4. Do not run `supabase db push` or `supabase migration repair`; the history
   is already complete and nothing here calls for a repair.

Update this ledger whenever a migration is added, applied or verified.

---

## 7. Open Items Requiring Decision

| Item | Status |
|---|---|
| **Brand logo asset** | No approved logo/lotus asset exists in the repository. Branding is currently text-only. Requires a supplied asset or an explicit decision to remain text-only. |
| **Batch Details → Students tab** | Still shows the "not available yet" placeholder written before Phase 11, although Students and Batch Enrollment shipped in phase 11. Tracked as a Phase 11 follow-up; explicitly **not** part of Phase 13 (see §5). Needs scheduling into its own small phase or a follow-up commit. Once Phase 15A lands, this tab should also show each student's assigned schedules. |
| **Backfill scope (Phase 15A)** | The `0013` backfill is specified for existing **active** enrollments. Whether inactive/historical enrollments should also receive assignments — and if so, dated to what — is undecided. Recommended: active enrollments only, since historical eligibility for past sessions is only consulted through screens that would show the same students either way. |
| **Backfill date vs. schedule age (Phase 15A)** | The backfill dates each assignment from the enrollment's own start date, which can predate a schedule that was created later. Harmless in practice (eligibility also requires the schedule to have produced a session on that date) but it does store an assignment period wider than the schedule ever existed for. Alternative: date each assignment from the later of the enrollment start and the schedule series' first effective date. |
| **Re-snapshot escape hatch (Phase 16A)** | Once a session's eligible set is snapshotted it is immutable, which is the intended behaviour. Whether an admin ever legitimately needs to add a student to an already-completed session's roster — and if so, through what audited mechanism — is **undecided and deliberately not built** in Phase 16A. Recorded here rather than answered by inventing a mechanism. |
| **Eligible-but-unmarked students lost before Phase 16A (Phase 16A)** | For sessions completed before the snapshot existed, a student who was eligible but left unmarked, and has since dropped out of live eligibility, cannot be recovered — no attendance row, no stored `eligible_count`, no audit trail. Those sessions will under-report Eligible by that number. Accepted as unrecoverable; no action proposed. |
| **Fee Structure O1 — protect issued documents** | ✅ **Decided 2026-10-13:** issued invoices and receipts never change silently, for legacy and package-linked workflows; corrections use cancel-and-reissue where applicable; the 0030 trigger was removed by migration 0054 (applied and verified 2026-10-15). Investigation result in §5 Phase FS. **FS-D complete (2026-10-15).** No membership-level cancel-and-reissue exists; an audited cancel-and-reissue workflow for legacy membership-level receipts (§5 Phase FS, FS-D) remains **deferred** — a later decision, not built. |
| **Fee Structure O2 — Custom duration and package discounts** | ✅ **Decided 2026-10-13:** Custom is a whole number of calendar months; standard fee = monthly base fee × months; Custom uses the package discount of the largest standard duration not exceeding its months (2 → Monthly, 5 → Quarterly, 7 → Half Yearly, 10 → Half Yearly); Monthly has no package discount; individual discount afterwards; no fixed-day calculation. Recorded in `01-product.md` §5, §11. |
| **Fee Structure O2a — Custom months chosen per membership** | ✅ **Approved:** the Admin selects the Custom duration in whole calendar months when creating a membership; it is not restricted to a length configured on the package; standard fee = monthly base fee × selected months. Recorded in `01-product.md` §5, §11, §12 and `02-ux.md`. |
| **Fee Structure O2b — Custom discount mapping** | ✅ **Approved:** the package discount of the largest standard duration not exceeding the selected months (2 → Monthly = none, 5 → Quarterly, 7 → Half Yearly, 10 → Half Yearly, 12 → Annual); if that duration has no discount configured, no package discount applies and no other duration is searched; then the individual discount by the approved rules (against the remaining fee, half-up per stage, mandatory reason, final > 0). Recorded in `01-product.md` §5, §11, §12 and `02-ux.md`. |
| **Fee Structure O3 — expiry edits for all class-count memberships** | ✅ **Decided 2026-10-13:** the audited expiry edit applies to every class-count membership, including legacy ones, without linking them to packages; reason, previous and new expiry, Admin and time recorded; history and class balance preserved; no automatic extension on reversal; historical attendance outside the revised expiry flagged. Recorded in `01-product.md` §5, §12 and `02-ux.md`. |
| **Fee Structure O4 — fee-history conflict** | ✅ **Decided 2026-10-13:** a change conflicts when it would change which fee entry applies to an existing membership's start date; it is blocked, affected memberships are shown and must be explicitly resolved; no automatic repricing; payments and issued documents unchanged. **Approved; closed.** Recorded in `01-product.md` §5. |
| **Fee Structure O5 — currency** | ✅ **Approved:** new memberships use a valid fee in the centre's current currency; no automatic conversion; existing memberships keep their original currency and agreed fee; a Custom Fee Plan is the explicit alternative to standard fee resolution. Recorded in `01-product.md` §5, §12 and `02-ux.md`. |
| **Fee Structure O6 — Monthly package discount** | ✅ **Resolved by the O2 decision (2026-10-13):** Monthly has no package discount. |
| **Fee Structure O7 — attendance review flag** | ✅ **Approved:** historical attendance outside a revised class-count expiry shows the informational flag `Attendance after current expiry`; attendance and class balance preserved; no automatic reversal; no acknowledgement step in V1. Recorded in `01-product.md` §5, §8 and `02-ux.md`. |
| **Fee Structure O8 — Custom Fee Plan** | ✅ **Approved:** standard package pricing is the default; the Admin may explicitly use a Custom Fee Plan for a special price (even when a standard fee exists) or when no valid standard fee applies to the start date; it requires a custom agreed fee, a mandatory reason, Admin identity, timestamp and explicit confirmation before creation; agreed fee, currency and terms preserved; payments and issued documents never changed silently; later fee corrections remain the separate audited action. Recorded in `01-product.md` §5, §12 and `02-ux.md`. (Supersedes the earlier proposal that the form simply could not be saved when no fee is in effect.) |
| **Fee Structure — Custom Fee Plan discount handling** | ✅ **Approved 2026-10-13:** the Custom Fee Plan amount is the final agreed fee; no package discount and no individual discount is applied on top; standard pricing remains the default; a Custom Fee Plan is an explicit alternative for an Admin-approved special price or when no valid standard fee applies to the start date; it requires the custom agreed fee, a mandatory reason, Admin identity, timestamp and explicit confirmation before creation; agreed fee, currency and terms preserved; corrections remain the separate audited action; payments and issued documents never changed silently. Recorded in `01-product.md` §5, §12 and `02-ux.md`. **Implementation effects:** FS-1 validation (custom fee > 0, reason required, discount inputs refused in Custom Fee Plan mode); FS-5 schema (pricing mode `standard` / `custom_fee_plan`; discount columns NULL for a Custom Fee Plan; custom-plan reason; confirmed-by/at; CHECK tying them together) and create function (no fee resolution in custom mode); FS-6 UI (discount fields hidden; Review labels the plan). **Still open for FS-8 only (does not block FS-1):** whether a correction may switch a membership between a Custom Fee Plan and standard pricing. |
| **Fee Structure — business-rule status (Q1–Q11, O1–O8)** | ✅ Q1 final fee > ₹0. ✅ Q2 package discount against the standard fee, individual discount against the remaining fee, half-up per stage, no reason for package discounts, combined ≤ standard fee. ✅ Q3 legacy memberships keep their edit workflow, except that issued documents never change silently and class-count expiry uses the audited edit. ✅ Q4/O3 class-count expiry is a manual date or No expiry, edited only by the audited expiry edit (extend, shorten, switch) for every class-count membership; history and balance preserved. ✅ Q5 package-name snapshot; document layouts unchanged. ✅ Q6 monthly base fee with duration options; Custom months chosen per membership (O2a). ✅ Q7/O1 issued documents never change silently; no breakdown on documents — legacy receipt-protection **implementation** is the separate FS-D design task. ✅ Q8/O4 start date decides the fee; start-date changes re-resolve with confirmation; conflicting fee-history changes blocked. ✅ Q9 no frequency field. ✅ Q10/O5 valid fee in the centre's current currency unless an explicit Custom Fee Plan; no conversion. ✅ Q11 only fees are effective-dated; package terms edited for future purchases, audited. ✅ O2/O2b/O6 Custom discount from the largest standard duration not exceeding the months, none if not configured; Monthly has none. ✅ O7 informational `Attendance after current expiry` flag. ✅ O8 Custom Fee Plan. Approved rules are not reopened without a concrete contradiction. |
| **Fee Structure — readiness summary (2026-10-13)** | All business rules above are approved. **Awaiting approval:** the three FS-1 specification details (§5 Phase FS, "FS-1 implementation plan", S1–S3). **Still required:** wireframes for Settings → Packages & Fees, package-linked Membership Details actions and the Custom Fee Plan flow; authorized behaviour verification of 0031–0045; investigation of legacy class-count memberships on the development database; verification of every database path that can create or rewrite a membership-level document. None of these database facts is verified yet. FS-1 depends on none of the "still required" items. |
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
