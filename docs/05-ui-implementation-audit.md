# UI Implementation Audit Report

Status: **AUDIT ONLY — no implementation performed.**

Scope: the existing UI implementation (`app/`, `components/`) measured against
`docs/ui-reference/` and the approved visual/UX sources of truth.

Baseline at time of audit: `npm run lint` → **0 errors, 4 warnings**
(`@next/next/no-img-element`, pre-existing, student photo rendering).
UI code size: **20,422 lines** across `app/` + `components/`.

---

## 0. How to read this report

Two things are true at once and must not be confused:

1. **The implementation is architecturally sound.** Tokens exist and are
   respected by feature code, the shell is a real shell, auth boundaries are
   correct, data access is separated, comments are unusually disciplined.
2. **The implementation is not yet a *system*.** The same pattern has been
   re-solved independently in 5–15 places. That is the entire subject of this
   report.

The dominant finding is not "these pages look wrong". It is: **there is no
shared UI vocabulary layer between `components/ui/*` (shadcn primitives) and
the pages.** Every page reaches straight from a primitive to a bespoke
composition, so each page re-invents the same six compositions.

---

## 1. Current UI architecture

### 1.1 Layer map

| Layer | Location | State |
|---|---|---|
| Design tokens | `app/globals.css` | Solid. Approved tokens + documented shadcn alias layer, dark-theme-ready, no second system. |
| Primitives | `components/ui/*` (14 files) | shadcn/Base UI defaults, **largely un-tokenized**. |
| Layout | `components/layout/*` (6 files) | Good, but thin — only 6 shared pieces for 9 feature areas. |
| Global shell | `components/global/*` (5 files) | Correct structure, off-token typography, missing reference elements. |
| Feature UI | `app/**` | On-token, but ~15 duplicated compositions. |

### 1.2 What genuinely exists as shared, reusable UI today

- `components/layout/AppShell.js` — sidebar + header + scrollable main.
- `components/layout/Container.js` — 1200px cap.
- `components/layout/PageHeader.js` — icon tile + h1 + description + actions.
- `components/layout/Section.js` — vertical rhythm.
- `components/layout/TabContentHeading.js` — in-tab heading.
- `components/layout/ListPageSkeleton.js` — list loading state.
- `components/global/{Header,Sidebar,MobileMenu,NavList,UserMenu}.js`.
- `components/auth/AuthLayout.js`.
- `components/ui/*`: badge, button, confirm-dialog, data-table-shell, dialog,
  dropdown-menu, input, label, select, sheet, skeleton, switch, table, textarea.

### 1.3 Route/layout composition

Nine feature areas each own a `layout.js` that repeats
`AppShell → Container → children` plus their own `requireRole`. The repetition
is **justified** (different role requirements per area; a route group would
collapse that) — not a defect. `app/page.js` (Dashboard) composes `AppShell`
directly.

### 1.4 Token conformance

Feature code is disciplined. Off-token typography (`text-sm` / `text-xs` /
`text-base` rather than `text-body` / `text-small`) occurs in exactly
**17 places across 11 files**, all of them inside `components/ui/*` and
`components/global/*`. No feature file uses raw Tailwind type scale.

This is the good news: fixing the primitives fixes the whole app.

---

## 2. UI pattern inventory

| Pattern | Canonical today? | Where it lives |
|---|---|---|
| Page header | **Yes** — `PageHeader` | All 9 list pages |
| Section rhythm | Yes — `Section` | Partial adoption |
| List loading | Yes — `ListPageSkeleton` | 6 `loading.js` files |
| Table chrome | Yes — `Table*` + `DataTableShell` | 16 files |
| Badge | Partly — `Badge` | 15 files override it identically |
| Button | Partly — `Button` | 10 files override its height |
| Confirm dialog | Partly — `ConfirmDialog` | Deactivate / cancel / review flows |
| Folder tabs | CSS-only (`globals.css`) | 5 files re-implement the markup |
| Filter bar + drawer + chips | **No** | 6 near-identical copies |
| Entity card (list item) | **No** | 3+ copies |
| Table row | **No** | 4+ copies |
| Stat / metric tile | **No** | **15 implementations, 4 names** |
| Detail-page `Panel` | **No** | 5 copies |
| Detail-page `FieldRow` | **No** | 6 copies |
| Empty state | **No** | 23 files, ~6 visual variants |
| Entity detail header | **No** | 5 copies |
| Pagination | **No** | Inline in each list page |
| View switcher (Cards/Table) | **No** | 3 copies, 2 different active styles |
| Inline alert / banner | **No** | 17 copies of one class string |
| Form field | **No** | ~60 hand-wired blocks |
| Date / time / initials formatting | **No** | 22 / 27 / 17 local copies |

---

## 3. Inconsistency inventory

Ordered by user-visible impact.

### 3.1 The same data renders differently in card view vs table view

`PLAN_LABELS` is declared 5 times. In `membership-card-item.js` the `custom`
plan reads **"Custom"**; in `membership-table-row.js` and
`memberships/[id]/page.js` the same plan reads **"Custom duration"**.

`formatDate` is declared **22 times** with at least three different output
formats in active use:

- `{ month: "short", day: "numeric", year: "numeric" }` → `Sep 1, 2026`
  (membership **card**)
- `{ day: "2-digit", month: "short", year: "numeric" }` → `Sep 01, 2026`
  (membership **table row**, schedule table row)
- `{ weekday: "short", day: "2-digit", month: "short", year: "numeric" }`
  (schedule details)

Toggling Cards ⇄ Table on the same screen changes how dates are written.

`formatTime` is declared **27 times** and `getInitials` **17 times** — those
happen to agree today, which is luck, not design.

### 3.2 Fifteen implementations of one stat tile

| Name | Files |
|---|---|
| `MetricTile` | `batches/[id]/batch-header.js`, `schedule/[id]/schedule-header.js`, `attendance/[scheduleId]/[date]/session-header.js`, `attendance-history/[scheduleId]/[date]/page.js`, `memberships/[id]/page.js`, `students/[id]/page.js` |
| `SummaryTile` | `attendance/[scheduleId]/[date]/session-details-tabs.js`, `attendance-history/[scheduleId]/[date]/page.js`, `attendance-history/[scheduleId]/[date]/edit/page.js` |
| `ReportMetricCard` | `reports/student-attendance-results.js`, `reports/batch/batch-attendance-results.js`, `reports/summary/attendance-summary-results.js` |
| `StatTile` | `app/page.js` |
| `AttendanceStatTile` | `attendance/page.js` |
| `SummaryChip` | `attendance-history/history-session-card.js` |

They differ in fill (saturated gradient vs 10% tint), text color
(white vs `--text-primary`), radius (`rounded-xl` vs `rounded-2xl`), label
size, and icon treatment. `app/page.js`'s `StatTile` is the outlier: full
saturation + white text + decorative SVG wave.

### 3.3 Six copies of the filter bar

`student-filters.js` (326), `membership-filters.js` (367),
`batch-filters.js` (225), `schedule-filters.js` (335),
`attendance-filters.js` (369), `attendance-history-filters.js` (378)
— **2,000 lines** implementing one pattern six times: search form + Filters
button with count + applied-filter chips + right-side `Sheet` + Apply/Clear.

Meanwhile `reports/*` (3 files) and `settings/instructors/instructor-filters.js`
use a *different* pattern (inline `lg:flex-row` form, no drawer, no chips).
Two filter idioms coexist in one product.

### 3.4 Badge is overridden identically in 15 files

Every pill badge is written as:

```jsx
<Badge variant="success" className="rounded-full px-2 py-0">
  <span className="text-[10px] leading-[14px] font-medium">Active</span>
</Badge>
```

`text-[10px]` appears **68 times** application-wide. The `Badge` primitive's
own shape (`rounded-md`, `text-small`) is used by almost nobody — meaning the
primitive is wrong, not the callers.

### 3.5 Table rows: two different interaction treatments

- `student-table-row.js`: `bg-surface/40 hover:bg-surface/70`, `menuOpen` tint.
- `membership/batch/schedule-table-row.js`: `hover:bg-brand/5` + a duplicated
  `onFocusCapture`/`onBlurCapture` focus-tracking block (3 copies).

Additionally every `TableCell` restates `px-5 py-3.5`, which `TableCell`
already applies by default — dozens of redundant class strings.

### 3.6 Empty states: 23 files, ~6 variants

Varying across `rounded-card` / `rounded-xl` / `rounded-lg`, `bg-surface` /
`bg-background/40` / none, `gap-2` / `gap-4`, `py-8` / `py-10` / `py-16`,
`max-w-sm` / `max-w-md`, and with/without an icon.

### 3.7 View switcher: three implementations, two active states

- `students/student-list.js` (local `ViewToggle`): active = `bg-surface`, `text-small`.
- `schedule/schedule-view-toggle.js`: active = `bg-surface`, `text-body`.
- `attendance/attendance-view-toggle.js`: active = `bg-brand text-surface`.

The approved references (`02`, `03`, `14`, `16-…-final`) consistently show
**brand-filled active**. Two of the three are wrong.

### 3.8 Page title color

List pages (`PageHeader`) render `<h1>` in `text-text-primary`. All five
detail pages render `<h1>` in `text-brand`. The references show a dark title
in both cases.

### 3.9 Off-palette color

Raw Tailwind palette values in 4 files:
`reports/student-attendance-results.js:67`,
`reports/batch/batch-attendance-results.js:60`,
`reports/summary/attendance-summary-results.js:62`,
`attendance-history/history-session-card.js:52`
— `bg-purple-50`, `border-purple-200`, `text-purple-600`, `bg-purple-500`.

This violates `03-visual-tokens.md` §7 ("no raw hex/one-off colors when a
token applies") and the explicit "no purple-heavy UI" rule in `CLAUDE.md`.

### 3.10 Gradient usage vs the stated visual direction

`bg-gradient` appears in **13 files**. Two are structural:

- `DataTableShell` wraps *every* table and card grid in a tinted gradient
  panel with `backdrop-blur` (16 call sites).
- `app/page.js` `StatTile` uses saturated brand/info/warning/success gradients.

`03-visual-tokens.md` §6 lists "Decorative gradients" under **Avoid**, and the
approved references show tables and card grids on **plain white surfaces**.
`DataTableShell` is the single largest visual divergence from the references.

### 3.11 Primitives are not on the token scale

| Primitive | Current | Approved token / reference |
|---|---|---|
| `Button` default | `h-8` (32px), `text-sm` | Button type = 14/500/20; references show ~40px primary |
| `Input` | `h-8`, `rounded-lg`, `text-base md:text-sm` | Input radius = **6px**; references show ~44px |
| `Label` | `text-sm` | `text-body` |
| `Badge` | `rounded-md`, `text-small` | pill, ~10–12px |
| `Table` | `text-body` ✓ | ✓ |

Ten files override button/input heights inline to compensate.

---

## 4. Canonical pattern recommendations

One implementation per row. Everything else defers to it.

### 4.1 Foundation — fix the primitives first

| Pattern | Canonical decision |
|---|---|
| **Button** | Retune `buttonVariants`: sizes on the token scale (`sm` 32 / `default` 36 / `lg` 40–44), `text-button`, `rounded-button` (8px). Variants: `default` (brand fill), `outline` (brand text + border — the reference "Secondary"), `ghost`/`link` (reference "Tertiary"), `destructive` (danger tint → solid on hover, exactly as `00 Design System.png` §7). Remove all caller `h-*` overrides afterwards. |
| **Input / Textarea / Select trigger** | One control height, `rounded-input` (6px), `text-body`, token focus ring. Stop inheriting `text-base md:text-sm`. |
| **Label** | `text-body font-medium text-text-primary`. |
| **Badge** | Add the pill shape to the primitive (`rounded-full`, token-sized text) and add `warning` + `info` variants. Then delete the `rounded-full px-2 py-0` + `text-[10px]` override from all 15 files. |

### 4.2 New shared components (each replaces ≥3 copies)

| Component | Replaces | Location |
|---|---|---|
| `StatTile` | 15 implementations | `components/ui/stat-tile.js` |
| `FilterBar` (+ `FilterSheet`, `FilterChips`) | 6 copies / ~2,000 lines | `components/ui/filter-bar/` |
| `EmptyState` | 23 sites, 6 variants | `components/ui/empty-state.js` |
| `Pagination` | inline in 6 list pages | `components/ui/pagination.js` |
| `ViewSwitcher` | 3 copies | `components/ui/view-switcher.js` |
| `Tabs` (`variant="folder" \| "underline"`) | 5 copies of folder markup | `components/ui/tabs.js` |
| `Alert` (info/success/warning/danger) | 17 copies of the form-error div + in-card notices | `components/ui/alert.js` |
| `FormField` | ~60 hand-wired label/control/error blocks | `components/ui/form-field.js` |
| `Panel` (+ `PanelHeader`) | 5 copies | `components/layout/Panel.js` |
| `FieldRow` | 6 copies | `components/layout/FieldRow.js` |
| `EntityCard` | 3+ list card items | `components/ui/entity-card.js` |
| `EntityDetailHeader` | 5 detail headers | `components/layout/EntityDetailHeader.js` |
| `Avatar` (initials + optional photo) | 17 `getInitials` copies + inline markup | `components/ui/avatar.js` |
| `Breadcrumb` | reference-required, absent | `components/ui/breadcrumb.js` |
| `formatters` module | 22 `formatDate`, 27 `formatTime`, 17 `getInitials` | `lib/format.js` |
| `status` module | `*_LABELS` / `*_VARIANTS` maps duplicated 28× | `lib/status.js` |

`lib/format.js` and `lib/status.js` are **presentation** modules — they move
display strings, not business logic. No rule, query, or validation moves.

### 4.3 Tab rule (resolves an apparent reference conflict)

The references use **two** tab treatments, and they are not in conflict —
they mark two different things:

- **Folder tabs** (raised tab on a shelf) = *page-level section tabs*.
  References: `17 Reports…`, `18 Settings…`. Current implementation is
  **correct** in `report-tabs.js` and `settings-tabs.js`.
- **Underline tabs** (icon + label + brand underline) = *entity detail tabs*.
  References: `04 Student detail`, `07 Memberships detail`, `10 Batche detail`.
  Current implementation is **wrong** here — `batch-header.js`,
  `schedule-details-tabs.js` and `session-details-tabs.js` use folder chrome.

One `Tabs` component with two variants, and a documented rule for which
applies where.

### 4.4 Surface rule (resolves the biggest visual divergence)

Approved references render tables and card grids directly on `--surface` /
page background with a plain border. **Retire `DataTableShell`'s gradient +
`backdrop-blur` treatment** in favour of a plain `Card`/panel surface.

The references further show that on list pages the toolbar, the table and
the pagination row sit **inside one white panel** (`03 Students table view`,
`18 Settings instructor`), whereas card grids sit on the page background with
the toolbar above them (`02 Students card view`,
`16-attendance-history-…-final`). That distinction should be encoded once in
the list-page template, not decided per page.

---

## 5. Component strategy

### Reuse as-is
`AppShell`, `Container`, `Section`, `TabContentHeading`, `Skeleton`,
`Dialog`, `DropdownMenu`, `Sheet`, `Switch`, `Table*`.

### Refine (behaviour unchanged, visuals/tokens corrected)
`Button`, `Input`, `Textarea`, `Select`, `Label`, `Badge`, `ConfirmDialog`,
`PageHeader`, `ListPageSkeleton`, `Header`, `Sidebar`, `NavList`, `UserMenu`,
`AuthLayout`.

`ConfirmDialog` specifically: the references (`Warning.png`, `Error.png`,
`discard.png`, `00 Design System.png` §18) show a **centered tone-colored icon
circle, centered title and description, an optional inline tinted note, and
equal-width footer buttons**. Current implementation is left-aligned with a
right-aligned footer and no icon.

### Retire / replace
`DataTableShell` (gradient panel) → plain panel surface.

### Create
The 16 components listed in §4.2. Nothing beyond that list is needed — every
other reference element is a composition of these.

---

## 6. Page-by-page implementation map

References reviewed in full for this audit: `00 Design System`, `0 Login`,
`01 Dashboard`, `02`/`03` Students, `04 Student detail`,
`07 Memberships detail`, `10 Batche detail`, `11 schedule weekly`,
`14 Attendance today-session`, `16 Take attendance`,
`16-attendance-history-card-view-desktop-final`,
`17 Reports student attendance`, `18 Settings instructor`,
`18 Settings role and permission 1`, `19 Form-step1`, `19 Form-summary`,
`Error`, `Warning`. The remaining references (`05`, `06`, `08`, `09`, `12`,
`13`, `15`, `Informational`, `discard`) are variants of patterns already
covered and should be re-checked during implementation of their page.

---

### 6.1 Global shell — `components/global/*`

**Reference:** every screen. **Current:** correct structure, incomplete chrome.

Differences:
- Header has no global search input (references show one on every screen).
- No logo mark; `public/` contains only Next.js starter SVGs — **no approved
  logo asset exists in the repository**.
- Sidebar has no bottom promo/brand card.
- Header `h-12` vs sidebar header `h-16` — the two do not align; references
  show one continuous ~64px top band.
- Notification bell has no unread indicator.
- Off-token typography (`text-sm`/`text-xs`/`text-base`) in Header, Sidebar,
  NavList, UserMenu, MobileMenu.

Affects: `Header.js`, `Sidebar.js`, `NavList.js`, `UserMenu.js`, `MobileMenu.js`.

---

### 6.2 Authentication — `app/login`, `forgot-password`, `reset-password`

**Reference:** `0 Login.png`, `login.png`.

Differences: references show a **centered card on a soft botanical
background**; implementation is a **split brand panel + form** layout.

⚠️ `0 Login.png` carries the same conflicts `CLAUDE.md` already records for
`login.png`, plus a new one — see §9.1.

Affects: `components/auth/AuthLayout.js`, `app/login/*`.

---

### 6.3 Dashboard — `app/page.js` (457 lines)

**Reference:** `01 Dashboard.png`.

Differences:
- Reference KPI tiles are **light tinted** with dark values, a trend chip and
  a sparkline. Implementation uses **saturated gradients with white text**.
- Reference has a **two-column layout** with a right rail: Quick Actions,
  Today's Overview, promo card. Implementation is single-column.
- Reference has a greeting hero card with illustration + date card.
- Session rows differ in composition (batch-code tile, status badge placement).

Patterns required: `StatTile`, `Panel`, `EmptyState`, `Avatar`, `Alert`.
Affects: `app/page.js`, `dashboard-todays-classes.js`,
`dashboard-upcoming-classes.js`.
⚠️ Right-rail content has data implications — §9.2.

---

### 6.4 Students list — `app/students/page.js`

**Reference:** `02 Students card view.png`, `03 Studetns table view.png`.

Differences:
- Reference has a **4-tile KPI strip** above the toolbar. Not implemented.
- Reference puts search + Filters + Cards/Table toggle in **one toolbar row**;
  implementation splits the toggle into a second row inside `StudentList`.
- Reference card grid sits on the page background; implementation wraps it in
  `DataTableShell`'s gradient.
- Reference table view is one white panel containing toolbar, table and
  pagination; implementation uses three separate blocks.
- Reference cards show `ID: YC-000004`; implementation omits the student code
  in card view (it is present in the table).
- Reference table has a `JOINED` column; implementation does not.
- Reference pagination is `Previous | 1 | 2 | Next`; implementation is
  `Previous | Page 1 of 2 | Next`.
- Reference active view-toggle is brand-filled; implementation is surface.

Patterns required: `StatTile`, `FilterBar`, `ViewSwitcher`, `EntityCard`,
`Pagination`, `EmptyState`.
Affects: `page.js`, `student-list.js`, `student-filters.js`,
`student-card-item.js`, `student-table-row.js`.
⚠️ KPI strip, Sort-by and row selection — §9.2/§9.3.

---

### 6.5 Memberships, Batches, Schedule list pages

**References:** `05`–`06`, `08`–`09`, `12`–`13`.

Same deltas as §6.4 — these three are structurally identical to Students and
should be implemented from the same list-page template with no per-page
variation. Schedule additionally carries the Weekly/List switch.

Affects: `memberships/{page,membership-list,membership-filters,membership-card-item,membership-table-row}.js`,
`batches/{page,batch-list,batch-filters,batch-card-item,batch-table-row}.js`,
`schedule/{page,schedule-list,schedule-filters,schedule-card-item,schedule-table-row,schedule-view-toggle}.js`.

---

### 6.6 Entity detail pages — Students, Memberships, Batches, Schedule

**References:** `04`, `07`, `10`.

Differences:
- The references use **two header idioms**: Student detail uses
  `← Back to Students` with actions inside the header card; Membership and
  Batch detail use a **breadcrumb** with actions in a **top-right cluster**.
  A single canonical choice is needed (recommendation: breadcrumb + top-right
  actions, with the entity header card below).
- Tabs must be **underline**, not folder (§4.3).
- `<h1>` is dark in the references, `text-brand` in implementation.
- Stat tile strip under the header should be one shared `StatTile`.
- Membership detail shows a **Days Progress bar** — no `Progress` primitive
  exists.
- Panels/field rows must come from shared `Panel` / `FieldRow`.

Affects: `students/[id]/page.js` (531), `memberships/[id]/page.js` (508),
`batches/[id]/batch-header.js`, `batches/[id]/page.js` (301),
`schedule/[id]/schedule-header.js`, `schedule/[id]/schedule-details-tabs.js` (440).
⚠️ Some reference fields are outside the data model — §9.3.

---

### 6.7 Schedule — Weekly view

**Reference:** `11 schedule weekly.png`.

The implemented time grid (`weekly-schedule.js`, 317 lines) is structurally
**correct** — fixed 6 AM–10 PM axis, overlap handling, per-day columns.

Missing vs reference: right rail (mini month calendar, "This Week" stats,
batch legend), week-range navigator styling, per-batch color coding.
⚠️ Per-batch colors and Room/location — §9.3.

---

### 6.8 Attendance — `app/attendance/*`

**References:** `14 Attendance today-session.png`, `15`, `16Take attendance.png`.

Differences:
- Date navigator (`‹ Wed, Sep 16, 2026 ›` + `Today`) in the page header.
- Status sub-tabs with count chips (Upcoming / In Progress / Completed).
- Stat tiles with inline progress bars.
- Session card carries an inline tinted **Alert** ("No eligible students").
- Take Attendance screen: sticky footer action bar (Cancel / Save Attendance),
  session meta strip, per-student Present/Absent as **radio-style pills**
  (implementation uses toggle buttons — acceptable, but must be unified).

Patterns required: `StatTile`, `Alert`, `Tabs` (underline + count),
`FilterBar`, `ViewSwitcher`, `Pagination`, `EmptyState`.
Affects: `attendance/page.js` (298), `today-sessions-list.js` (347),
`all-sessions-list.js` (380), `attendance-filters.js`, `attendance-view-toggle.js`,
`[scheduleId]/[date]/{session-header,session-details-tabs,attendance-panel,eligible-students-list}.js`.
⚠️ Row selection, "Send notification to absent students", Location/Studio — §9.1/§9.3.

---

### 6.9 Attendance History — `app/attendance-history/*`

**Reference:** `16-attendance-history-card-view-desktop-final.png` (+ filter
sidebar variant).

Differences:
- Reference: **3-column card grid**, each card with a date tile, a **donut
  percentage ring**, and a `View Details →` link.
  Implementation: full-width single-column rows with four `SummaryChip`s.
- Reference toolbar: search + **date-range picker** + Filter + view toggle on
  the page background; applied chips + `Clear all` below.
- Implementation uses `bg-purple-*` raw palette (§3.9) and a fully pill-shaped
  `rounded-full` CTA (`03-visual-tokens.md` §6 avoids excessive pill UI).

Patterns required: `EntityCard`, `Progress`/donut, `FilterBar`, date-range
control, `Pagination`.
Affects: `history-session-card.js`, `history-list.js`,
`attendance-history-filters.js`, `admin-history-list.js`,
`instructor-history-list.js`, `[scheduleId]/[date]/*`.

---

### 6.10 Reports — `app/reports/*`

**Reference:** `17 Reports student addendance.png`.

Current implementation is **closest to its reference of any area** — folder
tabs are correct, filter row is correct, the KPI tiles are structurally right.

Differences: purple raw palette in the 4th tile (§3.9); tiles should be shared
`StatTile`; the three `ReportMetricCard` copies collapse into one; results
tables should lose the `DataTableShell` gradient; `Generate New Report` /
`Export CSV` / `Export Excel` button treatment should follow the canonical
Secondary/Tertiary variants.

Affects: `reports/page.js`, `report-tabs.js`,
`student-attendance-{filters,results}.js`, `batch/*`, `summary/*`,
`export-links.js`.

---

### 6.11 Settings — `app/settings/*`

**References:** `18 Settings center profile`, `18 Settings instructor`,
`18 Settings role and permission 1/2`.

Differences: folder tabs correct ✓. The Instructors filter row should adopt
the canonical `FilterBar`; the instructor table should use the shared table
panel; `Apply Filters` / `Clear` follow canonical button variants.

Roles & Permissions: the current read-only matrix derived from `NAV_ITEMS` is
**correct and must not be changed** — the reference for this screen is out of
product scope (§9.1).

Affects: `settings/settings-tabs.js`, `instructors/{page,instructor-list,instructor-filters,instructor-form}.js`,
`center-profile/*`, `roles-permissions/page.js`.

---

### 6.12 Forms and multi-step flows

**References:** `19 Form-step1/2/3` (screenshots of current state),
`19 Form-summary.png` (a designed success screen).

Current forms are **structurally consistent already** — `useActionState`,
`onBlur` validation, `aria-invalid` + `aria-describedby`, a form-level error
alert, and an identical
`mt-2 flex justify-end gap-3 border-t border-border pt-5` action row. This is
the healthiest pattern in the codebase.

Differences:
- ~60 field blocks are hand-wired; a `FormField` component removes the risk of
  a mis-wired `aria-describedby`.
- The 17 copies of the form-error div become `<Alert variant="danger">`.
- Control heights are too small vs the references.
- `19 Form-summary.png` shows a **completion screen** (success mark, entity
  summary card, three next-step actions) that does not exist yet.
- `guided-steps.js` should render completed steps as green checks, per the
  summary reference.

Affects: `student-form.js`, `batch-form.js`, `membership-form.js`,
`schedule-form.js`, `instructor-form.js`, `center-profile-form.js`,
`enrollment-form.js`, `session-form.js`, `guided-steps.js`, and the 4 auth forms.
⚠️ The `Error.png` reference changes error *behaviour* — §9.1.

---

## 7. Responsive strategy

### 7.1 Current state

Breakpoint usage: **`sm:` 406, `lg:` 57, `xl:` 6, `md:` 5.** The application
is effectively a two-state layout (narrow / wide) with a third state only for
the sidebar.

- Shell: sidebar appears at `lg` (1024px); below that `MobileMenu` (Sheet).
- Cards: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`.
- Tables: horizontal scroll only (`Table` wraps in `overflow-x-auto`). **No
  column hiding and no mobile card fallback anywhere.**
- Filter drawer: bottom sheet below `sm`, right drawer from `sm`.
- `02-ux.md` defines no responsive rules — "Responsive States" appears only as
  a step in the design sequence. **There is no approved responsive spec**; the
  rules below are a recommendation, not a recorded decision.

### 7.2 Recommended application-wide rules

| Breakpoint | Behaviour |
|---|---|
| `< 640` (base) | Single column. Cards 1-up. Tables → stacked card rows. Filter drawer = bottom sheet. Page header actions full-width, stacked. |
| `sm: 640` | Cards 2-up. Filter drawer = right side. Header actions inline. |
| `md: 768` | Tables become real tables; secondary columns may hide. |
| `lg: 1024` | Sidebar visible. Cards 3-up. Detail pages 2-column. Stat strips 4-up. |
| `xl: 1280` | Cards 4-up. Dashboard right rail appears. |

Rules that should be constant:
- Content gutter: `px-4 sm:px-6 lg:px-8` (already in `AppShell`) — never
  re-added by a page or by `Container`.
- Max width 1200px via `Container` — never overridden per page.
- Touch targets ≥ 40px at base width (today's `h-8` controls are 32px).
- Tables never scroll horizontally below `md` — they restack. This needs one
  shared responsive table wrapper so it is not re-decided per page.

---

## 8. UI implementation rules

These should apply automatically to every future page so they need not be
restated per task.

**Composition**
1. Every page: `PageHeader` → toolbar → content → pagination. No page invents
   its own header.
2. Never define a local `Panel`, `FieldRow`, `MetricTile`, `SummaryTile`,
   `EmptyState` or `ViewToggle`. Import the shared one.
3. Never re-implement `formatDate`, `formatTime`, `formatAmount` or
   `getInitials`. Import from `lib/format.js`.
4. Status labels and badge variants come from `lib/status.js`, never from a
   page-local map.

**Tokens**
5. Typography: only `text-page-title`, `text-section-title`, `text-body`,
   `text-small`, `text-button`. Never `text-sm`/`text-xs`/`text-base`, never
   `text-[Npx]`.
6. Color: only approved tokens (`brand`, `success`, `warning`, `danger`,
   `info`, `neutral`, `surface`, `background`, `border`, `text-*`). No raw
   Tailwind palette names, no hex.
7. Radius: `rounded-input` / `rounded-button` / `rounded-card`. `rounded-full`
   only for avatars and badges.
8. Shadows: `shadow-xs` / `shadow-sm` only, unless a reference clearly shows
   elevation.
9. No decorative gradients. The sidebar tint is the one approved exception and
   is defined once in `globals.css`.

**Primitives**
10. Never override a primitive's height, radius or text size at a call site.
    If the primitive is wrong, fix the primitive.
11. `TableCell`/`TableHead` already carry their padding — do not restate it.

**Interaction / accessibility**
12. Tabs: folder variant for page sections, underline variant for entity
    detail. Nothing else.
13. Active view switcher = brand fill.
14. Form fields via `FormField`; it owns `aria-invalid`, `aria-describedby`
    and `role="alert"` wiring.
15. Destructive confirmations use `ConfirmDialog` with the centered-icon
    treatment; never a bare `window.confirm` or an ad-hoc dialog.
16. Every list state (loading / empty / filtered-empty / error) is explicit and
    uses the shared component.
17. Focus states come from the global `:focus-visible` rule — never removed.

**Boundary**
18. A visual requirement that needs new data, a new column, a new query or new
    behaviour stops and gets raised. It is not implemented as part of a UI
    task.

---

## 9. Functional-change boundary

Everything below appears in an approved reference image but **must not be
implemented during this UI phase**.

### 9.1 Out of product scope — do not implement at all

| Item | Reference | Why |
|---|---|---|
| **Google Sign-In** | `0 Login.png`, `login.png` | `CLAUDE.md` "Do Not Invent Requirements" |
| **Admin / Instructor role selector on login** | `0 Login.png` | Role comes from the account, not user choice; this is an auth-behaviour change |
| **Custom roles** (Staff, Viewer, Manager, "Add Role", editable permissions) | `18 Settings role and permission 1/2` | `CLAUDE.md` forbids custom roles; `01-product.md` fixes V1 roles to Admin + Instructor. The current read-only matrix is correct |
| **"Send notification to absent students"** | `16Take attendance.png` | `01-product.md:767` lists Notifications as out of scope |
| **Location / Studio / Room** | `11`, `14`, `16` | `01-product.md:772` excludes multi-location; no such column exists |

### 9.2 Needs data-layer work — raise before implementing

| Item | Reference | Impact |
|---|---|---|
| List-page KPI strips (Total / Active / Inactive counts) | `02`, `03` | New count queries per list page |
| Dashboard "Today's Overview" rail | `01` | Aggregation query |
| Dashboard "Quick Actions" rail | `01` | Navigation only — safe, but it is new IA and needs UX approval |
| KPI trend chips (`↑ +2`, `83%`) and sparklines | `01`, `02` | Requires historical comparison data that does not exist |
| Sort-by control | `02`, `14`, `16-…-final` | New sort params through the data layer |
| Per-page size selector | `14` | New pagination param |
| Numbered pagination | all list references | Presentational only if total pages is already known — **verify** before treating as UI-only |
| Membership "Days Progress" | `07` | Derived value; confirm it is presentation, not a new rule |
| Attendance-rate donut | `16-…-final` | Value already available via `session_attendance_summaries` — likely UI-only, confirm |

### 9.3 Fields / behaviour outside the current data model

| Item | Reference | Status |
|---|---|---|
| Emergency Contact, Address on Student | `04` | Not in `01-product.md` §4 Student Information, not in `0006_students.sql` |
| Instructor "Specialization" | `18 Settings instructor` | Not in `0002_instructors.sql` |
| Row-selection checkboxes / bulk actions | `03`, `16Take attendance` | No bulk operations in V1 scope |
| Global header search | all references | Cross-entity search — new query surface |
| Per-batch schedule colors | `11` | No color field on batches |
| "Start Class" action | `11` | Not an approved action |
| Plan names "Monthly Unlimited" / "3 Months Plan" | `07` | Product plans are `monthly` / `quarterly` / `custom`; do not relabel |

### 9.4 UX-behaviour changes — need approval, not just implementation

- **`Error.png` / `Warning.png`** show server-side errors and destructive
  confirmations as **modals**. Today, form errors render as an **inline alert
  at the top of the form**. Moving from inline to modal error reporting is a
  UX behaviour change, not a visual refinement, and should be approved
  against `02-ux.md` before it is built. The *visual* treatment of the
  confirmation modal (§5) can be adopted independently and safely.
- **`19 Form-summary.png`** introduces a post-save success screen, changing
  the completion flow of Add Student. Needs UX approval.
- **Password visibility toggle** (`0 Login.png`) — small, but it is new
  functionality on an auth screen.

### 9.5 Source-of-truth conflict requiring a decision

`00 Design System.png` is priority 6; `03-visual-tokens.md` is priority 5. The
image states **different values** for tokens the document already fixes:

| Token | `03-visual-tokens.md` (authoritative) | `00 Design System.png` |
|---|---|---|
| Primary | `#0F8B87` | `#0F766E` |
| Background | `#F8FAFA` | `#F8FAFC` |
| Text Primary | `#1F2933` | `#111827` |
| Text Secondary | `#667085` | `#687280` |
| Success | `#22C55E` | `#10B981` |
| Radius (small) | Input 6px | 4px |
| Page title | 24 / 32 | H1 32 / 40 |
| Body line-height | 22 | 20 |
| Small line-height | 18 | 16 |

Per the hierarchy, **`03-visual-tokens.md` wins and `globals.css` is already
correct** — no change recommended. Two items still need an explicit decision:

1. The image introduces **Secondary `#14B8A6`** and **Accent `#F59E0B`** brand
   roles that have no equivalent token. Either add them to
   `03-visual-tokens.md` or confirm they are not used.
2. The references consistently render page titles **larger than 24px**. If the
   larger H1 is wanted, `03-visual-tokens.md` must be updated first — it should
   not be changed in code alone.

---

## 10. Recommended implementation order

Dependency-aware. Each phase is independently shippable and lint/build-verified.

**Phase A — Foundations (no page changes)**
1. `lib/format.js` + `lib/status.js`; migrate the 22/27/17 local copies.
2. Retune `Button`, `Input`, `Textarea`, `Select`, `Label`, `Badge` to tokens;
   remove caller overrides and the 68 `text-[10px]` instances.

*Why first:* touches every page indirectly; doing it later means redoing work.

**Phase B — Shared composition layer (no page changes)**
3. `StatTile`, `EmptyState`, `Alert`, `Panel`, `FieldRow`, `Avatar`.
4. `Tabs` (folder + underline), `ViewSwitcher`, `Pagination`, `Breadcrumb`.
5. `FilterBar` + `FilterSheet` + `FilterChips`.
6. `FormField`; refine `ConfirmDialog` to the reference treatment.

**Phase C — Shell**
7. Header / Sidebar / NavList / UserMenu: tokens, alignment, reference chrome
   (excluding global search — §9.3).

**Phase D — Establish the list-page template on one page**
8. Students list: retire `DataTableShell`'s gradient, adopt `FilterBar`,
   `ViewSwitcher`, `EntityCard`, `Pagination`, `EmptyState`, single-panel table
   layout. **Review and lock this before touching any other list page.**

**Phase E — Roll the locked template out**
9. Memberships → Batches → Schedule (list) → Attendance → Attendance History →
   Settings › Instructors.

**Phase F — Establish the detail-page template on one page**
10. Student detail: `EntityDetailHeader`, `Breadcrumb`, underline `Tabs`,
    `StatTile`, `Panel`, `FieldRow`. **Review and lock.**

**Phase G — Roll it out**
11. Membership detail → Batch detail → Schedule detail → Attendance session →
    Attendance History detail.

**Phase H — Remaining screens**
12. Forms + `guided-steps`; Reports; Settings › Center Profile; Auth screens;
    Dashboard (largest layout change, and the most gated by §9.2 — do it last).

**Phase I — Responsive pass**
13. Apply §7.2 across the app, in particular the shared responsive table
    behaviour.

**Ordering rationale:** phases A–B change no pixels but make every later phase
small; D and F are the two "lock the pattern" gates that prevent the
page-by-page redesign loop; the Dashboard is last because it depends on the
most unresolved items in §9.2.

---

## Summary

- **Foundations are good.** Tokens, shell, auth boundaries, data separation and
  feature-code token discipline are all sound. Lint is clean.
- **The gap is a missing composition layer.** ~15 stat tiles, 6 filter bars,
  23 empty states, 5 panels, 6 field rows, 5 detail headers and 3 view
  switchers are the same six patterns re-solved repeatedly.
- **Three visual divergences are systemic:** `DataTableShell`'s gradient wash
  on every table and card grid, saturated gradient KPI tiles on the Dashboard,
  and folder tabs used where the references show underline tabs.
- **Four rule violations to correct:** raw `purple-*` palette in 4 files,
  68 `text-[10px]` instances, primitives off the token scale, gradients in
  13 files.
- **Nothing in this report requires a functional change.** Everything that
  would is isolated in §9 and stops there pending approval.

**Highest-leverage first move:** Phase A + B. Roughly 16 shared components
replace an estimated 3,500+ lines of duplicated UI and make every subsequent
page task small and consistent by construction.
