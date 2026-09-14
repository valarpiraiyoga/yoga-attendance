# Agent Workflow

Tool-independent development process for this repository. Cursor Agent and
Claude Code (and any other agent) follow the same rules, documents, Git
history, and handoff. This file defines **how work is done**. It does not
define product, UX, visual, or phase content.

**Principle:** Project documentation and approved wireframes define **what**
to build. The agent decides **how** within the existing architecture. The
user approves visual/UX changes through Browser QA. **Git is the reliable
handoff** between agents.

**Pipeline:** Understand → Inspect → Plan → Implement → Validate → Report
→ Browser QA → User Approval → Commit → Push

---

## 1. Purpose

Keep implementation consistent regardless of which agent is used. An agent
must never rely on another agent's chat memory. Continue only from:

- project instruction files
- source-of-truth documents
- approved wireframes / UI references
- the actual repository (working tree + Git history)

---

## 2. Source-of-truth hierarchy

Authoritative **what** (do not duplicate here):

| Concern | Document |
|---|---|
| Product, roles, business rules, data model, V1 scope | `docs/01-product.md` |
| IA, navigation, flows, screens, interaction | `docs/02-ux.md` |
| Layout per screen | `docs/wireframe/` (approved wireframes) |
| Colors, type, spacing, radius, shadows | `docs/03-visual-tokens.md` |
| Visual appearance (reference only) | `docs/ui-reference/` |
| Phase sequence and status | `docs/04-development-plan.md` |
| Stack, architecture, coding, validation, Git style | `CLAUDE.md` |
| Next.js API/convention notes for this installed version | `AGENTS.md` + `node_modules/next/dist/docs/` |

Decision order when implementing (same as `CLAUDE.md`):

1. Explicit user instruction for this task
2. `docs/01-product.md`
3. `docs/02-ux.md`
4. Approved wireframe
5. `docs/03-visual-tokens.md`
6. `docs/ui-reference/` (appearance only; does not override wireframe structure or tokens)
7. `docs/04-development-plan.md`
8. Existing project architecture
9. General framework conventions

If sources conflict, stop and ask. Do not silently pick a winner. Do not
invent requirements (`CLAUDE.md`).

This workflow file does **not** outrank product, UX, visual, or plan docs.

---

## 3. Agent startup procedure

Before changing anything:

1. Read `CLAUDE.md` and this file (`docs/00-agent-workflow.md`).
2. Read `AGENTS.md` (Next.js version caveats).
3. Read the relevant slices of `docs/01-product.md`, `docs/02-ux.md`,
   `docs/03-visual-tokens.md`, and `docs/04-development-plan.md` for the
   current task — not the entire corpus unless the task is cross-cutting.
4. Inspect the approved wireframe for any screen being changed.
5. Inspect `docs/ui-reference/` only as visual character; honor known
   conflicts documented in `CLAUDE.md` (e.g. `login.png`).
6. Inspect Git state and the current implementation (next section).
7. When using Next.js APIs or conventions, check the installed docs under
   `node_modules/next/dist/docs/`.

Do not assume Claude Code is the only agent. The “Claude Code Development
Workflow” section in `CLAUDE.md` applies to **every** agent.

---

## 4. How to understand current project state

Do not trust prior chat. Reconstruct state from the repo:

1. `git status`, `git diff`, `git log` — branch, uncommitted work, recent
   messages.
2. `docs/04-development-plan.md` §2 Phase Status — what is complete,
   in progress, gated, uncommitted, or awaiting Browser QA.
3. Existing code for the feature: `app/`, `components/`, `lib/`,
   `supabase/migrations/`, verification scripts.
4. Whether migrations in the working tree are applied is **not** implied by
   files existing; confirm from the plan, verification notes, and the
   actual database when the task depends on schema.

Continue from what is actually in the tree, including unfinished work left
by another agent.

---

## 5. Task execution procedure

1. **Understand** — user task + relevant source-of-truth sections.
2. **Inspect** — current code, Git, phase status, wireframe if UI.
3. **Plan** — smallest change set; list files; note risks and open questions.
4. **Implement** — match existing architecture (presentation / feature UI /
   logic / data access / validation). Reuse components and tokens.
5. **Validate** — section 8.
6. **Report** — section 13.
7. **Browser QA** — section 9 (user).
8. **User approval** — then commit, then push, only when asked (section 10).

Work incrementally. Do not implement the whole application in one task.

---

## 6. Scope discipline

- Change only files required for the assigned task.
- Do not modify unrelated features, schema, business rules, UX flows, or UI
  unless the task explicitly requires it.
- Do not add dependencies unless justified per `CLAUDE.md` Dependency Rules
  and the user agrees.
- Do not mix documentation edits into feature work unless the task is
  documentation (see `docs/04-development-plan.md` Git Checkpoints).
- Do not update `docs/04-development-plan.md` for product/UX/visual
  decisions; update it when phase status or sequencing actually changes.
- Preserve the locked IA, global shell, and approved wireframes
  (`CLAUDE.md` UX Rules).

---

## 7. UI refinement boundary

Protect already-developed, Browser-QA'd functionality. Allow presentation
changes without silently changing application behaviour.

Inspect the existing implementation first. If the requested UI can be
achieved with existing data and behaviour, stay inside that boundary.

**Presentation-first.** UI refinement normally changes only layout, spacing,
typography, colors, borders, radius, shadows, icons, visual hierarchy,
responsive presentation, presentation components, and presentation-only
formatting/helpers.

**Preserve functionality.** Do not change business rules, calculations, data
flows, database schema, Supabase queries/mutations, authentication,
authorization, permissions, routing, or application behaviour merely to
improve UI.

**Presentation-only logic is allowed** when required to render what already
exists, for example: initials from existing first/last name; formatting
existing data for display; an icon from an existing status; showing an
existing field differently; responsive presentation logic.

**Stop if a real functional or data change is required.** Do not implement
it silently. Explain why it is required, name the affected files/systems,
describe the smallest change, and wait for approval. Treat it as a separate
scoped task unless the user explicitly authorizes it in the current task.

Browser QA (section 9) remains required for visual/UX changes before
approval, commit, and push.

---

## 8. Validation requirements

Before treating agent work as done (still **before** user Browser QA):

- Behaviour matches the relevant product and UX requirements.
- Business rules in `docs/01-product.md` are not weakened.
- Visual tokens from `docs/03-visual-tokens.md` are used; no ad-hoc palette.
- Responsive and accessibility checks in `CLAUDE.md` considered for UI work.
- No invented requirements.
- `npm run lint`
- `npm run build` when appropriate for the stage of work.

Build/lint success is not a substitute for Browser QA.

---

## 9. Browser QA / human approval

The agent cannot approve visual or UX correctness.

- User verifies the changed flow in a real browser (not screenshot-only).
- Related routes that share state, data, or components must stay consistent.
- Desktop and mobile when layout/responsive behaviour changed.
- Edge states the change touches (empty, error, role variants).

Visual/UX changes are **not complete** until the user approves after Browser
QA. Do not commit those changes as “done” before that approval unless the
user explicitly says to commit anyway.

---

## 10. Commit and push rules

- **Never commit or push unless the user explicitly asks.**
- After Browser QA and user approval, commit only what that task covers.
- One focused commit; do not mix unrelated files.
- Follow existing message style: `chore:`, `docs:`, `feat:`, `fix:`
  (`docs/04-development-plan.md` §9, `CLAUDE.md` Git Discipline).
- Inspect `git status` and the diff before committing.
- Do not commit secrets (`.env`, `.env.local`, credentials).
- Do not skip hooks. Do not force-push `main`/`master`.
- Push only when the user explicitly asks.

Typical order: Browser QA → user approval → commit → push.

---

## 11. Switching between Cursor and Claude Code

Handoff is the repository, not the chat.

Incoming agent:

1. Run the startup procedure (section 3).
2. Read Git status, diff, and recent commits.
3. Read current phase status in `docs/04-development-plan.md`.
4. Inspect the implementation as it exists now.
5. Continue that work; do not restart a finished phase or overwrite
   uncommitted work without checking it.

Do not assume the other tool applied migrations, ran Browser QA, or
committed. Uncommitted work in the working tree is part of project state.

---

## 12. Handling unclear requirements

If behaviour is missing or sources disagree:

1. Re-read the relevant source-of-truth docs and wireframe.
2. Inspect existing code and similar features.
3. If still ambiguous, **stop and ask**. Do not invent product behaviour,
   fields, navigation, roles, or UI controls.

---

## 13. Required completion / report format

End every implementation task with a short report:

- **Task** — what was asked
- **Files changed** — paths only
- **What changed** — behaviour/architecture, not a file dump
- **Validation** — lint/build and what was (not) exercised
- **Browser QA** — ready / blocked / not applicable; what the user should
  click
- **Source-of-truth** — which docs/wireframes were followed; any conflict
- **Unresolved** — blockers, follow-ups, phase-status notes
- **Git** — commit/push performed or explicitly not performed

Do not claim a UI feature is finished until Browser QA and user approval
have happened, or the user has waived them.
