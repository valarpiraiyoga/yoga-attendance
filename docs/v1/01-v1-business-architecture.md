# V1 Business Architecture

## Document Metadata

| Field | Value |
|---|---|
| Document | V1 Business Architecture |
| Product | Yoga Center Attendance App |
| Version | V1 |
| Status | Completed / Baseline |
| Purpose | Business architecture reference for V2 planning |
| Source | Existing V1 implementation |
| Baseline | Repository `main` at commit `75b1664` (1 Oct 2026), database migrations `0001`–`0024` |
| Enhancements | V1 Invoice / Receipt Enhancement (Section 11A) — approved and documented; **not yet implemented**. Everything else in this document remains the baseline. |
| Audience | Product, design and development teams |

### How to read this document

This document records what V1 **actually does**. Where the written product
documentation and the implementation disagree, the implemented behaviour is
recorded and the disagreement is listed in Appendix A. Nothing here is a
proposal.

Each rule carries an evidence marker:

| Marker | Meaning |
|---|---|
| **DB** | Enforced by the database (constraint, trigger, row-level security, or database function). Holds no matter which screen is used. |
| **App** | Enforced by the application's server-side logic. |
| **UI** | Behaviour of the screens only (e.g. what options are offered). |
| **Test** | Covered by the automated unit test suite (370 tests, all passing at baseline). |
| **Doc** | Stated in the V1 product/UX documentation (`docs/01-product.md`, `docs/02-ux.md`). |
| **Not confirmed** | No evidence of the behaviour, or evidence is ambiguous. Not assumed. |
| **Enhancement** | Approved behaviour of the V1 Invoice / Receipt Enhancement (Section 11A). Documented as a decision; not part of the baseline implementation and not yet verified against code. |

**Baseline and enhancement.** Sections 1–25 describe the V1 baseline as
implemented at the commit above. The V1 Invoice / Receipt Enhancement is
recorded as a later V1 enhancement: where a baseline statement is changed by
it, the row or paragraph says so and points to Section 11A. The baseline
statements are kept so the history stays readable; the original V1 did not
have a stored invoice. Until the enhancement is implemented, the baseline
behaviour is what the application does.

---

## 1. Executive Summary

V1 is a web application that runs **one yoga center**. Center staff use it to
manage students, their memberships and batch enrollments, the center's
recurring weekly class timetable, the dated class sessions that timetable
produces, and Present/Absent attendance for each session. It provides
attendance history, three attendance reports with CSV/Excel export, a
role-specific dashboard, and center settings.

There are exactly **two roles**: **Admin** (full management) and
**Instructor** (records and corrects attendance for their own sessions only).
Students do not sign in.

The business architecture rests on five ideas, each enforced in the database
rather than only in screens:

1. **Eligibility is computed, not chosen.** A student appears on a session's
   roster only if, *on that session's own date*, they are an active student,
   hold an active enrollment in the batch, are assigned to that specific
   recurring class, and hold a membership covering the date.
2. **History is frozen at the moment it is recorded.** When attendance is
   first saved, the session's details and its eligible-student list are
   captured permanently. Later changes to students, enrollments, memberships,
   batches or schedules cannot rewrite it.
3. **Nothing historical is deleted.** Students, batches, instructors,
   enrollments, memberships, sessions and attendance are deactivated,
   cancelled, closed or corrected — never removed. The only deletions allowed
   are for records that have never become part of history (an unused
   schedule; a schedule assignment that has not started).
4. **Schedules are versioned, sessions are projected.** Editing the timetable
   closes the old version and starts a new one. Dated sessions are calculated
   from the timetable and only stored when something must attach to them.
5. **One center, one clock.** Every "today", every session status and every
   membership status is evaluated in the center's configured time zone.

---

## 2. Product Scope

### 2.1 Purpose

Make daily attendance fast while giving the center a reliable way to manage
changing batches, schedules, enrollments and membership periods without
damaging historical attendance. *(Doc)*

### 2.2 Product areas implemented in V1

| Area | Admin | Instructor | Evidence |
|---|---|---|---|
| Dashboard | Yes | Yes (own classes only) | App, DB |
| Students (incl. enrollments) | Yes | No | App, DB |
| Memberships (incl. receipt; stored Invoice / Receipt as an enhancement, §11A) | Yes | No | App, DB |
| Batches | Yes | No | App, DB |
| Schedule | Yes | No | App, DB |
| Attendance (sessions, Take Attendance) | Yes | Yes (own sessions only) | App, DB |
| Attendance History | Yes | Yes (own sessions only) | App, DB |
| Reports (+ CSV / Excel export) | Yes | No | App |
| Settings (Center Profile, Instructors, Roles & Permissions) | Yes | No | App, DB |
| Assigned Classes | — | **Not built** (listed in UX navigation; deferred) | App |

### 2.3 Explicitly not in V1

See Section 24.

---

## 3. V1 Business Model

### 3.1 Core model

```text
Student ──► Membership                (when may the student attend at all?)
   │
   └──► Batch Enrollment ──► Batch   (which class type does the student belong to?)
              │
              └──► Schedule Assignment ──► Schedule Series   (which recurring class?)
                                                │
                                                └──► Schedule Version (day, time, instructor, effective period)
                                                          │
                                                          └──► Class Session (one dated occurrence)
                                                                    │
                                                                    └──► Attendance (Present / Absent per student)
```

*(DB, Doc)*

### 3.2 Center-level operating model

```text
Center (single, implicit)
  ↓
Batch            — a class type, e.g. "HYG — Hatha Yoga General"
  ↓
Schedule         — a recurring weekly slot of that batch, with an instructor
  ↓
Class Session    — one dated occurrence of that slot
  ↓
Attendance       — Present / Absent for each eligible student
```

The center is not a record that other records point to. It is a single
settings record (name, logo, contact details, time zone, currency). Every
other record implicitly belongs to the one center. *(DB)*

### 3.3 Distinct concepts

V1 keeps these concepts separate on purpose *(Doc, DB)*:

| Concept | What it answers |
|---|---|
| Student | Who is this person? |
| Membership | Over which dates is the student allowed to attend? Was it paid? |
| Batch | Which class type? |
| Batch Enrollment | Over which dates does the student belong to this batch? |
| Schedule Assignment | Which of the batch's recurring classes does the student attend, and since when? |
| Schedule (series + versions) | When does a recurring class run, who teaches it, from when to when? |
| Class Session | What happened (or will happen) on a specific date? |
| Attendance | Was this eligible student Present or Absent at that session? |

Membership and enrollment are **independent**. One membership covers every
batch the student is enrolled in during its dates; there is no stored link
between a membership and an enrollment. *(DB, Doc)*

---

## 4. User Roles

| Role | Description | How the account is created | Evidence |
|---|---|---|---|
| **Admin** | Center owner / manager. Full management access. | **Out-of-band only.** Every new account is created as Instructor; promotion to Admin is done directly in the database. No screen creates or promotes an admin. | DB |
| **Instructor** | Teaches classes; records and corrects attendance for their own sessions. | Admin creates an Instructor record, then uses **Provide Login Access**, which sends an email invitation. | App, DB |
| Student | Managed record only. **No login.** | Created by Admin. | Doc, DB |

There are no custom roles, no per-role configuration and no third staff role.
The Settings → Roles & Permissions screen is **read-only**: it displays the
fixed access model, derived from the same source that controls navigation.
*(App)*

---

## 5. Role Responsibilities and Permissions

### 5.1 Permission matrix

| Capability | Admin | Instructor | Enforced by |
|---|---|---|---|
| Sign in, reset own password via email | Yes | Yes | App |
| Change own password inside the app (Settings) | Yes | **No** (Settings is admin-only; instructors use Forgot Password) | App |
| View dashboard | All classes + center KPIs + recent activity | Own classes only | App, DB |
| Students: view, add, edit, activate / deactivate | Yes | No | App, DB |
| Enrollments & schedule assignments | Yes | No | App, DB |
| Memberships: add, edit, renew, cancel, receipt (invoice: issue, view, edit number/date, print, PDF, share — Enhancement, §11A) | Yes | No | App, DB |
| Batches: add, edit, activate / deactivate | Yes | No | App, DB |
| Schedules: add, edit (version / direct), deactivate, delete unused | Yes | No | App, DB |
| View session lists and session details | All sessions | Own sessions only | App, DB |
| Edit a single session (instructor / time) | Yes | No | App |
| Mark a session Cancelled / Holiday | Yes | No | App |
| Take attendance | Any session | Own sessions only | App, DB |
| Edit (correct) saved attendance | Any session | Own sessions only | App, DB |
| View attendance history | All | Own sessions only | App, DB |
| Reports & export | Yes | No | App |
| Center profile, regional settings | Yes | No | App, DB |
| Manage instructors, provide login access | Yes | No | App, DB |

### 5.2 What "own session" means for an instructor

- For a session that has been stored (materialized), the instructor named
  **on the session itself** owns it. If an Admin reassigns one session to a
  different instructor, ownership moves with it — the new instructor gains
  it, the original instructor loses it, even though the recurring schedule
  still names the original. *(DB)*
- For a session not yet stored, ownership comes from the schedule's current
  instructor. *(DB)*
- An instructor sees student names and phone numbers **only** as the
  eligible roster of a session they own. They cannot browse the student list,
  memberships or enrollments. *(DB)*

### 5.3 Deactivated or unlinked instructors

- A deactivated instructor, or a signed-in user not linked to any instructor
  record, receives **no data**: every instructor data permission resolves to
  nothing at the database. *(DB)*
- Such a user can still sign in and reach the instructor screens, which
  appear empty. A dedicated "your access is disabled" screen is **not built**.
  *(App)*

---

## 6. Student Management

**Purpose.** Maintain the center's students and give the Admin a single
place to see each student's enrollments, membership and recent attendance.

**Who.** Admin only. *(App, DB)*

### 6.1 Student information

| Field | Rule | Evidence |
|---|---|---|
| Student ID | System-generated, sequential `YC-000001`, unique, **immutable**. Any value supplied by a caller is overwritten; any attempt to change it is rejected. | DB |
| Full name | Required, ≤ 100 characters. | App |
| Phone | Required, digits only, ≤ 30. Stored with a separate country calling code (e.g. `+91`). **Not unique.** | App, DB |
| Email | Optional, valid format, ≤ 255, stored lower-case. **Not unique.** | App |
| Date of birth | Optional; cannot be in the future. | App |
| Gender | Optional: Male / Female / Other. | App, DB |
| Join date | Required. | App, DB |
| Profile photo | Optional; JPEG / PNG / WebP, ≤ 2 MB. | App, DB |
| Notes | Optional, ≤ 1000 characters. | App |
| Status | Active / Inactive. New students are Active. | DB |

### 6.2 Actions

| Action | Behaviour | Evidence |
|---|---|---|
| Add Student | Guided three-step flow: Student → Add Membership (skippable) → Add Batch Enrollment. | App, Doc |
| Edit Student | Edits details only; status is never changed by Edit. | App |
| Deactivate / Activate | Separate action with a Review → Confirm step. Retains every historical record. Reversible. | App, Doc |
| Delete | **Not possible.** No delete permission exists. | DB |
| Search / filter | Search by name, phone, or name/code of a batch the student is actively enrolled in. Filters: status, batch, membership (Active / Expired / None). | App |

### 6.3 Business rules

- Deactivation does **not** cascade: it does not end enrollments, assignments
  or memberships. *(App)*
- An inactive student is excluded from attendance eligibility. Student status
  has no history — eligibility reads the student's **current** status (see
  Section 23.3 for the consequence). *(DB)*
- The Student Details page shows enrollments (with assigned schedules), the
  current membership, recent attendance, profile and notes. An enrollment with
  no schedule assignment is visibly flagged. *(App, Test)*

---

## 7. Instructor Management

**Purpose.** Maintain the people who teach. An instructor is an independent
record, assigned to classes at the **schedule** level. *(Doc, DB)*

**Who.** Admin only (Settings → Instructors). *(App, DB)*

| Field / action | Rule | Evidence |
|---|---|---|
| Full name | Required, ≤ 100. | App |
| Email | Optional; **unique across instructors** (case-insensitive). Required before login access can be granted. | DB, App |
| Phone | Optional, digits only, with country code. | App, DB |
| Photo | Optional; JPEG / PNG / WebP, ≤ 2 MB. | App, DB |
| Status | Active / Inactive; quick toggle from the list or on Edit. Reversible. | App |
| Delete | **Not possible.** | DB |
| Provide Login Access | Separate, explicit action. Preconditions: instructor is Active, has an email, and has no login yet. Sends an email invitation; the invited account is linked to this instructor record. | App |
| Revoke login access | **Not built.** Deactivating the instructor removes their data access instead. | App, DB |
| Assign to classes | Done by choosing the instructor on a schedule, or on a single session. Only Active instructors are offered. | UI |

**Rules.**

- One sign-in account links to at most one instructor record, and vice versa.
  *(DB)*
- The link is made from the account created by the invitation — never by
  matching email — so later email edits do not change who the instructor is.
  *(App)*
- Removing a sign-in account never removes the instructor record. *(DB)*
- Deactivating an instructor does **not** reassign or close their schedules;
  those classes continue to appear (see Section 23.4). *(App)*

---

## 8. Batch Management

**Purpose.** Represent the class types the center offers. A batch has no
fixed time; its times come from its schedules. *(Doc)*

**Who.** Admin only. *(App, DB)*

| Field | Rule | Evidence |
|---|---|---|
| Name | Required, ≤ 100. | App |
| Short code | Required, ≤ 20, stored upper-case, **unique case-insensitively** (the weekly timetable identifies a batch by code alone). | DB, App |
| Category | Optional, ≤ 50. | App |
| Description | Optional, ≤ 500. | App |
| Colour | Required, one of 10 palette colours (default teal). Visual identity only. | DB |
| Image | Optional; JPEG / PNG / WebP, ≤ 2 MB. | App, DB |
| Status | Active / Inactive, changed through Edit Batch. | App |
| Capacity | **Not supported** in V1. | Doc |

**Displayed batch status** (Batches list) is derived, not stored *(App, Test)*:

| Displayed | Condition |
|---|---|
| Inactive | Stored status is Inactive. |
| Active | Stored Active, and either no schedules at all or at least one schedule currently in effect. |
| Upcoming | Stored Active, no current schedule, at least one active schedule starting in the future. |
| Completed | Stored Active, and all of its schedules have ended or been deactivated. |

**Rules.**

- A batch can have many schedules, including several on the same weekday.
  *(Doc, DB)*
- Batches are never deleted; history remains available after deactivation.
  *(DB)*
- Deactivating a batch does **not** deactivate its schedules or end its
  enrollments. Inactive batches are no longer offered when creating a new
  enrollment. *(App, UI)*
- Batch Details has Overview, Students (every enrollment, active and
  historical, with assigned schedules), Schedules, and Attendance (history
  scoped to the batch). *(App)*

---

## 9. Enrollment

V1 has two levels of enrollment: the **batch enrollment** and the **schedule
assignment** that sits inside it.

```text
Student
  ↓
Batch Enrollment   (student ↔ batch, with effective start / optional end, Active / Inactive)
  ↓
Schedule Assignment(s)  (which recurring class(es) of the batch, with effective start / optional end)
  ↓
Batch / Schedule Series
```

**Who.** Admin only, from Student Details. *(App, DB)*

### 9.1 Batch enrollment rules

| Rule | Evidence |
|---|---|
| A student may be enrolled in several batches at the same time (e.g. combo offers). | Doc, DB |
| At most **one Active enrollment per student per batch**. Inactive (historical) enrollments in the same batch are kept, so a student can re-enroll later. | DB |
| Effective start date required; end date optional and not before start. | DB, App |
| New enrollments are created Active. Status can be changed on Edit. | App |
| Only Active batches are offered when choosing a batch. | UI |
| Enrollments are never deleted. | DB |
| Enrollment start / end dates are freely editable, including to past dates. | App |

### 9.2 Schedule assignment rules

| Rule | Evidence |
|---|---|
| Being enrolled in a batch does **not** by itself make a student eligible for the batch's classes; they must be assigned to the specific recurring class. | DB, Doc |
| At least one schedule must be selected when adding or editing an enrollment. | App |
| Every selected schedule must belong to the enrolled batch (checked on the server). | App |
| An enrollment may hold several assignments at once (e.g. both the 6 AM and the 7 PM class). | DB |
| Assignments point to the **schedule series** (the stable identity of a recurring class), so editing a schedule never detaches its students. | DB |
| No status field: an assignment applies exactly to the dates in its period. | DB |
| The same schedule cannot be assigned twice to one enrollment over overlapping dates. | DB |
| Overlapping class **times** across a student's own assignments are not blocked. | Doc, DB |
| New enrollment: every selected schedule starts on the enrollment's start date. | App |
| Changing the selection on Edit requires a separate **schedule change date**, which cannot be before today. Removed schedules are closed the day before that date; added schedules start on it; unchanged ones are left alone. | App |
| A removed assignment that **has not started yet** (starts on or after the change date) is **withdrawn (deleted)** rather than closed. The database permits deleting only assignments that start today or later. | DB, App |

### 9.3 Relationships

- Enrollment drives eligibility (Section 14.2) and the "covered batch
  enrollments" shown on a membership. *(App)*
- Enrollment and its assignments are saved in separate steps, not one
  transaction. If assignment saving fails, the enrollment exists without a
  schedule and is visibly flagged on Student Details and Batch Details.
  *(App)*

---

## 10. Membership Management

**Purpose.** Record the period during which a student may attend, the price
and whether it has been paid. Membership is one of the four eligibility
conditions. *(Doc, DB)*

**Who.** Admin only. *(App, DB)*

### 10.1 Membership information

| Field | Rule | Evidence |
|---|---|---|
| Membership ID | System-generated, sequential `MEM-000001`, unique, immutable. | DB |
| Student | Required. The standalone Add Membership flow offers **active** students only; whether a membership can be added from an inactive student's own page is **Not confirmed** as intended (no status check exists). | DB, UI |
| Plan | Monthly / Quarterly / Custom. | DB, App |
| Start date | Required. | DB |
| End date | Required; not before start; same-day allowed. Auto-calculated (Monthly = start + 1 month − 1 day; Quarterly = start + 3 months − 1 day; Custom = manual) and always editable. | DB, App |
| Amount | Required, greater than 0. | DB, App |
| Currency | Stamped from the center currency when the membership is created; never converted afterwards. | DB, App |
| Payment status | Paid / Pending; defaults to Pending. | DB, App |
| Payment date | **Enhancement (§11A).** Recorded when the membership is Paid; defaults to the center's current date when it becomes Paid. Not present in the baseline. | Enhancement |
| Notes | Optional, ≤ 1000. | App |
| Cancelled at | Set once by Cancel; never cleared. | DB |

### 10.2 Membership status (derived, never stored)

| Status | Condition (evaluated on the center's current date) |
|---|---|
| Cancelled | Has been cancelled — overrides everything else. |
| Upcoming | Today is before the start date. |
| Active | Today is between start and end, both inclusive. |
| Expired | Today is after the end date. |

A further list-level indicator, **Expiring Soon**, marks an Active membership
with 7 or fewer days left. *(App, Test)*

### 10.3 Actions

| Action | Behaviour | Evidence |
|---|---|---|
| Add | From the Memberships list (select student), from Student Details, or within Add Student. | App |
| Edit | Plain save of all editable fields. Available for every membership, including cancelled ones. | App |
| Renew | Always creates a **new** membership; the previous one is untouched. Defaults: start = previous end + 1 day, same plan; amount carried over only if the previous one was priced in the current center currency, otherwise left blank. | App, Doc |
| Cancel | Review → Confirm. Record retained. Cannot be cancelled twice. **Cannot be undone.** Does not affect enrollments. | App, DB |
| Delete | **Not possible.** | DB |
| Receipt | **Baseline:** printable receipt generated on demand from the membership, the student and the center profile (nothing stored), with the membership ID as the receipt number. Includes a click-to-chat WhatsApp link pre-filled with the receipt details — a plain link, not an integration. **Enhancement (§11A):** replaced and extended by a stored Invoice / Receipt. | App, Doc |

### 10.4 Business rules

- **No overlapping memberships.** A student cannot hold two non-cancelled
  memberships whose dates overlap (inclusive). Cancelled memberships are
  ignored by this rule. Enforced in the database, so it holds under
  concurrent use. *(DB, App)*
- **Payment status does not affect membership status or eligibility.** A
  Pending membership is fully valid for attendance. *(Doc, App)*
- **Cancellation only affects the future.** For eligibility, a membership
  counts on session dates strictly **before** the center-calendar day on
  which it was cancelled. Cancelling today never removes eligibility from a
  session that already happened. *(DB, Test)*
- Expired and cancelled memberships remain in history. *(DB)*
- Covered batch enrollments are derived from date overlap; nothing is stored.
  *(App)*
- **Enhancement (§11A):** once an invoice has been issued for a membership,
  Paid → Pending is prevented; the issued invoice is preserved.
  *(Enhancement)*

---

## 11. Payment Management

*Baseline description. Where the V1 Invoice / Receipt Enhancement changes a
row, it is marked and detailed in Section 11A.*

V1 has **no payment entity**. Payment is recorded only as an attribute of
the membership.

```text
Student
  ↓
Membership  ── Amount, Currency, Payment Status (Paid / Pending)
```

| Aspect | V1 behaviour | Evidence |
|---|---|---|
| Payment record / transaction | **Not supported.** No separate payment table, no method, no partial payments. (The baseline also had no payment date; the Enhancement adds a payment date as a membership attribute, not a payment record — §11A.) | DB |
| Payment status | Paid / Pending on the membership; editable via Edit Membership. | DB, App |
| Effect on eligibility | **None.** | Doc, App |
| Online payment gateway | **Not supported.** | Doc |
| Automatic billing / reminders | **Not supported.** | Doc |
| Tax, discount, invoice numbering | **Baseline: not supported;** the membership ID acts as the receipt number. **Enhancement (§11A):** a stored Invoice / Receipt with its own sequential invoice number and configurable tax-inclusive tax. Discount remains not supported. | App, Enhancement |
| Revenue reporting | **Not supported.** | Doc |
| Filtering | Memberships list can be filtered by payment status. | App |

The relationship "Student → Membership → Payment" therefore exists in V1
only as **Student → Membership (with payment status)**. The Enhancement adds
a stored Invoice / Receipt beside the membership; it does not add a payment
entity (§11A).

---

## 11A. V1 Invoice / Receipt Enhancement

**Status.** Approved and documented; not yet implemented. A later V1
enhancement to the working application. The baseline in Sections 1–25 is not
rewritten: the original V1 generated a receipt on demand and stored nothing.
Existing students, memberships, attendance, batches, schedules, instructors
and every other working behaviour are unchanged. *(Enhancement)*

**Purpose.** Give every paid membership a stored, numbered Invoice / Receipt
that preserves what was issued, and that can be viewed, edited (number and
date only), printed, downloaded as a PDF and shared. It is a simple V1
document feature, not accounting software. *(Enhancement)*

**Who.** Issuing, viewing and editing an invoice are Admin only, matching
the existing V1 receipt behaviour. Instructors have no access to invoices.
*(Enhancement)*

**Relationship.** Membership 1 : 0..1 Invoice — a membership has zero or one
issued invoice. V1 does not support multiple invoices per membership, payment
transactions, partial payments, refunds or credit notes. *(Enhancement)*

### 11A.1 Document

- The existing on-demand receipt is replaced and extended by a stored
  Invoice / Receipt.
- One document is presented as an Invoice or a Receipt according to the
  configured document title (Invoice or Receipt; the intended default for the
  current client is Invoice). There are no separate Invoice, Receipt and Tax
  Invoice systems.
- Business identity (center name, address, phone, email, logo) continues to
  come from the Center Profile and is not duplicated in the invoice settings.

### 11A.2 Invoice number

| Rule | Detail |
|---|---|
| Generation | Automatic, sequential, unique. |
| Continuity | The client already uses invoice numbers, so the sequence continues from them. Example only: last existing number 1223 → Starting Invoice Number 1224 → first new invoice 1224, then 1225, 1226… The actual number is configured for the client during implementation; 1223 is not assumed. |
| Scope of the sequence | Global within this V1 instance, which has one implicit center. |
| Format | A plain number with no prefix (not, for example, `RCT-`). |
| Existing numbers | Never renumbered or changed. A new sequence is not started. |
| Starting Invoice Number | Configured in Settings (Section 17). It must never be able to cause a duplicate invoice number. |
| Correction | Admin can edit the number when a genuine correction is required; it must stay unique. |

### 11A.3 Payment date and invoice date

- A Paid membership has a **payment date**. When a membership becomes Paid it
  defaults to the current date in the center time zone (Section 18).
- Memberships already Paid before the Enhancement have **no reliable
  historical payment date**. None is invented. They receive an invoice only
  through an explicit **Issue Invoice** action, where the Admin confirms the
  required invoice/payment date.
- The **invoice date** is stored, defaults to the payment date when the
  invoice is issued, and can be edited by Admin. It does not otherwise change.

### 11A.4 Stored document and snapshot

An issued invoice stores its number, its date and its financial values, and
preserves the customer and business information, the tax information and the
terms and signatory information used when it was issued. Later changes to the
Center Profile, tax settings, terms, logo, signature or the student's details
do not change an issued invoice. *(Enhancement)*

### 11A.5 Editing an issued invoice

Admin Edit is deliberately limited to the **invoice number** and the
**invoice date**. Customer identity, membership amount, membership dates, tax
values, business identity and the rest of the issued content are not editable
through it. No accounting correction workflow exists. *(Enhancement)*

### 11A.6 Tax

Tax can be enabled or disabled, with a configurable tax name and rate. V1
uses a **tax-inclusive** model: the membership amount is the customer's final
amount, and when tax is enabled the tax is calculated (back-calculated) from
it. The tax used is preserved in the invoice. *(Enhancement)*

### 11A.7 Paid → Pending

Once an invoice has been issued for a membership, the issued invoice is
preserved and never silently invalidated. There is no refund, void or
credit-note handling in V1, so the application prevents an unsafe Paid →
Pending change after an invoice exists. The exact guard is an implementation
matter. *(Enhancement)*

### 11A.8 Invoice actions

View, Edit (number and date), Print, Download PDF, and Share / WhatsApp.
WhatsApp is **not** a WhatsApp Business API integration. `wa.me` cannot attach
a file; where supported the Web Share API may share the generated PDF, and
otherwise a PDF download plus text sharing may be used. The PDF technique is
an implementation decision. *(Enhancement)*

### 11A.9 Not included

Partial payments; payment methods; a payment transaction table; multiple
payments against one membership; online payment gateway; automatic billing;
refunds; credit notes; full or revenue accounting; a payment history system;
a financial ledger; multi-center or multi-organization billing.

---

## 12. Schedule Management

**Purpose.** Define when each batch meets, who teaches, and from when to
when, so that class sessions can be identified without manual entry.
*(Doc)*

**Who.** Admin only. *(App, DB)*

### 12.1 Schedule information

| Field | Rule | Evidence |
|---|---|---|
| Batch | Required; cannot be changed after creation. | DB, App |
| Instructor | Required; only Active instructors offered. | DB, UI |
| Day of week | One weekday per schedule. | DB |
| Start / end time | End must be after start. End defaults to start + 60 minutes and is editable. | DB, App |
| Effective from | Required. | DB |
| Effective until | Optional (open-ended); not before effective from. | DB |
| Status | Active / Inactive. | DB |

### 12.2 Schedule series and versions

```text
Schedule Series  ("the Monday 6:00 AM Hatha Yoga General class")
  ├── Version 1  effective 01 Jan – 31 Mar   (instructor A, 6:00–7:00)
  └── Version 2  effective 01 Apr – open      (instructor B, 6:00–7:00)
```

- Every schedule belongs to a series. Editing never creates a new series.
  *(DB)*
- Students are assigned to the series; sessions remember the exact version
  they came from. *(DB, Doc)*

### 12.3 Creating

Add Schedule accepts several weekdays and several time slots at once. Every
day × time-slot combination becomes its own independent schedule (and its
own series). *(App)*

### 12.4 Editing — three paths

| Situation | Behaviour | Evidence |
|---|---|---|
| **Unused schedule** (no stored session of any status, only one version, no assignment that has started) | Corrected **in place**: day, time, instructor and dates may all change; no effective date needed. Students with not-yet-started assignments move with it. | DB, App, Test |
| Used, and the new effective date is **after** the current version's start | Current version closed the day before; a new version starts on the chosen date. | App |
| Used, but the new effective date is **on or before** the current version's start (not started yet) | Updated in place. | App |
| New effective date **before today** | **Rejected.** | App |

A used schedule never changes its weekday; ticking extra days on Edit creates
additional new schedules. *(App)*

### 12.5 Deactivating and deleting

| Action | Behaviour | Evidence |
|---|---|---|
| Deactivate | Sets an effective-until date (defaults to today, editable, must not be before effective from) and marks the schedule Inactive. Cannot be repeated. **No reactivate** — a new schedule is added instead. | App |
| Delete | Only an **unused** schedule. Before confirming, the Admin sees how many students hold unstarted assignments and how many past dates were never recorded and will disappear. Unstarted assignments are withdrawn with it. The check is repeated inside the delete itself, so a session recorded meanwhile blocks it. | DB, App, Test |

### 12.6 Rules

- Overlapping schedules (same batch or same instructor, same day and time)
  are **allowed** and shown side by side. *(Doc, DB)*
- A schedule whose effective period has ended keeps its stored status; any
  "ended" indication is derived. *(Doc, App)*
- Schedule changes never alter stored sessions (Section 13.4). *(DB)*

---

## 13. Class Sessions

**Purpose.** A class session is one dated occurrence of a schedule — the
record attendance attaches to. *(Doc)*

### 13.1 Projection and materialization

```text
Schedule ──(calculated on the fly)──► Projected occurrence (nothing stored)
                                           │
                    first of: Edit This Session │ Cancel / Holiday │ Save Attendance
                                           ▼
                                   Stored (materialized) session  — snapshot taken
```

- Occurrences are **calculated** from schedules for display; nothing is
  stored just by looking. *(App, DB)*
- A session is **stored** only on its first session-specific edit, its first
  Cancel / Holiday, or its first attendance save. *(App, DB)*
- At most one stored session per schedule per date. *(DB)*
- There are **no ad-hoc sessions**: every session comes from a schedule.
  *(Doc, DB)*
- Sessions have **no product-facing ID**; they are addressed by
  schedule + date. *(Doc)*

### 13.2 Session status

| Stored | Displayed |
|---|---|
| `scheduled` | **Upcoming** before start time; **Ongoing** from start through end time; **Completed** after end time (display only — nothing is written). |
| `completed` | **Completed** — only ever set by saving attendance. |
| `cancelled` | **Cancelled** |
| `holiday` | **Holiday** |

All time comparisons use the center's time zone. *(DB, App, Test)*

### 13.3 Session actions

| Action | Who | Allowed when | Changes | Evidence |
|---|---|---|---|---|
| Edit This Session | Admin | Displayed status is **Upcoming** | Instructor and/or start/end time of this one date. Date and batch cannot change. Writes nothing if nothing changed. | App, Test |
| Mark Cancelled / Holiday | Admin | Stored status is still `scheduled` (whatever it displays) | Status + optional note (≤ 500). **Irreversible.** Recurring schedule unaffected. | App |
| Take / save attendance | Admin; owning Instructor | Not cancelled/holiday; session date is today or earlier | See Section 14. | DB |

Because saving attendance sets `completed`, a session with attendance can no
longer be cancelled or marked holiday. *(App)*

### 13.4 Snapshot and historical integrity

When stored, a session captures its batch, instructor, date and times. From
then on later schedule edits, versions or deactivation never change it; only
Edit This Session can, and only while it is Upcoming. Stored sessions are
never deleted. *(DB, Doc)*

### 13.5 Session lists

- **Today / All Sessions** combine stored and calculated occurrences without
  duplicates. All Sessions defaults to today through the next 90 days; filters:
  date range, batch, instructor, displayed status, search. *(App)*
- Calculation is bounded by each schedule's effective dates, not its status.
  Deactivation works because it sets an end date. *(App)*

---

## 14. Attendance Management

**Purpose.** Record, quickly, who was Present or Absent at each session.
*(Doc)*

### 14.1 Statuses

| Status | Stored? |
|---|---|
| Present | Yes |
| Absent | Yes |
| Unmarked | **No** — an eligible student with no record is unmarked. |

There is no online/offline mode, late, excused or partial status. *(DB, Doc)*

### 14.2 Eligibility — who appears on the roster

A student is eligible for a session only if **all four** hold, evaluated on
the **session's own date** (never "today") *(DB, Doc, Test)*:

| # | Condition |
|---|---|
| 1 | The student is **Active** (current status). |
| 2 | The student has an **Active enrollment in the session's batch** whose dates cover the session date. |
| 3 | That enrollment has a **schedule assignment to the session's schedule series** covering the session date. |
| 4 | The student has a **membership covering the session date** that had not been cancelled before that date. |

The batch used is the session's own (snapshot) batch. If a student has several
qualifying memberships, the roster displays one (not cancelled preferred,
then most recently started); this affects display only. *(DB)*

### 14.3 Saving attendance

```text
Open session → roster of eligible students (all Unmarked initially)
   → mark individually / "Mark All Present" / change marks
   → Save
        ├─ session stored if needed (snapshot of batch, instructor, times)
        ├─ (first save only) eligible list frozen permanently
        ├─ every submitted student re-checked as eligible — any failure rejects the whole save
        ├─ Present / Absent upserted (one record per student per session)
        └─ session status → completed
```

All steps after the session is stored happen as **one atomic database
operation**. *(DB)*

| Rule | Evidence |
|---|---|
| Rejected for Cancelled or Holiday sessions. | DB |
| Rejected for a session dated after today (center time zone). | DB |
| **No lower date limit**: attendance can be taken for any past occurrence of a schedule. | DB, App |
| Saving with some or all students unmarked is allowed and still completes the session. | DB, Doc |
| A student may be marked only once per save; at most one record per student per session. | App, DB |
| Records are never deleted. A student left out of a later save keeps their existing mark. | DB |
| An instructor may save only for sessions whose stored instructor is them. | DB |

### 14.4 Correcting attendance

- Admin can correct any completed session; an Instructor only their own.
  *(DB, App)*
- Corrections update the existing record in place; there is a Review Changes
  step before saving. *(App)*
- Corrections are validated against the **frozen** eligible list, so a
  student who has since left the batch can still be corrected. *(DB)*
- It is **not possible** to add a student who was not on the frozen list to a
  completed session (no mechanism exists; recorded as an undecided item).
  *(DB, Doc)*

### 14.5 Summary figures

| Figure | Rule |
|---|---|
| Eligible | Size of the (frozen or live) eligible list. |
| Present / Absent | Count of records. |
| Unmarked | Eligible − all records, never below zero. |
| Attendance % | **Present ÷ Eligible × 100** (not ÷ marked). Zero eligible shows **0%** on session screens. |

*(App, DB)*

---

## 15. Attendance History

**Purpose.** Review what already happened, read-only by default, with an
explicit Edit for corrections. *(Doc)*

| Aspect | V1 behaviour | Evidence |
|---|---|---|
| Who | Admin (all), Instructor (own sessions). | App, DB |
| What is listed | **Only stored sessions with status `completed`.** Cancelled, holiday and never-recorded occurrences do not appear. | App |
| Default range | No default limit (whole history). | App |
| Order | Newest first. | App |
| Filters | Date range, batch, instructor (Admin only), attendance status, free-text search (student name, batch, instructor). | App |
| Student filter | Implemented as free-text search by student name, not a dedicated student picker. For an instructor, student-name search does not match (students are not visible to instructors outside a roster). | App, DB |
| Detail | Per-session roster from the frozen eligible list with each mark. | App |
| Edit | Edit → Review Changes → Confirm & Save. | App |
| Batch-scoped view | Batch Details → Attendance tab reuses this list for one batch. | App |
| Student-scoped view | Student Details → Recent Attendance. | App, Test |

### 15.1 Historical integrity

History survives a student changing or leaving a batch, a membership
expiring or being cancelled, a batch being deactivated, and a schedule
changing, because both the session details and the eligible list are frozen
when attendance is first saved. *(DB, Doc)*

---

## 16. Dashboard and Reports

### 16.1 Dashboard

| Element | Admin | Instructor | Rule |
|---|---|---|---|
| Active Students | Yes | — | Count of students with stored status Active. |
| Active Batches | Yes | — | Count of batches with **stored** status Active. |
| Today's Classes | Yes | Yes | All occurrences today (stored + calculated); instructor sees own. |
| Attendance Marked | `marked / total` | "Completed" + "Remaining" | Counts sessions whose **stored** status is `completed` — not those merely displayed as Completed by the clock. |
| Today's class list | All | Own | Time, batch, instructor (Admin), counts, status, link to attendance. |
| Upcoming classes | Next 6 days | Next 6 days (own) | |
| Calendar | Yes | Yes (own) | Days with sessions; links to that day's sessions. |
| Recent Activity | Yes | — | Latest 4 of: attendance saved, student added, membership created — read from the records, no activity log. |

No charts, trends or analytics are built. *(App)*

### 16.2 Reports (Admin only)

All three reports cover **completed sessions only**, use **inclusive** date
ranges (both dates required), and read eligibility from the frozen lists.
*(App, DB)*

| Report | Filters | Shows |
|---|---|---|
| Student Attendance | Student, date range | Sessions the student was eligible for (or holds a mark for); Present, Absent, Unmarked; attendance % = present ÷ eligible sessions; per-session table. |
| Batch Attendance | Batch, date range | Sessions, eligible total, present, absent; **Average Attendance = pooled** present ÷ pooled eligible (not a mean of per-session %); per-session table. |
| Attendance Summary | Date or date range | Total sessions, present, absent, overall attendance % (pooled), per-session table across all batches. |

| Rule | Evidence |
|---|---|
| Unmarked is never counted as Absent. | App |
| When nothing is eligible, the percentage is **blank / "—"**, not 0% (deliberately different from session screens). | App |
| Export: **CSV** and **Excel (.xlsx)** of the full filtered result, same figures as on screen. | App |
| Center profile details are **not** included in exports. | App |
| Google Sheets export / sync: **not built**. | App |

---

## 17. Settings and Configuration

| Tab | Content | Rules | Evidence |
|---|---|---|---|
| Center Profile | Name (required, ≤ 100), logo, address (≤ 300), phone (digits), email | Exactly **one** center profile can exist; it cannot be created or deleted from the app. The name and logo appear in the application shell and on receipts. | DB, App |
| Regional Settings (part of Center Profile) | Time zone (IANA, default Asia/Kolkata), currency (ISO 4217, default INR) | Invalid zones/codes rejected. Time zone governs every business date (Section 18). Changing currency **never converts** existing amounts; each membership keeps its own currency. | DB, App, Test |
| Invoice / Receipt *(Enhancement, §11A)* | Starting Invoice Number; tax enabled/disabled, tax name, tax rate; Terms & Conditions; signatory name and designation; signature image; document title (Invoice or Receipt; default Invoice for the current client). | A new Settings area. Business identity comes from Center Profile and is not duplicated. Changing these settings affects only invoices issued afterwards. | Enhancement |
| Instructors | See Section 7. | | |
| Roles & Permissions | Read-only description of Admin and Instructor access; Change Password card for the signed-in Admin. | No role configuration. | App |

Any signed-in user (including an Instructor) can read only the center name,
logo, time zone and currency — not its address, phone or email. *(DB)*

---

## 18. Timezone and Business Date Rules

| Rule | Evidence |
|---|---|
| The **center's time zone** (one setting, default Asia/Kolkata) defines "today" and "now" everywhere. It never depends on the user's browser or device. | DB, App, Test |
| Daylight-saving rules come from the IANA time zone database. | Test |
| Session, membership, enrollment, assignment and schedule dates are **calendar dates** (no time of day). | DB |
| Session Upcoming / Ongoing / Completed display compares the center's current date-time to the session's date + start/end time. | App, Test |
| Membership status uses the center's current date; both ends inclusive. | App, Test |
| Attendance eligibility compares dates to the **session date**, never today. | DB, Test |
| "Future session" for attendance means session date after the center's today. | DB |
| A membership cancellation timestamp is converted to a **center calendar date** to decide which sessions it affects. | DB |
| Schedule edit and schedule-change dates cannot be before the center's today. | App |
| "Unstarted" assignments (deletable) are those starting on or after the center's today. | DB |
| There is no per-user, per-batch or per-schedule time zone. | Doc |

Minor exception: the "date of birth cannot be in the future" check uses the
server's UTC date rather than the center date. *(App)*

---

## 19. Authorization and Security Rules

| Rule | Evidence |
|---|---|
| Every page and every action checks the user's role on the server; hiding a menu item is not the security boundary. | App |
| Every data table is protected by row-level security: Admin rows for admins; instructor rows only for their own sessions, schedules, batches taught and attendance. | DB |
| Instructors have **no direct write permission** on any table. Their two writes (storing a session, saving attendance) go through database functions that check ownership. | DB |
| Signed-out visitors can read nothing. | DB |
| The application role can never be set by the user; new accounts are always Instructor. | DB |
| No record of a historical entity can be deleted by any role. The only deletes are: unused schedules (through a checked function) and unstarted schedule assignments. | DB |
| Sign-in errors and password-reset responses do not reveal whether an account exists. | App |
| Changing a password inside the app requires the current password. Minimum password length is 8. | App, Test |
| Photos and logos are publicly readable by URL but only admins can upload, replace or remove them. | DB |

---

## 20. Core Business Workflows

### 20.1 Onboard a student (Admin)

```text
Students → Add Student → Save
   → Add Membership (or Skip)
   → Add Batch Enrollment (batch + at least one schedule)
   → Student Details (completion)
```

### 20.2 Create a batch and its timetable (Admin)

```text
Batches → Add Batch → Batch Details → Add Schedule
   (days × time slots, instructor, effective from) → one schedule per combination
```

### 20.3 Take attendance (Instructor or Admin)

```text
Dashboard / Attendance → Today's session → Take Attendance
   → mark Present / Absent (or Mark All Present) → Save
   → session Completed; eligible list frozen
```

### 20.4 Correct attendance

```text
Attendance History → session → Edit → change marks → Review Changes → Confirm & Save
```

### 20.5 Change a recurring class (Admin)

```text
Schedule → Edit
   ├─ unused → corrected in place
   └─ used   → choose effective date (≥ today) → old version closed, new version from that date
```

### 20.6 Change one session (Admin)

```text
Session Details → Edit This Session (Upcoming only) → instructor / time → Save
Session Details → Cancel / Holiday → optional note → Confirm (irreversible)
```

### 20.7 Change which classes a student attends (Admin)

```text
Student Details → Edit Enrollment → change schedule selection
   → schedule change date (≥ today) → removed: closed / withdrawn; added: start on that date
```

### 20.8 Renew / cancel a membership (Admin)

```text
Membership Details → Renew → new membership (start = previous end + 1) → Save
Membership Details → Cancel → Review → Confirm   (record kept, irreversible)
```

### 20.8A Issue an invoice (Admin) — Enhancement, §11A

```text
New:      Membership → Payment Status = Paid → payment date (defaults to today at the center)
             → invoice issued → stored invoice → View / Edit / Print / PDF / Share
Existing: Existing Paid membership → Issue Invoice → Admin confirms the required
             invoice/payment date → stored invoice
```

### 20.9 Give an instructor access (Admin)

```text
Settings → Instructors → Add Instructor (with email, Active)
   → Provide Login Access → invitation email → instructor sets password → signs in
   → assign to schedules
```

---

## 21. Business Rules and Validations

Consolidated register. Section numbers point to the detail.

| # | Rule | Where enforced | § |
|---|---|---|---|
| R1 | Only Admin and Instructor roles exist; new accounts are always Instructor. | DB | 4 |
| R2 | Student ID `YC-000001` and Membership ID `MEM-000001` are generated, unique and immutable. | DB | 6, 10 |
| R3 | Batch short code is required and unique (case-insensitive); stored upper-case. | DB, App | 8 |
| R4 | Instructor email is unique when present; student phone/email are not unique. | DB | 6, 7 |
| R5 | One active enrollment per student per batch. | DB | 9 |
| R6 | An enrollment must have at least one schedule assignment, all from its own batch. | App | 9 |
| R7 | Schedule-change dates and schedule edit dates cannot be before today. | App | 9, 12 |
| R8 | No overlapping non-cancelled memberships per student. | DB | 10 |
| R9 | Membership end ≥ start; amount > 0; payment defaults to Pending. | DB, App | 10 |
| R10 | Membership status is derived; cancellation overrides; cancellation is one-way. | App, DB | 10 |
| R11 | Payment status never affects eligibility. | App | 10, 11 |
| R12 | Schedule end time > start time; effective until ≥ effective from; every schedule has a batch and an instructor. | DB | 12 |
| R13 | Overlapping schedules are allowed. | DB | 12 |
| R14 | Used schedules are versioned or deactivated, never edited in place or deleted; unused schedules may be corrected or deleted. | DB, App | 12 |
| R15 | At most one stored session per schedule per date; no ad-hoc sessions. | DB | 13 |
| R16 | Only Upcoming sessions can be edited; only `scheduled` sessions can be cancelled / marked holiday; both irreversible for history. | App | 13 |
| R17 | Stored status `completed` is set only by saving attendance. | DB | 13, 14 |
| R18 | Eligibility = active student + active enrollment + schedule assignment + covering membership, on the session date. | DB | 14 |
| R19 | No attendance for future, cancelled or holiday sessions. | DB | 14 |
| R20 | Saving may leave students unmarked and still completes the session. | DB | 14 |
| R21 | One attendance record per student per session; never deleted. | DB | 14 |
| R22 | The eligible list is frozen on first save and never changes. | DB | 14, 15 |
| R23 | Attendance % = Present ÷ Eligible. | App, DB | 14, 16 |
| R24 | One center profile; one time zone; one currency. | DB | 17, 18 |
| R25 | Nothing historical is deleted. | DB | 19 |
| R26 | *(Enhancement)* Invoice numbers are sequential and unique, continue from the configured Starting Invoice Number, and existing numbers are never renumbered. | Enhancement | 11A |
| R27 | *(Enhancement)* An issued invoice preserves its financial, customer, business, tax, terms and signatory information; later settings changes never alter it. | Enhancement | 11A |
| R28 | *(Enhancement)* Only the invoice number and date of an issued invoice are editable. | Enhancement | 11A |
| R29 | *(Enhancement)* Once an invoice is issued, an unsafe Paid → Pending change is prevented. | Enhancement | 11A |
| R30 | *(Enhancement)* No historical payment date is invented; already-Paid memberships get an invoice only through an explicit Issue Invoice action. | Enhancement | 11A |

---

## 22. Data Relationships

Only relationships present in the V1 database are shown.

```text
Sign-in account ─1:1─ Profile (role: admin | instructor)
Sign-in account ─0..1:0..1─ Instructor

Student ─1:N─ Batch Enrollment ─N:1─ Batch
Batch Enrollment ─1:N─ Schedule Assignment ─N:1─ Schedule Series ─N:1─ Batch
Schedule Series ─1:N─ Schedule (version) ─N:1─ Instructor
                                          ─N:1─ Batch

Schedule (version) ─1:N─ Class Session (stored)
Class Session ─N:1─ Batch        (snapshot)
Class Session ─N:1─ Instructor   (snapshot)
Class Session ─1:N─ Attendance ─N:1─ Student
Class Session ─1:N─ Frozen Eligible Student ─N:1─ Student

Student ─1:N─ Membership          (amount, currency, payment status)
Membership ─1:0..1─ Invoice       (Enhancement, §11A: stored document with its own snapshot)

Center Profile                    (single record; not referenced by other records)
```

| Relationship | Nature | Evidence |
|---|---|---|
| Membership ↔ Batch Enrollment | **No stored link.** Derived by date overlap for display. | DB |
| Payment | **Not an entity.** Attributes of Membership. (Enhancement: a payment date joins them; still no payment entity.) | DB |
| Membership ↔ Invoice | *(Enhancement, §11A)* An issued invoice belongs to one membership and carries its own snapshot of the information used; it does not follow later changes to settings, profile or student. | Enhancement |
| Center ↔ anything | **No link.** Single implicit center. | DB |
| Deletion behaviour | Every link restricts deletion; nothing cascades. | DB |

---

## 23. Edge Cases and Special Rules

### 23.1 Handled by V1

| Case | V1 behaviour | Evidence |
|---|---|---|
| Student moves to another batch on the same day as a recorded session | The recorded session keeps its frozen roster and marks. | DB |
| Membership cancelled after a session happened | Session stays eligible; only sessions on/after the cancellation day are affected. | DB, Test |
| Membership ends today vs. tomorrow across midnight UTC | Status flips at the center's midnight, not UTC midnight. | Test |
| Two people save attendance for the same session at once | Serialized by a lock; no duplicate records. | DB |
| Two people store the same session at once | Second request receives the first one's session. | DB |
| Schedule deleted while someone records a session | The delete re-checks and refuses. | DB |
| Session reassigned to another instructor | Access moves to the new instructor. | DB |
| Zero eligible students | Save allowed; session completes; 0% on session screens, "—" in reports. | DB, App |
| Mark for a student no longer in the eligible list | Kept as evidence; unmarked count floors at zero. | DB |
| Removing a schedule assignment that hasn't started | Withdrawn, not left as a one-day assignment. | DB, App |
| Centre currency changed | Old memberships keep their currency; renewal leaves amount blank if currencies differ. | App |
| Legacy phone numbers without a country code | Kept as stored; only unambiguous Indian mobile numbers were given `+91`. | DB |
| Multi-step saves that partly fail (enrollment + assignments, schedule close + new version) | Schedule versioning is rolled back on failure; an enrollment left with no assignment is flagged on screen. | App |

### 23.2 Sessions completed before the frozen-list feature

Sessions completed before migration `0015` were back-filled where evidence
existed. Any session with no frozen list still resolves eligibility live and
is labelled as such internally. Eligible-but-unmarked students lost from such
sessions are accepted as unrecoverable. *(DB, Doc)*

### 23.3 Current-status effects on unrecorded dates

Student status and enrollment status are **not date-ranged**. Deactivating a
student or an enrollment therefore removes them from the eligible list of
**every session not yet recorded — including past dates nobody recorded**.
Recorded sessions are protected by their frozen list. *(DB)*

### 23.4 Deactivations do not cascade

| Deactivated | Not changed automatically |
|---|---|
| Student | Enrollments, assignments, memberships |
| Batch | Its schedules (sessions keep being calculated), enrollments |
| Instructor | Their schedules (sessions keep being calculated); only an Admin can then record those sessions |
| Enrollment | Its schedule assignments (but eligibility stops because status is checked) |

*(App, DB)*

### 23.5 Other noteworthy behaviour

- Enrollment start/end dates can be edited freely, including into the past.
  *(App)*
- Schedule deactivation's effective-until date may be set in the past (only
  bounded by effective from), whereas schedule edits cannot be back-dated.
  *(App)*
- Cancelled memberships can still be edited and renewed. *(App)*
- An instructor can be invited only once; an existing account with the same
  email blocks the invitation. *(App)*

---

## 24. V1 Limitations / Out of Scope

| Not supported in V1 | Evidence |
|---|---|
| Multiple centers / branches; any center-level data separation | DB, Doc |
| Student login or self-service | Doc, DB |
| Roles other than Admin / Instructor; custom roles; role configuration | DB, Doc |
| Admin creation from the UI | DB |
| Revoking an instructor's login (other than deactivation) | App |
| Assigned Classes screen | App |
| Payment records, online payments, automatic billing, reminders | DB, Doc |
| *Baseline only:* invoices and tax — **superseded by the V1 Invoice / Receipt Enhancement (§11A)**, which adds a stored invoice and tax-inclusive tax. Still not supported: partial payments, payment methods, refunds, credit notes, full or revenue accounting, a financial ledger, multi-center billing. | Doc, Enhancement |
| Revenue, retention or advanced analytics; charts | Doc, App |
| Batch capacity | Doc |
| Online / offline attendance mode; statuses other than Present / Absent | Doc, DB |
| QR, face recognition, mobile app, AI features | Doc |
| WhatsApp / SMS / email integrations (only a click-to-chat / share workflow for receipts and invoices; no WhatsApp Business API) | Doc, App |
| Google Sheets export or sync | App |
| Center details in exported reports | App |
| Ad-hoc (non-scheduled) sessions | Doc, DB |
| Un-cancelling a session or a membership; reactivating a deactivated schedule | App |
| Adding a student to a completed session's frozen roster | DB, Doc |
| Audit log of who changed what | DB |
| Per-user / per-schedule time zone | Doc |

---

## 25. V1 Business Architecture Summary

| Layer | V1 position |
|---|---|
| Tenancy | One implicit center; single settings record. |
| Actors | Admin (everything), Instructor (own sessions' attendance). |
| Master data | Students, Instructors, Batches — deactivated, never deleted. |
| Commercial | Membership periods with amount, currency, paid/pending; no payment entity. *Enhancement (§11A):* payment date and a stored Invoice / Receipt per paid membership. |
| Membership in classes | Batch enrollment + schedule assignment, date-ranged. |
| Timetable | Versioned recurring schedules grouped into stable series. |
| Operations | Sessions calculated from the timetable, stored on first touch with a snapshot. |
| Attendance | Present/Absent against a computed, then frozen, eligible list; atomic save. |
| Insight | Dashboard counts, attendance history, three reports with CSV/Excel. |
| Time | One center time zone defines every business date. |
| Integrity | Database-enforced: no deletion of history, frozen rosters, snapshots, versioning. |

### Audit and history behaviour (summary)

V1 preserves **state history**, not an **action log**:

| Preserved | How |
|---|---|
| Past enrollments and assignments | Closed with end dates, never overwritten. |
| Past schedule versions | Closed and superseded, never deleted. |
| Past memberships | Renewal creates a new record; cancellation is a timestamp. |
| Session details | Snapshot at first touch. |
| Session roster | Frozen eligible list at first save, with provenance (save vs. back-fill). |
| Attendance | Updated in place on correction — **the previous value is not kept**. |
| Who made a change | **Not recorded** (only created/updated timestamps). |

---

## V1 → V2 Transition Notes

This section does **not** design V2. It only identifies how V1 concepts relate
to a future multi-center product.

### A. Single-center assumptions in V1

| Assumption | Where it lives |
|---|---|
| Exactly one center record can exist. | Center profile (singleton) |
| No record carries a center reference; "belongs to the center" is implicit. | Every table |
| One time zone for all business dates. | Center settings, eligibility, session status, membership status |
| One currency for new memberships. | Center settings |
| Student ID and Membership ID sequences are global. | ID generation |
| Batch short codes are unique across the whole system. | Batch rule R3 |
| Instructor emails are unique across the whole system. | Instructor rule R4 |
| "Admin" means admin of everything; there is no scoped admin. | Roles and data permissions |
| An instructor account maps to exactly one instructor record. | Instructor identity |
| One active enrollment per student per batch, and no overlapping memberships per student, are evaluated system-wide. | R5, R8 |
| Dashboard counts, reports and history cover all data. | Dashboard, Reports, History |
| Logo, photos and batch images share one storage area. | Storage |
| *(Enhancement)* The invoice number sequence is global within the V1 instance's one implicit center (a V1 fact, not a numbering design for V2). | Invoice numbering |

### B. V1 concepts likely to be affected

| Concept | Why it is likely affected |
|---|---|
| Center Profile / Regional Settings | Currently a single record holding the only time zone and currency. |
| Roles and permissions | Two global roles; data permissions are "admin sees all". |
| Student identity and Student ID | Students and their IDs are global to the one center. |
| Membership | Overlap rule, currency and ID sequence are system-wide. |
| Batch | Short-code uniqueness is system-wide. |
| Instructor | Email uniqueness and one-account-one-instructor link are system-wide. |
| Time-zone-dependent rules | "Today", session status, eligibility cut-offs and schedule date checks all read the one center time zone. |
| Dashboard, Reports, Attendance History | Aggregate across all data with no center dimension. |
| Settings → Roles & Permissions | Describes the fixed two-role model. |

### C. V1 concepts that appear reusable without change

These are defined without reference to a center and behave the same
regardless of how many centers exist (subject to V2 decisions):

| Concept |
|---|
| Separation of Student, Membership, Batch, Enrollment, Schedule Assignment, Schedule, Session, Attendance |
| Four-condition eligibility evaluated on the session date |
| Schedule series + versioning; unused-schedule correction/deletion rule |
| Projection and materialize-on-first-touch of sessions, with snapshot |
| Stored vs. displayed session status |
| Atomic attendance save; Present/Absent; unmarked not stored; completion on save |
| Frozen eligible list per session |
| Derived membership status; renewal as a new record; one-way cancellation |
| Date-ranged enrollments and schedule assignments; close-never-rewrite; withdraw-unstarted |
| "Deactivate, never delete" for historical entities |
| Report counting rules (pooled ratio, unmarked ≠ absent, completed sessions only) |
| Per-membership currency stamping |
| *(Enhancement, §11A)* Stored invoice document; immutable historical snapshot of business, customer and tax information; unique, configurable document numbering |

---

## Appendix A — Documentation vs Implementation Discrepancies

Resolved in favour of implemented behaviour, as instructed.

| # | Topic | Documentation says | V1 implementation | Resolution in this document |
|---|---|---|---|---|
| A1 | Phase status | `04-development-plan.md` lists Phases 16, 16A, 17, 18, 19 as "In progress / not committed". | Reports, Dashboard, Settings, regional settings are committed and in use. | Treated as implemented; plan table is stale. |
| A2 | Enrollment date protection | Plan Phase 16A step 6: enrollment / schedule-change dates should not conflict with existing attendance — "not yet built". | Not built. Enrollment dates are freely editable; schedule change only blocks dates before today. Recorded sessions are protected by frozen rosters instead. | Documented as current behaviour (§9, §23.5). |
| A3 | Assigned Classes | UX IA lists it for Instructors. | No screen; navigation entry hidden from everyone. | Listed as not built. |
| A4 | Center info in exports | Product §11: "can also be used in exported reports". | Not used in exports (used in app shell and receipts). | Listed as not supported. |
| A5 | Inactive student "from that point on" | Product §8: excluded from new eligibility from that point on. | Status is not date-ranged; unrecorded **past** sessions also lose the student. | Documented (§23.3). **Not confirmed** as intended. |
| A6 | "Active Batches" | Dashboard and Batches list both show "Active Batches". | Dashboard counts stored status; Batches list counts derived status (requires a current schedule). The numbers can differ. | Documented both (§8, §16.1). |
| A7 | "Active Students" caption | Dashboard tile caption: "Currently enrolled". | Counts students with Active status regardless of enrollment. | Documented actual rule. |
| A8 | Cancelled membership actions | Product: cancellation is final. | Edit and Renew remain available on cancelled memberships. | Documented; intent **Not confirmed**. |
| A9 | Schedule deactivation date | Product: changes apply to future sessions only. | Deactivation's effective-until can be a past date (edits cannot). | Documented; intent **Not confirmed**. |
| A10 | Batch / instructor deactivation | Product does not state effect on schedules. | Schedules continue; sessions keep appearing. | Documented; intent **Not confirmed**. |
| A11 | Inactive instructor experience | Code comments anticipate an "access disabled" screen. | Not built; instructor sees empty screens. | Documented (§5.3). |
| A12 | "At least one schedule assignment" | Product rule; plan asks whether app-level enforcement is acceptable (open item). | App-level only; partial failures flagged on screen. | Documented (§9). |
| A13 | Attendance History "Student" filter | Product §9 lists a Student filter. | Implemented as free-text search; not effective for instructors. | Documented (§15). |
| A14 | Google Sheets | Product §10: "may be supported". | Not built. | Listed as not supported. |
| A15 | Zero-eligible percentage | Product §8: 0%. | 0% on session screens; blank/"—" in reports (deliberate). | Documented both (§14.5, §16.2). |

## Appendix B — Evidence Sources

| Source | Used for |
|---|---|
| `supabase/migrations/0001`–`0024` | Entities, constraints, row-level security, eligibility, attendance save, snapshot, schedule deletion, regional settings |
| `lib/*/actions.js`, `lib/*/validation.js`, `lib/*/data.js` | Server-side rules, validations, derived statuses, reports |
| `app/**` route guards and pages | Role access, screen-level behaviour |
| `lib/**/*.test.js` (370 tests, all passing) | Time zone, membership validity, schedule usage, batch summary, session editability, settings validation |
| `supabase/verification/*` | Manual database verification scripts (not run as part of this audit) |
| `docs/01-product.md`, `docs/02-ux.md`, `docs/04-development-plan.md` | Intended rules, flows, open items |
