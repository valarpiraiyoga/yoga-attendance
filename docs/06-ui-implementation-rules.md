# UI Implementation Rules

**The permanent UI implementation contract for the Yoga Center Attendance System.**

Status: **LOCKED.** These rules apply to every UI task from this point forward
and do not need to be restated per task.

Companion documents:
- `docs/05-ui-implementation-audit.md` — the evidence behind these rules. This
  document does not repeat that analysis.
- `docs/03-visual-tokens.md` — the authoritative token system. Unchanged by
  this document.

Scope: UI implementation only. See §25.

---

## 1. Source-of-truth hierarchy

When making any UI decision, resolve in this order:

1. Explicit user instruction
2. `docs/01-product.md`
3. `docs/02-ux.md`
4. Approved wireframe (`docs/wireframe/`)
5. `docs/03-visual-tokens.md`
6. **This document** (`06-ui-implementation-rules.md`)
7. `docs/ui-reference/` — visual appearance only
8. `docs/04-development-plan.md`
9. Existing project architecture
10. General framework conventions

Note the position of this document: it sits **above** the reference images and
**below** the tokens. Once a pattern is locked here, a reference image showing
a different treatment does not reopen it — §15 and §16 are the worked examples.

If sources conflict and this document does not resolve it, stop and ask. Do
not choose silently.

---

## 2. V1 product scope boundary

Reference images are **visual references only**. They never expand product
scope.

### Never implement (locked)

| Item | Appears in |
|---|---|
| Google Sign-In | `0 Login.png`, `login.png` |
| Login role selector (Admin / Instructor toggle) | `0 Login.png` |
| Custom roles, "Add Role", editable permissions | `18 Settings role and permission 1/2` |
| Absent-student notification | `16Take attendance.png` |
| Location / Studio / Room as functional data | `11`, `14`, `15`, `16` |

Roles & Permissions stays a **read-only matrix derived from `NAV_ITEMS`**.
Admin and Instructor remain the only roles.

### Rule

> If a reference image shows a control, field, column or action that has no
> basis in `01-product.md` / `02-ux.md` and no backing column in
> `supabase/migrations/`, it is **not implemented**. Render the approved
> information in the approved visual language instead. Record the gap in §25.5
> and move on.

Never invent a placeholder, a stub control, or a "coming soon" affordance to
fill a reference element that is out of scope.

---

## 3. Design tokens

`docs/03-visual-tokens.md` is authoritative. `app/globals.css` is already
aligned with it and is **correct as-is**. Do not retune it in a UI task.

### Locked values

```
Brand / Primary   #1E40AF      Brand / Secondary #06B6D4   Brand / Accent #5B21B6
Background        #F5F7FB      Surface   #FFFFFF
Text Primary      #1F2933      Text Secondary #667085  Border    #E4E7EC

Success #22C55E   Warning #F59E0B   Danger #EF4444   Info #3B82F6   Neutral #98A2B3

Radius   Input 6px  ·  Button 8px  ·  Card 12px
Shadows  none / xs / sm / md / lg / xl
```

### Rules

1. Use Tailwind token utilities only: `bg-brand`, `text-text-secondary`,
   `border-border`, `bg-success/10`, `rounded-card`, `shadow-xs`, etc.
2. **No raw Tailwind palette names.** `purple-*`, `emerald-*`, `slate-*`,
   `gray-*`, `red-*` and friends are forbidden. There are four such call sites
   today (audit §3.9) and they are corrected, not extended.
3. **No hex literals** in `app/` or `components/`.
4. **No arbitrary values** for color, size or spacing (`text-[10px]`,
   `bg-[#fff]`, `p-[13px]`). The only permitted arbitrary values are layout
   geometry that has no token (e.g. `max-w-[1200px]` in `Container`, the
   weekly-grid pixel math in `weekly-schedule.js`).
5. **No decorative gradients.** The sidebar tint (`.sidebar-surface`, defined
   once in `globals.css`) and the detail-page hero card (`EntityDetailHeader`:
   a soft `brand`/`info` gradient with faint circles and rings, tokens only,
   pinned to the top on scroll from `sm`) are the two approved exceptions. Do
   not add a third. `DataTableShell`'s gradient and the Dashboard's saturated
   `StatTile` gradients are retired (§8, §9).
6. Shadows: `shadow-xs` and `shadow-sm` only. Anything heavier requires a
   reference that clearly shows elevation.
7. Color budget: ~70–80% neutral, ~15–20% brand, semantic colors in small
   amounts. Semantic tokens carry **meaning**, never decoration — an `info`
   tint means "informational", not "this panel should be blue".
8. New token needed? Do not add it in code. Document the case, update
   `03-visual-tokens.md` first, then use it.

### Open token questions (do not act on these)

- `00 Design System.png` introduces Secondary `#14B8A6` and Accent `#F59E0B`
  brand roles with no token equivalent. Unresolved — see §26 of the audit and
  §29 below.
- The references render page titles larger than the documented 24px.
  **The documented Page Title / H1 scale is not changed in this phase.**

---

## 4. Typography

Inter only. One scale, defined in `globals.css`:

| Utility | Size / line-height | Use |
|---|---|---|
| `text-page-title` | 24 / 32 | The page's single `<h1>` |
| `text-section-title` | 18 / 28 | Major section heading |
| `text-body` | 14 / 22 | Default body, table cells, labels, inputs |
| `text-small` | 12 / 18 | Captions, meta, helper text, badges, table headers |
| `text-button` | 14 / 20 | Button and tab labels |

### Rules

1. **Never** use `text-xs`, `text-sm`, `text-base`, `text-lg`, `text-xl`,
   `text-2xl`, or `text-[Npx]`. Feature code is already clean; the 17
   remaining violations are in `components/ui/*` and `components/global/*`
   and are corrected at the primitive (§22).
2. Weight via `font-normal` / `font-medium` / `font-semibold`. No `font-bold`
   unless a reference clearly shows it.
3. Exactly one `<h1>` per page, rendered by `PageHeader`.
4. Page and entity titles are **`text-text-primary`**, never `text-brand`.
   The five detail pages currently using `text-brand` are corrected.
5. Uppercase micro-labels (stat tile labels, table headers) use
   `text-small font-medium tracking-wide uppercase text-text-secondary`.
6. Truncation: `truncate` + a `title` attribute carrying the full value.

---

## 5. Spacing

Scale: `4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48` (Tailwind `1 2 3 4 5 6 8 10 12`).

### Locked layout spacing

| Context | Value |
|---|---|
| Page gutter | `px-4 sm:px-6 lg:px-8` — owned by `AppShell`'s `<main>` **only** |
| Page max width | `1200px` — owned by `Container` **only** |
| Page header → first block | `mb-6` (24) |
| Between page sections | `mb-8` (32), via `Section` |
| Card / panel padding | `p-4 sm:p-5` |
| Card grid gap | `gap-4` |
| Form field stack | `gap-2` inside a field, `gap-5` between fields |
| Toolbar internals | `gap-3` |

### Rules

1. A page never re-adds the horizontal gutter or its own max-width.
2. No `gap-[Npx]`, `p-[Npx]`, `m-[Npx]`.
3. Half-steps (`p-3.5`, `py-2.5`) are permitted only where they already exist
   inside a shared primitive (e.g. `TableCell`); do not introduce new ones at
   page level.

---

## 6. Buttons

One `Button` primitive (`components/ui/button.jsx`). Four semantic variants,
per `00 Design System.png` §7.

| Variant | Appearance | Use |
|---|---|---|
| `default` | Brand fill, surface text | The one primary action per view |
| `outline` | Border + brand text on surface | Secondary actions ("View Details", "Clear", "Cancel") |
| `ghost` | No chrome until hover | Icon buttons, low-emphasis row actions, tertiary "Edit" |
| `destructive` | Danger tint → solid danger on hover | Delete / Discard / Cancel-membership |

`link` remains for inline text links only.

### Sizes (4px scale)

| Size | Height | Use |
|---|---|---|
| `sm` | 32 | Table row actions, compact toolbars, pagination |
| `default` | 36 | Standard page and form actions |
| `lg` | 40 | Hero/primary CTA where a reference shows a taller button |
| `icon-sm` / `icon` / `icon-lg` | 32 / 36 / 40 square | Icon-only |

### Rules

1. **Never override a button's height, radius or text size at a call site.**
   The 10 existing `h-9` / `h-10` overrides are removed when the primitive is
   retuned. If a size is missing, add it to the primitive.
2. Radius is always `rounded-button` (8px). **No pill-shaped buttons** —
   `rounded-full` on a button is forbidden (`03-visual-tokens.md` §6).
3. Icon-only buttons **must** have `aria-label`. Icons are `aria-hidden`.
4. Leading icon size `size-4`; the primitive already enforces this.
5. Exactly one `default`-variant button per view region. Two primaries in one
   toolbar is a design error.
6. Pending state: `disabled={isPending}` + a pending label (`"Saving…"`).
   Never a spinner-only button.
7. A button that navigates renders a `Link`
   (`render={<Link href=… />} nativeButton={false}`) — never `onClick` +
   `router.push`.

---

## 7. Inputs and forms

### Controls

| Control | Height | Radius | Text |
|---|---|---|---|
| `Input`, `Select` trigger, native date input | 40 | `rounded-input` (6px) | `text-body` |
| `Textarea` | auto, min 80 | `rounded-input` | `text-body` |
| `Switch` | as primitive | — | — |

Focus ring comes from the global `:focus-visible` rule plus the primitive's
`focus-visible:ring-ring/50`. Never removed, never restyled per page.

### `FormField` is mandatory

Every labelled control is rendered by `FormField` (§22). It owns:

- the `<Label htmlFor>` / control `id` pairing,
- `aria-invalid`,
- `aria-describedby` → error id and/or help-text id,
- the error `<p role="alert" className="text-small text-danger">`,
- the required marker,
- optional help text below the control.

No page hand-wires these again. There are ~60 hand-wired blocks today; they
migrate to `FormField` as their page is implemented, not in a sweep.

### Form structure (locked — already correct, do not change)

```
<form action={formAction} onBlur={handleBlur} className="flex flex-col gap-5" noValidate>
  {state?.error ? <Alert variant="danger">{state.error}</Alert> : null}
  … FormField × n …
  <FormActions>            // mt-2 flex justify-end gap-3 border-t border-border pt-5
    <Button variant="outline" render={<Link href={cancelHref} />} nativeButton={false}>Cancel</Button>
    <Button type="submit" disabled={isPending}>{isPending ? pendingLabel : submitLabel}</Button>
  </FormActions>
</form>
```

### Rules

1. **Validation behaviour is unchanged.** `useActionState` + `onBlur` field
   validation + inline field errors + a form-level `Alert` at the top of the
   form. This is existing product behaviour and is preserved exactly (§12).
2. Two-column field grids use `grid gap-4 sm:grid-cols-2`; full-width fields
   (Notes, Address, Description) span both columns.
3. Optional fields say so in the placeholder or help text, matching the
   existing copy convention (`"Enter email address (optional)"`).
4. Multi-step flows use `GuidedSteps`; completed steps render a check, current
   step renders the brand-filled number, future steps render neutral
   (`19 Form-summary.png`).
5. Never a native `alert()`, `confirm()` or `prompt()`.

---

## 8. Cards

Two card roles. Nothing else is a "card".

### 8.1 `Panel` — a content container

A bordered surface holding a section of a page.

```
rounded-card border border-border bg-surface p-4 shadow-xs sm:p-5
```

Optional `PanelHeader`: icon tile + title (+ description) on the left, one
action on the right. This replaces the five local `Panel` definitions.

### 8.2 `EntityCard` — a list item

Used in every card-view grid (Students, Memberships, Batches, Schedule,
Attendance, Attendance History).

```
Avatar / code tile  ·  Title  ·  Status badge  ·  Actions (eye + kebab)
──────────────────────────────────────────────────────────────────────
Icon + label meta rows (3–5)
[ optional footer: progress bar, "View Details →" ]
```

```
flex h-full flex-col gap-3 rounded-card border border-border bg-surface p-4 shadow-sm
```

### Rules

1. Card grids sit **directly on the page background**, wrapped only by the
   grid element — `grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`.
   **No gradient panel, no `backdrop-blur`.** `DataTableShell` is retired.
2. All cards in a grid are equal height: `h-full` + `items-stretch`.
3. Meta rows: `size-3.5` icon, `text-small text-text-secondary`, emphasised
   value in `font-medium text-text-primary`.
4. A card has **one** primary affordance. Multiple competing CTAs inside a
   card are a design error.
5. State tinting (e.g. an expired membership card) uses a semantic token at
   ≤10% (`bg-danger/5 border-danger/20`) — never a saturated fill.

---

## 9. Tables

One `Table` primitive family. One wrapper.

### Rules

1. Tables render inside a `Panel` — bordered white surface, no gradient, no
   blur.
2. On a list page, **the toolbar, the table and the pagination footer sit
   inside one `Panel`** (references `03`, `06`, `09`, `13`, `15`,
   `18 Settings instructor`). Card views instead put the toolbar above a grid
   on the page background (references `02`, `05`, `08`, `12`, `16-…-final`).
3. `TableHead` is `text-small font-medium tracking-wide uppercase
   text-text-secondary` — already the primitive default.
4. `TableCell` and `TableHead` already carry `px-5 py-3.5`. **Never restate
   padding at a call site.** Pass only semantic classes
   (`text-right tabular-nums`, `max-w-xs truncate`).
5. Row hover is **one** treatment: `hover:bg-brand/5`, from the `TableRow`
   primitive. Do not add a second hover style. The duplicated
   `onFocusCapture`/`onBlurCapture` row-focus blocks are removed — row focus
   is handled once inside the shared row wrapper or not at all.
6. Header rows opt out of hover with `className="hover:bg-transparent"`.
7. Identity cell: `Avatar` + name (`font-semibold text-text-primary`) + code
   (`text-small text-text-secondary`) stacked. One pattern everywhere.
8. Numeric columns: `text-right tabular-nums`.
9. Action column last, `ghost` icon buttons, `aria-label` per action.
10. Every table has an `aria-label`.
11. Row-selection checkboxes are **not implemented** (§2 — no bulk operations
    in V1).

---

## 10. Status badges

One `Badge` primitive. Pill shape lives **in the primitive**, not at call
sites.

| Variant | Meaning |
|---|---|
| `success` | Active, Present, Paid, Completed |
| `warning` | Pending, Upcoming, Expiring Soon |
| `danger` | Inactive, Absent, Cancelled, Expired-as-problem |
| `info` | Informational / In Progress |
| `neutral` | None, Not taken, Holiday, Draft, de-emphasised |
| `outline` | Batch codes and other non-status chips |

### Rules

1. **Never** write `<Badge className="rounded-full px-2 py-0"><span className="text-[10px]">…</span></Badge>`.
   The primitive provides pill shape and `text-small`. All 15 current call
   sites are corrected as their page is implemented.
2. Label text and variant come from **`lib/status.js`** (§21), never from a
   page-local `*_LABELS` / `*_VARIANTS` map. The 28 local maps are removed.
3. A status name never gets a new color. Map it to an existing semantic token
   (`03-visual-tokens.md` §7).
4. Badges are non-interactive. A removable filter chip is **not** a Badge —
   see §16.

---

## 11. Alerts

One `Alert` component, four tones: `info` · `success` · `warning` · `danger`.

```
flex items-start gap-3 rounded-card border p-3
border-<tone>/20  bg-<tone>/5  ·  icon in <tone>  ·  text in text-primary/secondary
```

Optional: `title`, dismiss button (`15 Attendance all sessions.png`).

### Uses

- Form-level submission errors (replaces the 17 copies of the
  `border-danger/30 bg-danger/5` div — same behaviour, same position).
- In-card notices ("No eligible students" — `14`).
- Page-level informational banners (`15`).
- Help/guidance panels (`17 … help.png`, `18 Settings center profile.png`).
- Inline note inside a dialog (§12).

### Rules

1. Alerts never carry a primary action. If a decision is needed, it is a
   dialog (§12).
2. `role="alert"` **only** for errors that appear in response to a user
   action. Static informational banners are plain content.
3. Never use an Alert as decoration or as a section header.

---

## 12. Confirmation and discard dialogs

One `ConfirmDialog`, refined to the approved visual treatment
(`Warning.png`, `Error.png`, `discard.png`, `Informational.png`,
`00 Design System.png` §18).

### Anatomy (locked)

```
                [ × ]
        ◯  tone-colored icon circle          (size-14, bg-<tone>/10, icon <tone>)
         Title — centered, text-section-title font-semibold
      Description — centered, text-body text-text-secondary
   [ optional inline Alert note, tone-matched ]        e.g. "This action cannot be undone."
   ─────────────────────────────────────────────
   [ Cancel  ][ Confirm ]     two equal-width buttons
```

| Tone | Icon | Confirm button | Example |
|---|---|---|---|
| `warning` | `AlertTriangle` | `default` | "Change Enrollment Dates?" |
| `danger` | `Trash2` / `X` | `destructive` | "Discard changes?", Deactivate |
| `info` | `Info` | `default`, single button | Acknowledgement |
| `success` | `Check` | `default`, single button | Completion |

Single-button dialogs right-align the one button. Two-button dialogs use
equal-width buttons, Cancel on the left.

### Rules

1. **Visual treatment only.** Where a dialog is already used
   (deactivate student, cancel membership, review-before-save), it adopts this
   treatment. Where inline validation is used today, it **stays inline** —
   `Error.png` does not convert form validation into a modal.
2. Cancel is always safe and always first. The destructive action is never the
   default focus.
3. Escape and overlay click close the dialog; focus returns to the trigger.
   The `Dialog` primitive already handles this — do not re-implement.
4. Confirm label is a verb matching the action ("Discard Changes",
   "Deactivate Student"), never "OK" — except for single-button
   acknowledgements, where "OK" is correct.
5. A discard guard is only added where the flow already has one. Adding
   unsaved-changes detection to a form that lacks it is a behaviour change
   (§25).

---

## 13. Empty states

One `EmptyState` component. Replaces 23 sites and ~6 variants.

```
◯ icon circle (size-12, bg-background, text-text-secondary)
Title            text-body font-medium text-text-primary
Description      text-small max-w-sm text-text-secondary
[ optional action Button ]
```

```
flex flex-col items-center gap-3 rounded-card border border-dashed border-border
bg-surface px-6 py-16 text-center
```

`size="sm"` (`py-8`, no icon) for empty states nested inside a `Panel`.

### The four list states (all four are mandatory on every list page)

| State | Content |
|---|---|
| **Empty** (no records at all) | "No students yet." + primary action ("Add Student") |
| **Filtered empty** | "No students match your search or filters." + `outline` "Clear Filters" |
| **Loading** | `ListPageSkeleton` (§ loading below) |
| **Error** | Handled by the route's `error.js` / server action error → `Alert` |

### Rules

1. Empty and filtered-empty are always distinguished. Never one generic
   message.
2. The empty-state action mirrors the page header's primary action.
3. Never render an empty table with zero rows. Replace the table with the
   empty state.

### Loading states

- List pages: `ListPageSkeleton` via `loading.js`.
- Streamed sections: `<Suspense>` + a skeleton that **matches the real
  content's shape** so swap-in is not a layout jump.
- Skeleton blocks: `Skeleton` primitive only (`animate-pulse bg-neutral/15`).
- Vary skeleton widths deliberately — uniform bars read as a broken table.
- `role="status"` + `aria-busy` on the boundary, **once**, never per block.

---

## 14. Page headers

`PageHeader` is the only way a page renders its title. No exceptions.

A compact strip (global shell refinement — supersedes the earlier large
header with an icon tile and a 24px title):

```
H1 title                           [ actions ]
description
──────────────────────────────────────────────
```

- No icon tile. `PageHeader` still accepts `icon` so call sites do not break,
  but does not render it.
- Title: `text-section-title font-semibold text-text-primary` (18px).
- Description: `text-body text-text-secondary` (14px), one line of purpose.
- Actions: right-aligned on `sm+`, stacked below on mobile. At most one
  `default` variant.
- A hairline `border-b border-border/70` closes the strip; `pb-4`.
- Spacing to the next block: `mb-6`.
- Only title, description and actions live in the strip. Hero/profile cards,
  KPIs and tabs are page content and never go inside it.
- The top `Header` bar exists only below `lg` (hamburger + app name). From `lg`
  the profile / notifications / help / logout row lives at the bottom of the
  Sidebar (`UtilityRow`), which the mobile navigation sheet reuses.

**Contextual header slot.** Some pages carry a control in the header row
rather than an action button — Attendance's date navigator (`14`, `15`).
That goes in `actions`. It does not justify a new header component.

`TabContentHeading` is retained for the heading **inside** a tab panel
(Reports and Settings tab bodies) — smaller icon tile, `h2`.

Back navigation on sub-pages is `Breadcrumb` (§19), not an ad-hoc link.

---

## 15. Canonical tabs — underline only

> **Underline tabs are the only tab pattern in this application.**
> Folder tabs are removed. There is no page-level vs detail-level distinction.

### 15.1 The component

`components/ui/tabs.js` — one component, used by Reports, Settings, Student
detail, Membership detail, Batch detail, Schedule detail, Attendance session
detail, and every future tabbed surface.

```
<nav aria-label="…">
  <ul role="tablist"> … </ul>          border-b border-border, flex, gap-6, overflow-x-auto
</nav>
<div>{panel}</div>
```

**Tab item**

| State | Treatment |
|---|---|
| Default | `text-body text-text-secondary`, `size-4` icon optional, 2px transparent bottom border |
| Hover | `text-text-primary` |
| Active | `text-brand font-semibold`, **2px `border-brand` bottom border**, icon inherits `text-brand` |
| Disabled | `text-text-secondary/50`, `aria-disabled`, `cursor-not-allowed` |

Padding `px-1 pb-3`, gap between tabs `gap-6`. The underline sits on the
shared `border-b border-border` rule, so active and inactive share one
baseline.

**Optional count chip** (`14 Attendance today-session.png`): a `neutral` Badge
after the label; the active tab's chip is `default` (brand tint).

### 15.2 Props and variants

| Prop | Values | Purpose |
|---|---|---|
| `size` | `default` \| `sm` | `sm` for tabs nested inside a panel (smaller type, `gap-4`, `pb-2`). **Scale only — not a different pattern.** |
| `as` | `link` \| `button` | `link` when tabs are routes (Reports, Settings); `button` when they are local state (detail tabs). Identical visuals. |

No other variants. No page-specific tab styling. Ever.

### 15.3 Accessibility

- Route-based tabs: `<Link>` + `aria-current="page"` inside a `<nav>`.
- State-based tabs: `role="tablist"` / `role="tab"` / `aria-selected` /
  `aria-controls`, panel `role="tabpanel"`, arrow-key roving focus.
- Tab labels are plain text — never truncated. Overflow scrolls horizontally.

### 15.4 Cross-check — every tab occurrence in `docs/ui-reference/`

All 35 reference files inspected. Tabs appear in 11:

| Reference | Tab set | Reference treatment | Decision |
|---|---|---|---|
| `00 Design System.png` §13 | Overview · Students · Schedules · Settings | **Underline** | Matches canonical ✓ |
| `04 Student detail.png` | Overview · Enrollments · Memberships · Attendance · Notes | **Underline + icons** | Matches canonical ✓ |
| `07 Memberships detail view.png` | Batch Enrollments · Membership History | **Underline + icons** | Matches canonical ✓ |
| `10 Batche detail.png` | Overview · Schedule · Students · Attendance | **Underline + icons** | Matches canonical ✓ |
| `12 schedule list card view.png` | Weekly Schedule · List View | **Underline** | Matches canonical ✓ — implementation currently uses a segmented control and is normalized to tabs (§15.5) |
| `14 Attendance today-session.png` | Upcoming · Ongoing · Completed | **Underline + count chips** | Matches canonical ✓ |
| `17 Reports student addendance.png` | Student · Batch · Attendance Summary | Folder shelf **+ underline on the active label** | Normalize → underline; drop the shelf |
| `17 Reports … help.png` | same | Folder **+ underline on active label** | Same |
| `18 Settings center profile.png` | Center Profile · Instructors · Roles & Permissions | Folder **+ underline on active label** | Same |
| `18 Settings instructor.png` | same | Folder **+ underline on active label** | Same |
| `18 Settings role and permission 1/2.png` | Page tabs (folder) **and** Permissions · Assigned Users · Role Info (**underline**, nested in a panel) | Mixed | Page tabs → underline; nested panel tabs → underline `size="sm"` |

**Finding:** in every folder-tab reference the active tab already carries a
**teal underline beneath its label**. Normalizing removes the shelf chrome and
keeps the active marker the references themselves use.

**Nature of the difference:** visual only. Tab count, tab labels, tab order,
routes, URL parameters and the content of each panel are unchanged in all 11
cases. **No information-architecture change is implied by this normalization.**

One IA-adjacent note, recorded and **not** acted on: `13 schedule table
view.png` shows the Schedule page with **no** Weekly/List tabs and inline
dropdown filters. It is superseded by `12 schedule list card view.png` (later
timestamp; a `12 … -old.png` also exists). `12` is the governing reference for
Schedule's toolbar and tabs; `13` still governs the Schedule table's columns.

### 15.5 Migration

`.folder-tabs-track` and `.folder-tab-active` are deleted from
`app/globals.css` once these five files adopt `Tabs`:

- `app/reports/report-tabs.js`
- `app/settings/settings-tabs.js`
- `app/batches/[id]/batch-header.js`
- `app/schedule/[id]/schedule-details-tabs.js`
- `app/attendance/[scheduleId]/[date]/session-details-tabs.js`

Plus `app/schedule/schedule-view-toggle.js`, which becomes underline `Tabs`
(Weekly Schedule / List View) per reference `12`.

---

## 16. Filters, search and view switchers

### 16.1 Toolbar composition (locked)

```
[ 🔍 search input …………………… ]  [ ⚙ Filters (n) ]  [ Cards | Table ]
[ Applied filters: chip × chip × ]  Clear all
[ N Results ]                                             [ Sort by ⌄ ]
```

- Card views: toolbar sits on the page background above the grid.
- Table views: toolbar is the first row **inside** the list `Panel`.

### 16.2 Search

One `SearchInput`: leading `Search` icon, `sr-only` label, and — when the
caller passes `onClear` — an X "Clear search" button inside the field on the
right while it has text. Search is **live**: on the URL-driven list pages
`useLiveSearch` (`components/ui/use-live-search.js`) writes `q` to the URL on
every keystroke (history entry replaced, `page` reset, other params kept) and
the server re-runs the same list query; the filters component's page key must
not include `q`. The X clears only the search text, keeps the filters and keeps
focus in the field. Search is **independent of the filter drawer**.

### 16.3 Filters

One `FilterBar` + `FilterSheet` + `FilterChips`, replacing six near-identical
implementations (~2,000 lines).

- Trigger: `outline` Button, `SlidersHorizontal` icon, label "Filters", plus
  a brand count pill when filters are applied.
- Panel: right `Sheet` on `sm+`, bottom sheet below `sm`. Header
  "Filters" + description + close. Grouped, labelled sections. Footer:
  `Clear All` (outline) + `Apply Filters` (primary), equal width.
- Section labels: `text-small font-medium text-text-primary` in sentence case
  (`16-…-filter-sidebar-final.png`).
- Applied chips: brand-tinted removable pills with an `×`, prefixed
  `Active filters:`, followed by a `Clear all` text button. A chip is **not**
  a `Badge` — it is interactive.
- All filter state lives in the URL. No client-only filter state.

**Deviation recorded:** `08 Batches card view.png` and `13 schedule table
view.png` show inline dropdown filters instead of the drawer. The drawer is
canonical — it is used by the majority of references and by all of the latest
ones. Batches, Schedule and Settings › Instructors normalize to the drawer.
Visual only; the same URL parameters are written.

### 16.4 View switcher — distinct from tabs

`ViewSwitcher` is a **segmented control**, not a tab bar:

```
inline-flex gap-1 rounded-lg border border-border bg-background/60 p-1
active:   bg-brand text-surface font-semibold shadow-sm
inactive: text-text-secondary hover:text-text-primary
```

**Rule for choosing between them:**

> **Tabs (underline)** switch between named *sections* — different content.
> **ViewSwitcher (brand-filled segments)** switches the *presentation* of one
> result set — same content, different rendering.

Cards ⇄ Table is always a `ViewSwitcher`. Every other switch in this app is
tabs, with one recorded exception below.

Two of the three current view toggles use a surface-filled active state; all
three normalize to **brand-filled** (references `02`, `03`, `05`, `06`, `08`,
`09`, `12`, `14`, `15`, `16-…-final` are unanimous).

**Recorded exception — Attendance "Today's Sessions / All Sessions".**
References `14` and `15` draw this as a brand-filled segmented control, not as
tabs. It is therefore **kept as a `ViewSwitcher`**, matching its own approved
reference rather than being reclassified. See §29 for the open decision.

### 16.5 Sort

`Sort by` is a labelled `Select` on the right of the results row. It is **not
implemented in this phase** — it requires a new data-layer parameter (§25.5).
The layout reserves its position so adding it later is not a re-layout.

---

## 17. Pagination

One `Pagination` component. Replaces the inline implementation in six list
pages.

```
Showing 1–10 of 12 students                    [ ‹ ][ 1 ][ 2 ][ › ]
```

- Left: `text-small text-text-secondary` range summary.
- Right: numbered page buttons; active page is `default` (brand fill),
  others `outline`, prev/next are `icon-sm` `outline`.
- Truncation with `…` beyond 7 pages (`15 Attendance all sessions.png`).
- Disabled prev/next render as disabled buttons, never as removed elements.
- Wrapped in `<nav aria-label="… pagination">`; the active page carries
  `aria-current="page"`.
- Below `sm`: range summary stacks above the controls.
- `Previous` / `Next` labels are hidden below `sm`, icons only.

**Per-page selector** (`14`, `12`, `15`) is **not implemented** — new
pagination parameter (§25.5). Numbered pages are presentational: `totalPages`
is already computed on every list page.

---

## 18. List-page composition

Every list page is assembled from shared parts in this exact order. A list
page should contain almost no bespoke layout.

```jsx
<PageHeader title description icon actions={<Button>Add …</Button>} />

{/* Optional — only when the counts already exist. See §25.5 */}
<StatTileGroup> <StatTile …/> ×4 </StatTileGroup>

<ListToolbar
  search={<SearchInput …/>}
  filters={<FilterBar …/>}
  view={<ViewSwitcher …/>}
/>
<FilterChips … />

<ResultsHeader count={total} label="Students" view={view} />

{isEmpty
  ? <EmptyState variant={isFiltered ? "filtered" : "empty"} … />
  : view === "table"
    ? <Panel><Table …/><Pagination …/></Panel>
    : <><CardGrid>{items.map(i => <EntityCard key={i.id} …/>)}</CardGrid><Pagination …/></>}
```

### Rules

1. The order above is fixed. A page does not reorder or omit parts.
2. `loading.js` renders `ListPageSkeleton` with that page's column/filter
   counts.
3. Pagination lives **inside** the `Panel` in table view and **below** the
   grid in card view (§9.2).
4. All list state is URL-driven: `q`, `status`, `page`, `view`, plus
   page-specific filters. No client-only list state.

---

## 19. Entity-detail-page composition

```jsx
<Breadcrumb items={[{label:"Memberships", href:"/memberships"}, {label:code}]} />
<DetailActions>                     {/* top-right cluster */}
  <Button variant="outline">Edit</Button>
  <Button variant="destructive">Cancel</Button>
</DetailActions>

<EntityDetailHeader
  avatar={<Avatar …/>} title={name} status={<Badge …/>}
  meta={[…]} highlight={<…/>} />

<StatTileGroup> <StatTile …/> ×4 </StatTileGroup>

<Tabs items={…} active={…}>
  <div className="grid gap-4 lg:grid-cols-2">
    <Panel title="…" icon={…}> <FieldRow …/> ×n </Panel>
    …
  </div>
</Tabs>
```

### Locked decisions

1. **Breadcrumb + top-right action cluster** is canonical for all detail
   pages. The references use two idioms — a back-link with in-card actions
   (`04`) and a breadcrumb with top-right actions (`07`, `10`). Breadcrumb
   wins: it scales to nested routes and keeps the header card purely
   informational. The five current `← Back to X` links are replaced.
2. `EntityDetailHeader` has three zones: identity (avatar, title, status,
   sub-meta) · meta list (icon + label + value pairs) · optional highlight
   (a single emphasised figure or progress). One component, five uses.
3. Entity title is `text-page-title font-semibold text-text-primary` — not
   `text-brand`.
4. Tabs are underline (§15).
5. Panel content is a 2-column grid on `lg+`, single column below.
6. `FieldRow` = `size-3.5` icon + `text-small text-text-secondary` label above
   a `text-body font-semibold text-text-primary` value. One component, six
   uses.
7. Related-entity sub-cards inside a panel use a semantic tint at ≤10% with a
   matching ≤20% border, and end with a `View X →` `ghost`/`link` action.

---

## 20. Responsive behaviour

`02-ux.md` defines no responsive specification. These rules are therefore
established **here** and become the responsive contract.

| Breakpoint | Behaviour |
|---|---|
| base (< 640) | Single column. Cards 1-up. **Tables restack as rows.** Filter panel = bottom sheet. Header actions stack full-width. Pagination stacks. |
| `sm` (640) | Cards 2-up. Filter panel = right drawer. Header actions inline. Prev/Next labels appear. |
| `md` (768) | Real tables. Low-priority columns may hide. |
| `lg` (1024) | Sidebar visible. Cards 3-up. Detail panels 2-column. Stat tiles 4-up. |
| `xl` (1280) | Cards 4-up. Dashboard right rail. |

### Rules

1. **Tables never scroll horizontally below `md`.** They restack into labelled
   rows. This is implemented **once**, in the shared table wrapper, and never
   re-decided per page. This is the single largest responsive gap today.
2. Column priority is declared per table (`priority: 1|2|3`); the wrapper
   hides priority-3 columns below `lg` and priority-2 below `md`. The identity
   column and the action column are never hidden.
3. Touch targets ≥ 40px at base width. Buttons step up a size below `sm` where
   they are primary actions.
4. The page gutter and max width are owned by `AppShell` / `Container` only.
5. No horizontal page scroll at any width. `min-w-0` on every flex/grid child
   that contains text.
6. Prefer `sm` / `lg` (the two breakpoints the app already uses heavily).
   Introduce `md` only for table column priority, and `xl` only for the 4-up
   grid and the dashboard rail.
7. The mobile nav is `MobileMenu` (Sheet) below `lg`, rendering the same
   `NavList`. One navigation definition, two renderings.

---

## 21. Shared utility rules

### `lib/format.js` — presentation formatting (new)

| Export | Output | Replaces |
|---|---|---|
| `formatDate(value)` | `Sep 01, 2026` | 22 local copies |
| `formatDateWithWeekday(value)` | `Tue, Sep 01, 2026` | — |
| `formatDateShort(value)` | `Sep 01` | — |
| `formatDateParts(value)` | `{ weekday, day, monthYear }` for date tiles | — |
| `formatTime(value)` | `6:00 AM` | 27 local copies |
| `formatTimeRange(start, end)` | `6:00 AM – 7:00 AM` | — |
| `formatDuration(start, end)` | `60 minutes` | — |
| `formatAmount(value)` | `₹1,000.00` | 4 local copies |
| `getInitials(name)` | `KT` | 17 local copies |

**Canonical date format: `Sep 01, 2026`** (`{ day: "2-digit", month: "short",
year: "numeric" }`), which is what the references and the majority of the
current table rows use. The card-view variant `Sep 1, 2026` is dropped.

All date helpers parse as `…T00:00:00Z` and format with `timeZone: "UTC"`,
preserving the existing centre-timezone discipline exactly. **These are
formatting functions only — no date arithmetic, no business rules.**
`lib/schedules/validation.js` (`addDaysUTC`, `timeToMinutes`, `DAY_LABELS`)
and `lib/class-sessions/validation.js` stay where they are and are not moved.

### `lib/status.js` — labels and badge variants (new)

```js
export const MEMBERSHIP_STATUS = {
  upcoming:  { label: "Upcoming",  variant: "warning" },
  active:    { label: "Active",    variant: "success" },
  expired:   { label: "Expired",   variant: "neutral" },
  cancelled: { label: "Cancelled", variant: "danger"  },
};
export const PLAN          = { monthly: "Monthly", quarterly: "Quarterly", half_yearly: "Half Yearly", annual: "Annual", custom: "Custom duration" };
export const PAYMENT       = { paid: {…}, pending: {…} };
export const ENTITY_STATUS = { active: {…}, inactive: {…} };
export const ATTENDANCE    = { present: {…}, absent: {…}, unmarked: {…} };
export const MEMBERSHIP_SUMMARY = { active: {…}, expired: {…}, none: {…} };
```

Canonical wording resolves the existing split: `custom` → **"Custom
duration"** everywhere (card view currently says "Custom").

`DISPLAY_STATUS_LABELS` / `DISPLAY_STATUS_BADGE_VARIANTS` already live in
`lib/class-sessions/validation.js` and are **reused from there**, re-exported
by `lib/status.js` for a single import surface. They are not moved or
duplicated.

### Rules

1. **Never** define `formatDate`, `formatTime`, `formatAmount`, `getInitials`
   or a status/label map inside a page or component file again.
2. Migration is **incremental**: a file adopts the shared utilities when that
   file is next implemented. No repo-wide sweep.
3. `lib/reports/export.js` keeps its own formatters — Excel export formatting
   is a different concern from screen formatting. Do not merge them.
4. These modules contain **no** business logic, queries, validation or
   eligibility rules.

---

## 22. Reusable component strategy

### 22.1 Reuse — already correct, use as-is

`AppShell` · `Container` · `Section` · `TabContentHeading` · `ListPageSkeleton`
· `Skeleton` · `Dialog` · `DropdownMenu` · `Sheet` · `Switch` ·
`Table`/`TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell` ·
`NavList` · `MobileMenu` · `GuidedSteps`

### 22.2 Refine — correct to these rules, behaviour unchanged

| Component | Change |
|---|---|
| `Button` | Token sizes, four semantic variants, `text-button`, `rounded-button` |
| `Input` / `Textarea` / `Select` | 40px height, `rounded-input`, `text-body` |
| `Label` | `text-body font-medium text-text-primary` |
| `Badge` | Pill shape in the primitive; add `warning` and `info` variants |
| `ConfirmDialog` | Centered icon + centered text + inline note + equal-width footer (§12) |
| `PageHeader` | Title color fix; contextual `actions` slot |
| `Header` / `Sidebar` / `UserMenu` | Token typography; align the 64px top band |
| `AuthLayout` | Centered card composition (`0 Login.png`) — layout only |
| `Table` primitives | No behavioural change; call sites stop restating padding |

### 22.3 Create — the missing composition layer (16 components)

| Component | File | Replaces |
|---|---|---|
| `Tabs` | `components/ui/tabs.js` | 5 folder-tab copies + 1 toggle |
| `StatTile` + `StatTileGroup` | `components/ui/stat-tile.js` | 15 implementations |
| `EmptyState` | `components/ui/empty-state.js` | 23 sites |
| `Alert` | `components/ui/alert.js` | 17 copies |
| `FormField` + `FormActions` | `components/ui/form-field.js` | ~60 blocks |
| `Pagination` | `components/ui/pagination.js` | 6 inline copies |
| `ViewSwitcher` | `components/ui/view-switcher.js` | 3 copies |
| `SearchInput` | `components/ui/search-input.js` | 6 copies |
| `FilterBar` / `FilterSheet` / `FilterChips` | `components/ui/filter-bar/` | 6 copies (~2,000 lines) |
| `Avatar` | `components/ui/avatar.js` | initials markup + photo `<img>` |
| `Breadcrumb` | `components/ui/breadcrumb.js` | 5 back-links |
| `Panel` + `PanelHeader` | `components/layout/Panel.js` | 5 copies |
| `FieldRow` | `components/layout/FieldRow.js` | 6 copies |
| `EntityCard` | `components/ui/entity-card.js` | 3+ card items |
| `EntityDetailHeader` | `components/layout/EntityDetailHeader.js` | 5 headers |
| `ListToolbar` + `ResultsHeader` + `CardGrid` | `components/layout/list-page.js` | per-page layout |

Plus two shared modules: `lib/format.js`, `lib/status.js` (§21).

### 22.4 Keep page-specific — do not abstract

| Component | Why |
|---|---|
| `weekly-schedule.js` | One consumer; complex, well-documented time-grid geometry |
| `attendance-panel.js` marking controls | One consumer; attendance-specific interaction |
| `review-attendance-changes.js` | One consumer; specific to the edit-review flow |
| `roles-permissions/page.js` matrix | One consumer; derived from `NAV_ITEMS` |
| `guided-steps.js` | One flow; already shared across its three steps |
| `dashboard-todays-classes.js` / `dashboard-upcoming-classes.js` | Two similar `ClassCard`s, but different data shapes and actions — merging would produce a props-heavy component with no third consumer |
| `student-card-menu.js` | Student-specific action set |
| `export-links.js` | Reports-specific |

### 22.5 Retire

`components/ui/data-table-shell.js` — the gradient + `backdrop-blur` frame.
Its 16 call sites move to `Panel` (tables) or a plain `CardGrid` (card
grids).

---

## 23. Rules for avoiding duplicated patterns

1. **Before writing any UI, check `components/ui/`, `components/layout/`,
   `lib/format.js` and `lib/status.js`.** If it exists, import it.
2. **The rule of two.** Writing the same composition a second time is the
   signal to extract it — not the third or fourth.
3. **Never define these at page level again:** `Panel`, `FieldRow`,
   `MetricTile`, `SummaryTile`, `StatTile`, `ReportMetricCard`, `SummaryChip`,
   `EmptyState`, `ViewToggle`, `formatDate`, `formatTime`, `formatAmount`,
   `getInitials`, or any `*_LABELS` / `*_VARIANTS` map.
4. **Fix the shared component, not the page.** If three pages show the same
   visual defect, the defect is in the shared component. Patching a page is a
   contract violation.
5. **Extract with real props, not with flags.** If a component needs more than
   two boolean "mode" props to serve its callers, it is two components.
6. **Do not abstract for its own sake.** A single-consumer component stays
   local (§22.4). Premature abstraction is as much a defect as duplication.
7. When a component is extracted, its old copies are deleted in the same
   change. Never leave both.

---

## 24. Rules for avoiding page-specific visual variants

1. A page may **compose** shared components. It may not **restyle** them.
2. `className` passed to a shared component may only adjust **layout**
   (`mt-*`, `flex-1`, `w-full`, `col-span-*`, `hidden sm:flex`). It may not
   adjust color, size, radius, typography, border or shadow.
3. A visual variant that a reference genuinely requires becomes a **named
   variant on the shared component**, documented here — never an inline
   override.
4. No page-local CSS, no page-local `@layer`, no additions to `globals.css`
   for a single page.
5. If an approved reference appears to demand a page-specific treatment: stop,
   record it, and ask. Do not implement a one-off.
6. Copy conventions are shared too — em dash `—` for empty values, `·` as a
   meta separator, `–` in ranges, sentence case for labels, Title Case for
   buttons and tabs.

---

## 25. UI-only change boundary

### 25.1 Never modified in a UI task

Database schema · Supabase configuration · RLS policies · business logic ·
attendance logic · eligibility rules · authentication behaviour · permissions ·
routing · data models · server actions · API behaviour · product workflows ·
validation rules.

### 25.2 What a UI task may change

Presentation components, layout, class names, shared UI components, shared
**presentation** utilities (`lib/format.js`, `lib/status.js`), and the props a
page passes to a presentation component.

### 25.3 Procedure when a visual requirement needs a functional change

1. Stop before making it.
2. Implement everything around it that is genuinely UI.
3. Record it in §25.5 with the reference that prompted it.
4. Report it. Do not implement it.

### 25.4 Preserved behaviours (explicitly)

- Inline form validation stays inline (§7, §12).
- URL-driven list state (`q` / filters / `page` / `view`) is unchanged.
- Per-page `requireRole` calls stay exactly where they are.
- Server actions, their signatures and their return shapes are untouched.
- `Suspense` boundaries and streaming structure are preserved.
- Centre-timezone date handling is preserved exactly.

### 25.5 Deferred — needs data or behaviour work, not implemented now

| Item | Reference | What it needs |
|---|---|---|
| List-page KPI strips | `02`, `03`, `05`, `06`, `08` | New count queries |
| Dashboard right rail (Today's Overview) | `01` | Aggregation query |
| KPI trend chips / sparklines | `01`, `02`, `05`, `08` | Historical comparison data that does not exist |
| Sort-by | `02`, `05`, `08`, `12`, `14`, `15`, `16-…-final` | New sort parameter |
| Per-page selector | `12`, `14`, `15` | New pagination parameter |
| Global header search | all | Cross-entity search surface |
| Row selection / bulk actions | `03`, `13`, `16Take attendance` | Out of V1 scope |
| Student Emergency Contact, Address | `04` | Not in `01-product.md` §4 or `0006_students.sql` |
| Instructor Specialization | `18 Settings instructor` | Not in `0002_instructors.sql` |
| Center logo upload, Website, Time Zone | `18 Settings center profile` | `logo_url` exists but no Storage bucket or upload UI; no `website` / `timezone` columns |
| Per-batch schedule colors | `11`, `12`, `13` | No color field on batches |
| "Start Class" action | `11` | Not an approved action |
| Add-Student success screen | `19 Form-summary.png` | Changes the completion flow — needs UX approval |
| Unsaved-changes discard guard | `discard.png` | New behaviour where no guard exists today |
| Password visibility toggle | `0 Login.png` | New auth-screen functionality |

Items in §2 are **never** implemented. Items here are **deferred pending
approval** — the distinction matters.

---

## 26. Validation strategy

Run at the end of every UI task:

```
npm run lint      # must stay at 0 errors
npm run build     # after any shared-component change, and before any commit
```

Known acceptable baseline: 4 `@next/next/no-img-element` warnings.
**Zero new warnings.**

### Per-task checklist

1. `npm run lint` — 0 errors, no new warnings.
2. `npm run build` — succeeds.
3. **Token grep** — the change introduces no `text-sm` / `text-xs` /
   `text-base`, no `text-[`, no raw palette name, no hex, no `bg-gradient`,
   no `rounded-full` on a button:
   ```
   grep -rnE "text-(xs|sm|base|lg|xl)[^a-z]|text-\[|#[0-9a-fA-F]{3,6}|bg-gradient|(bg|text|border)-(purple|slate|gray|emerald|rose|sky|indigo)-[0-9]" app components
   ```
4. **Duplication grep** — no new local definition of a shared pattern:
   ```
   grep -rn "^function (Panel|FieldRow|MetricTile|SummaryTile|StatTile|EmptyState|ViewToggle|formatDate|formatTime|getInitials)" app
   ```
5. **Deleted copies** — when a shared component lands, its superseded local
   copies are gone in the same change.
6. **Behaviour preserved** — no diff in `lib/**/actions.js`,
   `lib/**/validation.js`, `lib/**/data.js`, `supabase/**`, or any
   `requireRole` call.
7. **Accessibility** — every icon-only control has `aria-label`; icons are
   `aria-hidden`; every form control has a label; tab semantics are correct;
   focus is visible; dialogs trap and restore focus.
8. **Reference alignment** — the implemented screen is compared against its
   reference image, and every deliberate deviation is one already recorded in
   this document.

### Validating a shared-component change

A change to a shared component is validated **across its call sites**, not
just where it was noticed:

1. List the call sites (`grep -rln "<ComponentName"`).
2. Build.
3. Visually check **one representative call site per distinct usage shape** —
   not all of them. For `Badge`, that means one list card, one table row, one
   detail panel. For `Tabs`, one route-based (Reports) and one state-based
   (Student detail).
4. Confirm no call site still passes a now-redundant override.

---

## 27. Browser QA strategy

QA happens at **checkpoints**, not after every component.

### Checkpoints

| # | When | What to verify |
|---|---|---|
| **QA-1** | After primitives are retuned (Phase A) | One list page + one form + one detail page still render correctly. Nothing regressed. |
| **QA-2** | After the composition layer lands (Phase B) | Shared components render in isolation via their first real consumer. |
| **QA-3** | After the shell (Phase C) | Nav, mobile menu, header alignment, active states, logout. |
| **QA-4** | **Students list — the locked list template** (Phase D) | Full pass: all four list states, both views, filters, chips, pagination, responsive at 375 / 768 / 1280. **Gate — review before any rollout.** |
| **QA-5** | After each rollout batch (Phase E) | Spot-check only: the page renders, filters apply, pagination works, no console errors. |
| **QA-6** | **Student detail — the locked detail template** (Phase F) | Full pass: breadcrumb, header, tabs (keyboard + screen reader), panels, responsive. **Gate.** |
| **QA-7** | After each detail rollout (Phase G) | Spot-check only. |
| **QA-8** | Forms, Reports, Settings, Auth, Dashboard (Phase H) | Per-screen pass, including validation-error rendering. |
| **QA-9** | Responsive pass (Phase I) | Every page type at 375 / 768 / 1024 / 1280. |

### Rules

1. **Do not re-QA an identical shared-component change on every page.** One
   representative page per usage shape (§26) is sufficient.
2. Full passes happen at the two template gates (QA-4, QA-6) and at QA-9.
   Everything between them is a spot-check.
3. Widths: 375 (mobile), 768 (tablet), 1280 (desktop). Add 1024 only at QA-9.
4. Keyboard-only pass is required at QA-4, QA-6 and QA-9: tab order, focus
   visibility, tab-list arrow keys, dialog focus trap and restore.
5. Functional regression check at every checkpoint: create/edit/save still
   works, filters still filter, attendance still saves. UI work must never
   change what the app does.

---

## 28. Implementation order

Dependency-aware. Each phase is independently shippable and validated.

| Phase | Work | Gate |
|---|---|---|
| **A** | `lib/format.js`, `lib/status.js`; retune `Button`, `Input`, `Textarea`, `Select`, `Label`, `Badge` | QA-1 |
| **B** | Create the composition layer (§22.3): `Tabs`, `StatTile`, `EmptyState`, `Alert`, `Panel`, `FieldRow`, `Avatar`, `Breadcrumb`, `ViewSwitcher`, `SearchInput`, `Pagination`, `FilterBar`, `FormField`, `EntityCard`, `EntityDetailHeader`, list-page parts; refine `ConfirmDialog` | QA-2 |
| **C** | Global shell: `Header`, `Sidebar`, `NavList`, `UserMenu`, `MobileMenu` | QA-3 |
| **D** | **Students list — establish and LOCK the list template.** Retire `DataTableShell` here first. | **QA-4 — review before proceeding** |
| **E** | Roll out: Memberships → Batches → Schedule (list + Weekly/List tabs) → Attendance → Attendance History → Settings › Instructors | QA-5 per batch |
| **F** | **Student detail — establish and LOCK the detail template.** | **QA-6 — review before proceeding** |
| **G** | Roll out: Membership detail → Batch detail → Schedule detail → Attendance session detail → Attendance History detail | QA-7 per batch |
| **H** | Forms + `GuidedSteps` → Reports → Settings › Center Profile & Roles → Auth screens → Dashboard | QA-8 |
| **I** | Responsive pass, incl. the shared responsive table behaviour (§20.1) | QA-9 |

Phases A and B change no pixels. They exist so that D through H are
composition rather than layout work.

The Dashboard is last: it is the largest layout change and the most gated by
deferred data items (§25.5).

`.folder-tabs-track` / `.folder-tab-active` are deleted from `globals.css` at
the end of Phase H, once all six consumers have migrated (§15.5).

---

## 29. Open decisions

These are **not** blockers for Phases A–C. They must be resolved before the
phase noted.

| # | Decision | Needed by | Recommendation |
|---|---|---|---|
| 1 | Attendance "Today's Sessions / All Sessions": keep as a brand-filled `ViewSwitcher` (matches references `14`, `15`) or reclassify as underline `Tabs` (matches how Schedule's Weekly/List is drawn in `12`)? | Phase E | **Keep as `ViewSwitcher`** — it matches its own approved reference. Reversible in one component if you prefer tabs. |
| 2 | `00 Design System.png` Secondary `#14B8A6` and Accent `#F59E0B`: add to `03-visual-tokens.md`, or confirm unused? | Phase B | Confirm unused. Nothing in the implementation needs a second brand color. |
| 3 | Page Title / H1 scale: references render larger than the documented 24/32. | Not this phase | Unchanged, per locked decision §2 of the task brief. Revisit only via a documented token change. |
| 4 | List-page KPI strips appear in five references but need new count queries. Approve the data work, or omit the strips? | Phase D (affects the locked template) | Build the template with a **slot** for `StatTileGroup` so adding the strips later is not a re-layout. |
| 5 | Detail-page header idiom: breadcrumb + top-right actions is locked here (§19.1), overriding `04 Student detail.png`'s back-link idiom. Confirm. | Phase F | Confirm — one idiom, applied to all five detail pages. |

---

## 30. Visual mismatch debugging and shared component isolation

For when a rendered result doesn't match what the source code says it
should produce — codified from a real incident where a `Badge` instance
rendered at 16px/24px despite unchanged, canonical source.

**Visual mismatch debugging**

1. When a rendered result doesn't match the source, inspect the actual
   rendered DOM and its computed styles first — DevTools' Computed tab,
   `getComputedStyle()` — before changing any code.
2. Identify the exact CSS rule or inheritance path actually winning for the
   property in question before proposing a fix. A plausible-sounding cause
   is not a diagnosed one; re-reading the source again is not inspection.
3. Make the smallest targeted fix implied by that diagnosis, then verify it
   against the same kind of evidence (computed styles) — not just by
   re-reading the changed source — before treating it as resolved.

**Shared component isolation**

A shared visual component explicitly owns a property — `font-size`,
`line-height`, sizing, icon sizing — when that property defines its visual
identity, rather than relying on inheriting it from wherever it happens to
be placed. See `03-visual-tokens.md`'s "Component Typography Ownership" for
the canonical example (`Badge`, always 12px/18px).

---

## Quick reference

**Before writing UI, ask:**

1. Does a shared component already do this? → Use it.
2. Does a reference image show it? → Match it, unless §2 or this document says otherwise.
3. Does it need a token that doesn't exist? → Stop. Document it.
4. Does it need data that doesn't exist? → Stop. Record it in §25.5.
5. Am I about to write the second copy of something? → Extract it instead.
6. Am I about to pass a color/size/typography class to a shared component? → Don't. Fix the component.
