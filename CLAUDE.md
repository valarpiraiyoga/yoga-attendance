# Yoga Center Attendance Management App

## Project Overview

This is a web application for managing a yoga center's students, memberships,
batch enrollments, recurring schedules, class sessions, daily attendance,
attendance history, reports, and settings.

The application is being developed as a portfolio-quality product demonstrating:

- Product thinking
- UX/UI design
- Design systems
- Frontend development
- Full-stack application architecture

The application must remain maintainable, scalable, and consistent as new
features are added.

---

# Technology Stack

Use the following stack unless the project requirements explicitly change:

- Next.js
- React
- JavaScript
- Next.js App Router
- Tailwind CSS v4
- shadcn/ui
- Lucide React
- Supabase
- PostgreSQL
- Inter font

Do not introduce additional frameworks, state-management libraries, data-fetching
libraries, or architectural patterns unless there is a clear project need and
the change is justified.

---

# Source of Truth

Before implementing or modifying a feature, consult the appropriate source of
truth.

## Product Requirements

`docs/01-product.md`

Defines:

- product requirements
- roles and permissions
- business rules
- data model
- V1 scope
- feature requirements

## UX Requirements

`docs/02-ux-final.md`

Defines:

- information architecture
- navigation
- user flows
- screen requirements
- interaction patterns
- UX behavior

## Visual Foundation

`docs/03-visual-tokens.md`

Defines:

- colors
- typography
- spacing
- border radius
- shadows
- visual character

Do not create a separate visual-token system.

## Development Plan

`docs/04-development-plan.md`

Defines the planned implementation phases and development architecture.

## Wireframes

`docs/wireframe/`

Approved wireframes are the UX layout reference for individual screens.

Do not redesign or reinterpret approved wireframes unless explicitly instructed.

## UI Reference

`docs/ui-reference/`

Approved visual reference images for composition, layout feel, spacing feel,
hierarchy, component appearance, visual density, color usage, and the
general visual character of cards, tables, forms, and navigation.

These images are references only, not application assets. Do not copy them
into `public/` or import them into application code.

A UI reference image does not override the approved wireframe or visual
tokens. If a reference image visually suggests a different layout, follow
the wireframe. If a reference image visually suggests a different color,
follow `docs/03-visual-tokens.md`. Do not invent or silently change
requirements based on a reference image.

`visual-tokens.png` is a visual companion to `docs/03-visual-tokens.md`.
`docs/03-visual-tokens.md` remains the authoritative visual-token source of
truth; the image is a reference only.

---

# Source-of-Truth Priority

When making implementation decisions, use this hierarchy:

1. Explicit user instruction
2. `docs/01-product.md`
3. `docs/02-ux-final.md`
4. Approved wireframe
5. `docs/03-visual-tokens.md`
6. `docs/ui-reference/` (visual appearance reference only — does not override
   the wireframe's structure or the visual tokens' colors)
7. `docs/04-development-plan.md`
8. Existing project architecture
9. General framework conventions

If sources conflict, do not silently choose a solution.

Explain the conflict and ask for clarification when necessary.

---

# Critical Rule: Do Not Invent Requirements

Do not add functionality, fields, states, navigation items, authentication
methods, workflows, or UI controls that are not supported by the project
requirements.

Examples of things that must NOT be invented:

- Google login
- Remember-me functionality
- Student login
- Payment gateway
- QR attendance
- Face recognition
- AI features
- Mobile application functionality
- Advanced analytics
- Multi-branch functionality
- Google Sheets integration
- Custom roles

If a requirement is missing, do not assume it.

---

# UX Rules

The approved IA, flows, wireframes, and global shell are locked.

Do not:

- change navigation without approval
- add unnecessary screens
- remove required screens
- invent new workflows
- duplicate information unnecessarily
- change the approved global shell for individual pages
- redesign a wireframe while implementing it

The implementation should preserve the approved UX while applying the approved
visual system.

---

# Visual Rules

The visual direction is:

Calm + Modern + Professional + Focused

Use:

- neutral/light surfaces
- teal as the primary brand/action color
- generous whitespace
- subtle borders
- subtle shadows
- moderate corner radius
- clear hierarchy
- professional SaaS/admin UI patterns

The application should be approximately:

- 70–80% neutral
- 15–20% teal/brand
- small amounts of semantic status colors

Use the tokens from `docs/03-visual-tokens.md`.

Do not introduce random colors or raw hex values when an existing token applies.

Do not use:

- purple-heavy UI
- gradient-heavy UI
- excessive rounded/pill elements
- heavy shadows
- decorative marketing-style layouts
- multiple fonts

Typography uses Inter.

## Theme Support

The application should be architecturally capable of supporting a dark theme in
the future.

- Light theme is the approved and default V1 experience.
- Do not expose a light/dark theme toggle or add dark-mode UI controls unless
  explicitly approved in the product/UX requirements.
- Do not introduce automatic system dark-mode behavior that changes the
  approved V1 visual experience.
- Dark-theme tokens may be prepared architecturally, but they must not alter
  the approved V1 light-theme experience.

---

# Architecture Principles

Build the application feature-by-feature with clear separation between:

- presentation
- feature components
- business logic
- data access
- validation

Avoid putting large amounts of UI, business logic, and database logic into a
single page component.

Prefer reusable components when the same behavior or UI pattern is used more
than once.

Avoid premature abstraction.

Create abstractions when they solve a real repeated problem.

---

# Feature-Oriented Development

Organize application code so features can grow independently.

Expected feature areas include:

- Dashboard
- Students
- Memberships
- Batches
- Schedule
- Attendance
- Attendance History
- Reports
- Settings

Do not create large collections of unrelated components in a single folder.

Shared components belong in shared locations.

Feature-specific components should remain close to their feature.

---

# Backend / Supabase Strategy

Supabase and PostgreSQL are part of the application architecture.

Do not build the entire backend as a separate project before implementing
features.

Develop features progressively:

Feature UI
→ business logic
→ validation
→ data access
→ Supabase integration

Do not treat the backend as an afterthought.

Do not create the complete database schema prematurely unless required by the
current development phase.

---

# Business Rules

Business rules in `docs/01-product.md` are authoritative.

In particular:

- Historical attendance must not silently change because of later student,
  membership, enrollment, batch, or schedule changes.
- Schedule changes apply to future sessions.
- Cancelled and Holiday sessions do not have attendance.
- Attendance eligibility depends on active enrollment and active membership
  on the session date.
- Renewal creates a new membership record; historical memberships remain.
- Deactivation is preferred over deletion where historical records must remain.
- Students do not have login access in V1.
- Admin and Instructor are the only roles in V1.

Never weaken or bypass these rules for implementation convenience.

---

# Claude Code Development Workflow

Before implementing a task:

1. Read this `CLAUDE.md`.
2. Read the relevant product requirements.
3. Read the relevant UX requirements.
4. Inspect the relevant wireframe.
5. Read the relevant visual tokens.
6. Inspect the existing implementation.
7. Check the installed Next.js documentation when working with Next.js APIs
   or conventions.
8. Identify which files actually need to change.
9. Make the smallest appropriate implementation.

Do not modify unrelated features.

---

# Implementation Discipline

For each feature:

1. Understand the requirements.
2. Plan the implementation.
3. Implement.
4. Reuse existing components and tokens.
5. Validate the implementation.
6. Run lint.
7. Run build when appropriate.
8. Check for regressions.
9. Summarize what changed.
10. Identify any unresolved issue before moving to the next feature.

Do not implement the entire application in one task.

Work incrementally.

---

# Dependency Rules

Do not install a new npm package simply because it is convenient.

Before adding a dependency:

- check whether the existing stack already provides the capability
- check whether an existing installed package can solve the problem
- determine whether the dependency is genuinely justified

Keep the dependency tree intentionally small.

---

# Styling Rules

Use Tailwind CSS v4 and the project's defined design tokens.

Prefer:

- reusable components
- semantic token names
- consistent spacing
- consistent typography
- existing radius and shadow tokens

Avoid:

- one-off styling systems
- duplicate CSS frameworks
- arbitrary colors
- arbitrary spacing without justification
- page-specific design systems

---

# Accessibility

All interactive UI should be accessible.

Pay attention to:

- semantic HTML
- keyboard navigation
- visible focus states
- accessible labels
- appropriate button/link semantics
- form validation feedback
- sufficient text/background contrast
- dialog and menu behavior

Do not sacrifice accessibility for visual appearance.

---

# Responsive Design

The application must work across:

- desktop
- tablet
- mobile

Do not create a desktop-only implementation unless the requirement explicitly
allows it.

Use the approved responsive UX patterns when they are defined.

---

# Code Quality

Prefer:

- readable JavaScript
- small focused components
- clear naming
- predictable data flow
- reusable patterns
- minimal duplication

Avoid:

- unnecessary complexity
- giant components
- deeply nested conditional rendering
- duplicated business logic
- magic values when a project token or constant should be used

---

# Validation

Before considering a task complete, verify:

- functionality
- UX requirements
- visual consistency
- responsive behavior
- accessibility
- business rules
- linting
- build compatibility

At minimum, run:

`npm run lint`

and run:

`npm run build`

when appropriate for the stage of development.

---

# Git Discipline

Keep commits focused and meaningful.

Do not mix unrelated changes into a feature commit.

Before committing:

- inspect `git status`
- review changed files
- verify the implementation
- run relevant validation

Use clear commit messages following the project's established convention.

---

# Important Final Rule

When uncertain:

Do not guess.

Inspect the source-of-truth documentation, existing code, installed framework
documentation, and approved wireframe first.

If the required behavior is still ambiguous, stop and ask for clarification
rather than inventing product behavior.