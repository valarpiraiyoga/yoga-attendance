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
| 14 | Class Sessions | ⬜ Not started — next |
| 15 | Attendance | ⬜ Not started |
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
| Schedule | `3471c11`, `2c20e1b` | Recurring weekly schedules with effective-date versioning; both approved views — List View and the Weekly Schedule week grid |

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
  correction tracked in §7.

Students, Batch Enrollments and Memberships are untouched by this phase.
Attendance eligibility needs all three, but it is evaluated against a session
date at attendance time, which is Phase 15's concern — Phase 14 must not
import from those feature areas.

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
| **Batch Details → Students tab** | Still shows the "not available yet" placeholder written before Phase 11, although Students and Batch Enrollment shipped in phase 11. Tracked as a Phase 11 follow-up; explicitly **not** part of Phase 13 (see §5). Needs scheduling into its own small phase or a follow-up commit. |
| **Schedule default view** | `02-ux.md`'s Information Architecture states "Weekly Schedule ← Default", but Phase 13 shipped with List View as the default at `/schedule`. Approved as a Phase 13 correction: `/schedule` should open Weekly Schedule, with List View still reachable through the existing view toggle. Nothing else about either view changes. Not yet applied in code. |

The AppShell structural relationship between Sidebar and Header previously
listed here is **resolved** — see Phase 6 in §5.

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
