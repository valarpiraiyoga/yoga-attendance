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

A batch enrollment additionally carries one or more **schedule assignments**, which decide *which* of the batch's recurring schedules that student actually attends. Enrolling a student in a batch is therefore not by itself enough to make them eligible for every one of that batch's classes — see §4 "Schedule Assignment" and §8 "Eligibility".

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
Full management access to Dashboard, Students, Memberships, Documents, Batches, Schedule, Attendance, Attendance History, Reports, Settings, and Instructor management.

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
- Ongoing
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
- Tax invoice preference — the student's default for whether a payment is documented with a tax invoice; enabled by default (V1 Tax Adjustment, §5A "Tax Invoice Preference")

### Management
Admin can view, search, add, edit, activate/deactivate students, assign students to batches, change batch enrollments, and view attendance history.

### Multiple Batch Enrollment
A student can belong to multiple batches at the same time, supporting combo offers.

### Batch Changes
A student can change batches. Enrollment must retain effective start/end dates so historical attendance remains correct.

### Join Date and Start Dates
- An enrollment's effective start date and a membership's start date cannot be **before the student's join date**. The rule is judged when a record is created and when its start date is **changed**; any other edit of an existing record (status, end date, notes, payments) is never refused because the record already starts before the join date.
- A student's join date cannot be moved **later** than the start of an **active** enrollment or a **non-cancelled** membership. Inactive enrollments and cancelled memberships are history and do not block it. Moving the join date earlier is always allowed and is how an earlier start is corrected.
- Records that already start before their student's join date are not changed automatically; they stay as they are until the join date is corrected.
- **Editing an enrollment's start date** moves the schedule assignments that begin exactly on its **previous** start date to the new one, in the same save. An assignment added later by a schedule change, an assignment's end date, class sessions, attendance records, saved eligibility snapshots and frozen rosters are not changed. If the move would overlap another assignment of the same schedule, or leave an assignment ending before its start, nothing is saved. The save reports how many schedule assignments moved. Changing the batch is not a start-date move.

### Schedule Assignment
A batch may run several recurring schedules, including more than one on the same weekday (§6, §7). A student enrolled in that batch does not automatically attend all of them: the enrollment records which schedules that student attends.

- Schedule assignment belongs to the batch enrollment, not to the student directly. A student attending the same batch across two separate enrollment periods therefore has separate assignments for each.
- One enrollment may carry several schedule assignments at once — a student attending both the 6:00 AM and the 7:00 PM class of the same batch holds two.
- A batch enrollment should have at least one schedule assignment. An enrollment with none makes the student eligible for nothing, which is a configuration mistake rather than a meaningful state.
- Assignments are assigned to a schedule's stable identity (§7 "Schedule Series"), not to one particular version of it, so an admin editing a schedule's time or instructor never detaches the students who attend it.
- Overlapping times across a student's own assignments are not blocked, consistent with §7 "Conflicts".

### Schedule Assignment Effective Dates
Each schedule assignment carries an effective start date and an optional effective end date. There is no separate active/inactive flag: an assignment applies to exactly the dates its period covers.

Changing which schedule a student attends closes the existing assignment on the day before the change takes effect and creates a new assignment from that date. The earlier assignment is retained, never rewritten, so what a student was scheduled to attend on any past date can always be reconstructed — the same principle §7 applies to schedule versions and §5 applies to memberships.

The one exception is an assignment that has not started yet when it is removed — one whose effective start date is on or after the date the removal takes effect. It has no past to reconstruct and cannot be closed on the day before it starts, so it is withdrawn (deleted) rather than left as a one-day assignment that would still apply on the change date. An assignment that has already covered any past day is never deleted.

**Recorded attendance on the effective date.** Effective dates are date-only. An enrollment cannot start, and a schedule or batch change cannot take effect, on a date on which the student already has recorded class-session attendance - in any batch or series - because a change effective on a date and a session already attended that date cannot be ordered against each other. The Admin is asked to choose a later effective date. The rule applies to a new enrollment's start date, a changed start date and the schedule/batch effective date; it does not apply to end dates, status or instructor changes (a session keeps the instructor it was materialized with), and class-count attendance is not session-based and is not checked. It prevents new same-day conflicts; the saved eligibility snapshot of a completed session is what keeps already-recorded history immutable.

### Deactivation
Inactive students remain in the system. Deactivation does not remove historical student, membership, enrollment, or attendance records.

### Communication History *(migration 0057)*
Staff keep an internal, chronological record of their communications with a student. It is record keeping only: nothing is sent to the student, and there is no WhatsApp, phone or call-log integration, no notification or reminder, and no rating or assessment.

- **A communication** records when it happened (date and time, on the centre's clock; it can be an earlier conversation, but not a future one), its type (**Phone Call**, **WhatsApp**, **In Person** or **Other**), a short subject, the discussion notes, and the staff member who recorded it (taken from the signed-in user, never entered).
- **Optional follow-up.** A communication may carry one follow-up: a follow-up date (not before the communication's date) and a note describing the action to take. It starts **Pending**. Without a follow-up nothing is pending.
- **Completing a follow-up** marks it **Completed** and records when and by whom; its date and note are kept as recorded, and the follow-up stays linked to its communication. Completing creates no new communication: when staff actually contact the student again, they add a separate communication.
- **History** is shown newest first. Communications are not deleted in V1.
- **Editing** *(migration 0058)*. Staff can correct a communication's date and time, type, subject and notes, with the same rules as when it was recorded. A **pending** follow-up's date and note can be changed, or the follow-up removed; a follow-up can be added to a communication without one. A **completed** follow-up records what was done, so it cannot be changed or removed: its date, note, status, completion time and who completed it stay as they are. The original record keeps its identity, who recorded it and when; the edit records who last edited it and when (earlier values are not kept).
- **Access.** An Admin, for every student. The database also allows an Instructor for the students they are authorized for (a current active enrollment and assignment on a series they teach, or attendance on a session they own); in V1 it is shown on Student Details, which is Admin only, so Instructors have no screen for it yet.

---

## 5. Memberships

### Purpose
Manage the student's valid membership period and use it as part of attendance eligibility.

### Plans
- Monthly
- Quarterly
- Half Yearly
- Annual
- Custom duration

*(V1 Fee Structure.)* These five are the plans of memberships created before the centre-configurable fee structure — **legacy memberships** — and they stay on those memberships exactly as they are. A new membership or renewal is created from one of the centre's packages (see "Packages and Fee Structure" below) and is a **package-linked membership**; a package-linked duration membership still records its duration option (Monthly, Quarterly, Half Yearly, Annual or Custom) as its Plan.

### Packages and Fee Structure
*(V1 Fee Structure.)* The centre configures what it sells (Settings, §11); the application assumes no fixed price list.

**Packages.** A package has a name, an optional description and one of exactly two types. There is no separate frequency field: a duration-based package is described by its duration options, a class-count package by its class allowance, and class scheduling stays separate (§7).
- **Duration-based** — has a **monthly base fee** and offers one or more **duration options**: the standard options Monthly (1 month), Quarterly (3), Half Yearly (6) and Annual (12), and **Custom**, a whole number of calendar months. Quarterly, Half Yearly and Annual may each have a **package discount**; Monthly never has one, and Custom uses the discount of a standard option (see "Standard fee and package discount").
- **Class-count** — gives a number of classes (its **class allowance**) for its own **independent price**. It defines no validity: the expiry is chosen for each membership (see "Class-Count Packages").

**Package lifecycle.**
- Packages are reusable. A package can be **deactivated**, which prevents new purchases (new memberships and renewals) but keeps every existing membership and its history; it can be **reactivated**. A renewal on a deactivated package requires the Admin to reactivate it first.
- A package that has been used by a membership cannot be deleted, and its type cannot change.
- Editing a package's name or description never rewrites how existing memberships are shown: each membership stores a **snapshot of the package name** it was created with.
- Changes to a package's terms — its duration options or its class allowance — apply to **future purchases only**; existing memberships keep the terms they were created with. These changes are recorded for audit (who, when, before and after). V1 does not keep a separate effective-dated version history for package terms; only fees are effective-dated (below).

**Standard fee and package discount.**
- A duration option's **standard fee** is the monthly base fee multiplied by its number of months (for example ₹1,500 × 3 = ₹4,500 for Quarterly). For **Custom** it is the monthly base fee multiplied by the selected whole number of calendar months. No fixed-day calculation is used.
- A **package discount** is either a fixed amount or a percentage, calculated against the standard fee. It does not require a reason. Monthly has no package discount.
- **Custom duration.** The Admin selects the number of whole calendar months **when creating the membership**; it is not limited to a length configured in advance on the package. Standard fee = monthly base fee × the selected months.
- **Custom duration discount.** A Custom duration uses the package discount of the **largest standard duration that does not exceed the selected number of months**: 2 months → Monthly (no package discount), 5 months → Quarterly, 7 months → Half Yearly, 10 months → Half Yearly, 12 months or more → Annual. If that standard duration has no package discount configured, **no package discount** applies; no other duration's discount is used instead. Any individual discount is applied afterwards, by the same calculation and rounding rules as for the standard options.
- A class-count package's standard fee is its own price.

**Effective-dated fee history.**
- Each package's fees — the monthly base fee and the package discounts of a duration-based package, or the price of a class-count package — are kept as a fee history of entries, each with an effective-from date. Several future entries may be scheduled. No two entries of one package have the same effective date, so the fee in force on any date is unambiguous.
- A scheduled entry can be edited or cancelled before it takes effect. An entry in effect is never silently overwritten: a correction requires a reason. Scheduling, editing, cancelling and correcting are all kept in an audit record (who, when, before and after, reason).
- A fee-history change **conflicts** when it would change which fee entry applies to an existing membership's start date. A conflicting change is **blocked**: the affected memberships and their agreed fees are shown, and the change cannot proceed until each affected membership is explicitly resolved. Blocking never reprices a membership and never alters a payment or an issued document.
- Correcting a package's fee affects future pricing only. Correcting an existing membership's fee is a separate, explicit action (see "Existing memberships").

**Pricing a membership.**
- A membership — new or renewal — is priced with the fee entry in effect on its **start date**. The creation date, the payment date and the end date do not affect which fee applies.
- The order is: **standard fee → package discount → individual discount → final agreed fee**. For example: ₹1,500 × 3 = ₹4,500, less a ₹300 package discount and a ₹200 individual discount, gives a final agreed fee of ₹4,000.
- **Individual discount.** An Admin may apply an individual discount to a membership, as a fixed amount or a percentage of the fee remaining after the package discount. It requires a reason — **Promotional Offer**, **Returning Member**, **Special Approval** or **Other**; Other requires an explanation. Before the membership is created the discount and its reason can be changed freely; afterwards only by an authorized, audited correction. A renewal never inherits an individual discount. There is no approval workflow in V1.
- **Rounding.** Each discount calculation is rounded half up to two decimal places, and the final agreed fee is the result of those rounded steps. Tax is not affected: it is still back-calculated from the final amount exactly as in §5A.
- **Limits.** The combined package and individual discounts cannot exceed the standard fee, and the final agreed fee must be **greater than ₹0** (greater than zero in the centre's currency). V1 has no other, configurable minimum.
- **Currency.** A new membership is priced with a valid fee in the centre's **current** currency: a fee entry in another currency is not a valid standard fee, and fees are never converted automatically. The membership records the centre's currency at the time it is created (§11 "Regional Settings"); a later currency change never converts or reprices it, and existing memberships keep their original currency and agreed fee.
- **Custom Fee Plan.** Standard package pricing is the default. The Admin may explicitly choose a **Custom Fee Plan** instead of standard fee resolution — for a special price even when a standard fee exists, or when no valid standard fee applies to the selected start date. It requires a custom agreed fee (greater than ₹0), a mandatory reason and explicit confirmation before the membership is created, and records the Admin and the time. After creation the agreed fee, currency and terms are preserved like any other membership's; payments and issued documents are never changed silently, and correcting the agreed fee is the separate, authorized, audited correction (see "Existing memberships"). The Custom Fee Plan amount **is the final agreed fee**: no package discount and no individual discount is applied on top of it, and a Custom Fee Plan is never reinterpreted as a standard package fee.

**Amount.** The membership's Amount is the final agreed fee: the amount payable. It is the customer's final amount, as in §5A, and it is independent of the amount paid so far.

**Existing memberships.**
- A package-linked membership keeps the fee, package discount, individual discount, terms and currency it was agreed with. Later changes to the package or its fees — a new fee entry, a term change, deactivation — never alter it, and it is never repriced automatically.
- Changing an existing package-linked membership's agreed fee, discounts or terms is a separate, authorized, audited action requiring a reason. If its start date is changed, the fee in effect on the new start date is resolved and the revised price is shown for confirmation before anything is saved. Payments and issued documents are never adjusted silently: payments follow the payment-editing rules (§5 "Payments") and documents the cancel-and-reissue rules (§5A "Corrections").
- **Legacy memberships** are not migrated to, recreated in, or linked to the package catalogue automatically. Their fees, terms, dates, currency, payments and balances, issued documents, attendance and class balances are preserved, and they keep the edit workflow they have today, with two exceptions that apply to every membership: an issued document never changes silently (§5A "The Receipt Follows the Membership"), and a class-count membership's expiry changes only through the audited expiry edit ("Class-Count Packages"). Any future linking would be an explicit, audited action that never rewrites their historical terms.

### Class-Count Packages
*(V1 Fee Structure.)* A class-count membership gives the student a fixed number of classes.
- **Remaining classes** are tracked on the membership: the package's classes less the classes consumed, where a class is consumed by a recorded attendance that has not been reversed. They are never negative.
- **Consumption is by Class Count Attendance.** A class is consumed when a completed class is recorded for the student in the separate **Class Count Attendance** workflow (§8 "Class Count Attendance"): one class for each recorded attendance, never twice for the same one. Reversing a recorded attendance (§8) restores that one class. A class-count membership is not used in session attendance (§8 "Eligibility"), so a Present mark in a class session never consumes a class.
- **Expiry** is chosen by the Admin for each class-count membership when it is created: either an **expiry date** entered manually (its End date) or **No expiry**. It is not calculated from days, weeks or months, and the package does not define it.
  - **With an expiry date** — the membership is usable only while it has remaining classes **and** has not expired; from the day after its End date it cannot be used, whatever classes remain. Unused classes expire with it and are not carried forward.
  - **No expiry** — no End date. The membership is usable while it has remaining classes, and needs nothing else.
- **Editing the expiry** applies to **every class-count membership**, package-linked or legacy (a legacy class-count membership is not migrated or linked to a package for it). It is a separate, authorized, audited action (Admin only) that requires a reason and keeps the previous and new expiry, the reason, who made the change and when. The Admin may extend or shorten the expiry, and switch between an expiry date and No expiry. An expiry edit never changes the agreed fee, the class allowance or any attendance record.
  - **Shortening** never removes or reverses history: attendance already recorded after the new expiry stays as it is, is not reversed automatically and does not change the class allowance; it is shown with the informational flag **Attendance after current expiry**. No acknowledgement step is required in V1.
  - New Class Count Attendance is recorded only within the membership's current validity.
  - **Extending** an expired membership makes it usable again, subject to its remaining classes.
- **Reversal and expiry.** Reversing a recorded class restores one class but never extends or changes the expiry. On an expired membership the restored class stays unusable unless the expiry is extended by the action above; on a No-expiry membership it remains available until used or the membership is cancelled.
- **No classes remaining.** The membership is ineligible for further Class Count Attendance, and the workflow offers the renewal action (§8 "Class Count Attendance").
- Unused classes are not automatically refunded and are not carried forward to a renewal or to any other membership.
- **Both kinds together.** A student may hold a duration-based and a class-count membership at the same time. Each attendance is associated with the one membership that it uses and affects only that membership.

### Membership Information
- Membership ID
- Student
- Plan — for a package-linked membership, its duration option (or class count); for a legacy membership, its original plan
- Package — *(V1 Fee Structure.)* package-linked memberships only: the package, and a snapshot of its name at creation
- Start date
- End date
- Fee details — *(V1 Fee Structure.)* package-linked memberships only: the standard fee, the package discount, the individual discount (fixed or percentage) with its reason, and the final agreed fee — or, for a Custom Fee Plan, the custom agreed fee with its reason and who confirmed it when — as agreed when the membership was created, with the audit history of any later correction
- Class allowance and classes remaining — *(V1 Fee Structure.)* class-count memberships only
- Currency — the centre currency recorded when the membership was created
- Amount — the final agreed fee (the amount payable)
- Payment status
- Payment date — recorded when the membership is Paid (see "Payment Date" below; part of the V1 Invoice / Receipt Enhancement, §5A)
- Payments — zero or more recorded payments (see "Payments" below; V1 Tax Adjustment)
- Status
- Notes — optional

### Payment Status
- Pending
- Partially Paid
- Paid

No online payment gateway is required for V1. Payment Status defaults to Pending.

*(V1 Tax Adjustment.)* Payment Status is never chosen by hand: a new membership (including a renewal) is created Pending, with nothing paid and the full membership amount outstanding, and the payments recorded against it determine Pending, Partially Paid or Paid. The Membership form shows no Payment Status, whether creating or editing; the status is read on Membership Details and the Memberships list, and follows the payments. Editing a membership never changes its Payment Status. A membership marked Paid before payment records existed keeps that status, with no payment records, and is not changed automatically.

*(V1 Tax Adjustment.)* Payment Status reflects the payments recorded against the membership:
- **Pending** — no payment has been recorded.
- **Partially Paid** — payments have been recorded but do not yet cover the full membership amount.
- **Paid** — the recorded payments cover the full membership amount.

### Payments
*(V1 Tax Adjustment.)* A membership can be paid in full at once or in installments.
- One membership can have multiple payments. *(V1 Fee Structure.)* A payment, and its document, can be recorded whether the membership is Upcoming, Active or Expired (a Cancelled membership is not covered by this rule), for duration-based and class-count memberships alike. Payments never affect attendance eligibility.
- One payment can combine several payment methods — for example part cash and part UPI. Supported methods include cash, card, UPI and bank transfer.
- Each payment method entry can capture the details relevant to it, such as a transaction / reference ID (for example for card or UPI) and notes.
- Each payment has its own document decision and its own document (§5A "Payment Documents").
- **Editing a payment.** Until a document is issued for a payment, the Admin can edit it: its date, and its methods — the type, amount, reference / transaction ID and notes of each, with methods added or removed. The payment's total is the sum of its methods, so it still cannot exceed the membership amount less the other payments, and the membership's payment status (and payment date, while Paid) is recalculated from the payments. The change is saved all at once or not at all, and each edit is recorded (who, when, the previous and new date, amount and methods). Once any document exists for the payment it can no longer be edited: it is corrected by cancel-and-reissue (§5A "Corrections"), so an issued document can never disagree with its payment.
- **Record Payment Now.** When a membership is created or renewed, the Admin may also record its first payment in the same form. It is optional and off by default; when it is off, the membership is saved Pending exactly as before. When it is on, it is the same payment as any other — payment date, one or more methods with their amounts, references and notes, and the tax invoice choice for this payment — with the same rules: it cannot exceed the membership amount, its methods add up to it, and the payment status and payment-level documents follow from it as usual. The payment is checked before the membership is saved and recorded once, after it. If the membership is saved but its payment cannot be recorded, the membership stays Pending, the Admin is told, and records the payment from Membership Details.

V1 still has no refunds and no online payment gateway.

### Payment Date
*(V1 Invoice / Receipt Enhancement — see §5A.)*

A Paid membership has a payment date, which the stored Invoice / Receipt uses as its default date.
- When a membership becomes Paid, the payment date defaults to the current date in the centre timezone.
- Memberships already marked Paid before this enhancement have no reliable historical payment date. The system does not invent one: such memberships receive an invoice only through the explicit "Issue Invoice" action (§5A), where the Admin confirms the required date.

### Membership Status
- Upcoming
- Active
- Expired
- Cancelled

Upcoming, Active, and Expired are determined by comparing the current date to
the membership's start and end dates. Cancelled is a separate, explicit state
that overrides any date-derived status.

Membership start and end dates are calendar dates, both inclusive, and "the current
date" is the date at the centre, evaluated in the centre timezone
(the centre's configured time zone, §7A and §11 Regional Settings) — never the server's UTC date. A membership that starts and
ends on the same day is Active for that day and Expired from the next centre day,
so the membership status, days left and progress shown on Membership screens agree
with attendance eligibility, which compares the same dates against the class
session's own date (§8).

### End Date
**Legacy memberships.** End date is calculated from the selected plan and start date, but remains
editable:
- Monthly: start date + 1 month − 1 day
- Quarterly: start date + 3 months − 1 day
- Half Yearly: start date + 6 months − 1 day
- Annual: start date + 12 months − 1 day
- Custom duration: entered manually

End date cannot precede start date. A same-day start and end date is allowed.

*(V1 Fee Structure.)* **Package-linked duration memberships.** The Admin selects the start date; the system calculates the inclusive End date and it cannot be overridden manually:
1. Add the duration option's number of months to the start date by calendar months, not fixed 30-day months.
2. If the target month has no such day, use the last day of that month (for example 31 January + 1 month → 28 February, or 29 February in a leap year).
3. Subtract one day.

So a Monthly membership starting 31 January 2027 ends 27 February 2027, and one starting 15 January ends 14 February. A different period is obtained by a new membership (renewal) or by an authorized, audited start-date correction (§5 "Packages and Fee Structure", "Existing memberships"), never by typing an End date.

*(V1 Fee Structure.)* **Class-count memberships.** The End date is the expiry date the Admin chose, or none for No expiry (§5 "Class-Count Packages"); it changes only through the audited expiry edit.

### Renewal
Every renewal creates a new membership record. Previous membership records remain available for historical purposes. The new membership's start date defaults to the previous membership's end date plus one day, editable if needed. *(V1 Fee Structure.)* A renewal is a new package-linked membership, whether the previous membership was legacy or package-linked. It is priced like a new membership, with the fee in effect on its start date — not by copying the previous membership's amount — and never inherits the previous membership's individual discount. A renewal on a deactivated package requires the Admin to reactivate the package first. A class-count renewal starts with a fresh class balance.

### Cancellation
Cancelling a membership retains the record; it is not deleted. An already-cancelled membership cannot be cancelled again. Cancellation does not affect batch enrollment.

### Eligibility
Membership is one of the conditions a student must meet to appear in attendance: their membership must be active on the class session date. The full set of conditions — active student, active batch enrollment, a schedule assignment for the session's schedule series, and an active membership — is defined in §8 "Eligibility".

Membership and batch enrollment are independent. One membership can cover multiple batch enrollments, and one membership covers every schedule the student is assigned to.

*(V1 Fee Structure.)* This is the eligibility of a **duration-based** membership. A class-count membership has its own eligibility, used only by Class Count Attendance (§5 "Class-Count Packages", §8 "Class Count Attendance").

### Expiry
When membership expires, the student remains in the system and historical records remain available, but the student is not normally eligible for attendance until a valid membership is active again.

---

## 5A. Invoice / Receipt (V1 Invoice / Receipt Enhancement)

### Purpose
Give every paid membership a stored, numbered Invoice / Receipt document that can be viewed, edited (number and date only), printed, downloaded as a PDF and shared.

This is a later enhancement to the working V1 application. The original V1 baseline had a printable receipt generated on demand and stored nothing; this enhancement replaces and extends that behaviour with a stored document. All other V1 behaviour — students, memberships, attendance, batches, schedules, instructors — is unchanged. The existing on-demand receipt continues to operate unchanged until the enhancement is implemented.

### Scope
This is a simple V1 document feature, not an accounting system. Before the V1 Tax Adjustment there were no separate Invoice, Receipt and Tax Invoice systems: one document type was presented as an Invoice or a Receipt according to the configured document title (§11 Invoice / Receipt Settings), and the intended default presentation for the current client is **Invoice**.

*(V1 Tax Adjustment.)* Payments are now documented per payment, either with a **tax invoice** or with a clearly identified **payment receipt**, each with its own numbering sequence (see "Payment Documents" below). The rest of this section continues to describe the existing membership-level invoice; how membership-level and payment-level documents coexist is set out in "Membership-Level and Payment-Level Documents" below.

### Issuing
- Membership → Payment Status = Paid → payment date → invoice issued → stored invoice.
- A new invoice is issued when a membership becomes Paid.
- A membership that was already Paid before this enhancement receives its invoice through an explicit Admin action, **Issue Invoice**, in which the Admin confirms the required invoice/payment date. No invoice or payment date is created for it automatically.
- Issuing, viewing and editing an invoice are Admin only, matching the existing V1 receipt behaviour. Instructors have no access to invoices.

### Membership ↔ Invoice
Under the original enhancement a membership has **zero or one** issued membership-level invoice (Membership 1 : 0..1 Invoice).

*(V1 Tax Adjustment.)* With payments, a membership can have several documents — one per payment (§5 "Payments", "Payment Documents" below). V1 still does not support refunds or credit notes.

### Membership-Level and Payment-Level Documents
*(V1 Tax Adjustment.)* A membership is documented either once at membership level or per payment, never both for new documents:
- A membership with recorded payments is documented per payment. It is never given a new membership-level invoice, whether automatically when it becomes Paid or through **Issue Invoice**.
- A membership that already has a membership-level invoice is documented by that invoice. New payment-level documents are not issued for its payments: **Issue Document** is not offered for them, and the database refuses the issue with "A membership invoice already exists for this membership."
- Existing documents of both kinds remain unchanged and viewable. A membership that already holds both a membership-level invoice and payment-level documents keeps them all; nothing is cancelled, converted or renumbered automatically.
- An existing payment-level document can still be corrected by cancel-and-reissue (see "Corrections" below): the replacement replaces a document and does not add a second one for the payment.

### Invoice Number
- Generated automatically and sequentially, and unique.
- The existing client already uses invoice numbers, so the sequence continues from them rather than starting again: with a last existing number of 1223, a Starting Invoice Number of 1224 makes the first new invoice 1224, then 1225, 1226 and so on. (1223 is an example only; the real starting number is configured for the client during implementation.)
- The sequence is global within this V1 instance, which has one implicit center. The Starting Invoice Number is configured in Settings.
- The invoice number itself is always a plain whole number (stored as a number, never as text). An optional prefix can be shown in front of it — see Invoice Number Prefix below.
- Existing invoice numbers are never renumbered or changed.
- **A number is never reused.** A number that has ever been assigned to an invoice can never be assigned to another invoice. If an invoice's number is edited, its old number is retired for good: it is never assigned again - not to another invoice, and not to the invoice that held it - and the automatic numbering skips it. This is enforced by the database, not by the unique constraint alone.
- Admin can edit the number when a genuine correction is required. Only the numeric invoice number is edited — never the prefix — and the new number must be a positive whole number, must not already be used by another invoice, and must not be below the Starting Invoice Number.
- The Starting Invoice Number must never be able to cause a duplicate invoice number.

### Invoice Number Prefix
An optional prefix can be shown in front of the invoice number, for example `INV-` so that invoice number 786 reads **INV-786**. With no prefix it reads **786**.

- **Optional.** Prefix **OFF** is represented by *no value* (NULL); there is no separate on/off setting. Turning it OFF and later ON again means entering the prefix again.
- **Separate from the number.** The numeric invoice number remains the source of truth for sequencing: it is a number, it continues sequentially under the existing numbering rules (786, 787, 788 …), and it is globally unique. The prefix is stored separately and is only a label shown before it. It does not take part in numbering, and it does not take part in uniqueness: no rule requires the prefix and number combination to be unique, because the number alone already is.
- **Configured in Invoice / Receipt Settings** (§11), and it **can be changed even after invoices exist** — unlike the Starting Invoice Number, it is never locked.
- **A changed prefix affects only future invoices.** The prefix in force when an invoice is issued is copied into that invoice (the same snapshot principle as the title, tax, terms and signatory), and it is **frozen** once the invoice is issued. For example, with prefix `INV-` invoices 788 and 789 read INV-788 and INV-789; if the prefix is later changed to `YC-`, the next invoices read YC-790 and YC-791, while 788 and 789 still read INV-788 and INV-789.
- **Editing an invoice does not change its prefix.** Invoice Edit changes only the numeric number and the date (§5A "Editing an Issued Invoice"). If INV-788 is edited to number 800 it becomes INV-800, and it stays INV-800 even if the prefix setting later changes to `YC-`.

**Prefix rules** (enforced by the database, and validated by the application for a clear message):
- NULL is valid and means the prefix is OFF.
- An empty string is not valid.
- 1 to 20 characters.
- No leading whitespace and no trailing whitespace. Whitespace includes spaces, tabs and newlines.
- The prefix must not end with a digit.
- Spaces inside the prefix are allowed, and no other characters are restricted.
- Valid examples: `INV-`, `INV/`, `YC-`, `FY26-`, `Receipt-`, `Yoga Center-`.
- Invalid examples: `" INV-"` (leading space), `"INV- "` (trailing space), `"INV-"` followed by a tab, a newline followed by `INV-`, `INV123` (ends with a digit), an empty string, and anything longer than 20 characters.

**Existing invoices.** Adding the prefix does not back-fill or alter any existing invoice. An invoice issued without a prefix stays without a prefix, and its number, date and every other stored value are unchanged.

### Invoice Date
- Stored on the invoice, independently of the Payment Date (the Payment Date belongs to the membership and is not changed by anything done to the invoice).
- Defaults to the Payment Date when the invoice is issued.
- Admin can edit it.
- It cannot be earlier than the Payment Date and cannot be in the future (the centre's current date).
- An existing invoice's date is never silently recalculated; it changes only when an Admin edits it.

### Stored Document and Snapshot
An issued invoice stores:
- its number and date, and the invoice number prefix (if any) that was in force when it was issued;
- its financial values (amount and, when tax is enabled, the tax values);
- *(V1 Fee Structure.)* no fee breakdown: document layouts are unchanged by the fee structure. The standard fee, package discount, individual discount and final agreed fee are shown in the membership interface (Membership Details), not on invoices or receipts;
- the customer and business information used on the document;
- the tax information used;
- the terms, signatory and document title used, where applicable.

Later changes to the Center Profile, tax settings, terms, logo, signature, or the student's details do not change an already-issued invoice.

### The Receipt Keeps Its Issued Details
*(FS-D — supersedes the earlier "The Receipt Follows the Membership".)* A Paid legacy membership has exactly one membership-level invoice (receipt). After the receipt is issued, Admin may still edit the membership's amount, plan, start date, end date and notes, **but the receipt does not change**: it keeps the plan, description, period, total, taxable amount and tax amount it was issued with. The membership shows its own edited values, so the two can differ. Only the receipt's number and date can be edited (see "Editing an Issued Invoice"). The Edit Membership page tells the Admin so whenever the membership has an issued receipt.

*(V1 Fee Structure — approved rule, supersedes the automatic following above.)* **An issued invoice or receipt never changes silently**, for legacy and package-linked memberships alike. Where a document must be corrected, the existing cancel-and-reissue process (see "Corrections") is used where it applies. A **package-linked membership** is documented per payment only (see "Membership-Level and Payment-Level Documents") and never holds a membership-level document.

**Implementation (FS-D).** The automatic following that earlier versions of this document described — a legacy membership edit rewriting its issued receipt (migration 0030: `memberships_sync_invoice_trigger` → `sync_invoice_from_membership`) — is removed by migration 0054 (applied and verified by the user, 2026-10-15). **Known limit, accepted:** today's cancel-and-reissue applies to payment documents only, so a legacy membership-level receipt has **no correction workflow yet**: its number and date can be edited, its other details stay as issued. A correction process for these receipts is a separate, later decision. Receipts that an earlier edit already rewrote are not restored. Nothing may rely on the automatic following.

*(V1 Fee Structure.)* **Fee corrections.** Changing a package-linked membership's agreed fee, package discount, individual discount or terms after it was created is a correction. It is Admin only, always requires a reason, and is kept in the audit history (who, when, old and new values, reason). The final agreed fee must still be greater than ₹0 and not below the payments already recorded, and calculated values are rounded as in §5. A correction never changes an issued document silently: where a document needs correcting, it is corrected only by the cancel-and-reissue rules in "Corrections" below, and payments follow the existing payment-editing rules.

*(V1 Fee Structure — implemented as FS-8.)* **How a correction is made.** There is one **Edit Membership** workflow for a package-linked membership (02-ux.md "Membership Details (package-linked)"): a change of the notes alone is an ordinary save, with no reason and no confirmation of the fee; a change of any protected term below is a correction, and only then are the revised price shown, a reason required and the revised final fee confirmed. **What a correction can change.** The package (of the same type: a duration membership stays duration-based, a class-count one stays class-count; another package must be active, the membership's own package may have been deactivated since), the duration, the start date, the pricing mode — **standard package pricing or a Custom Fee Plan, in either direction** — the custom agreed fee and its reason, and the individual discount and its reason. It never changes the student, the type or the currency, and it applies only to a package-linked, non-cancelled membership; a legacy membership keeps its Edit form.
- **Pricing.** The corrected membership is priced exactly as a new one is (§5 "Pricing a membership"): the fee entry in effect on the new start date, standard fee → package discount → individual discount → final agreed fee, each step rounded half up; or a Custom Fee Plan whose amount is the final fee with no discount. Standard pricing needs a valid fee in the membership's own currency; a correction never converts a currency. A duration membership's end date is recalculated by calendar months from the start date. A class-count membership's expiry is **not** changed by a correction (it changes only through the audited expiry edit); its class total follows the package and cannot go below the classes already used, and no class may be recorded before the new start date.
- **Confirmation.** The Admin sees the revised terms, the breakdown, the revised final fee, what has been paid and the balance, gives the reason and confirms the revised final fee before anything is saved. If the price has changed since it was shown, the save is refused and the Admin reviews it again.
- **Payments.** The final fee must be greater than ₹0 and not below the payments already recorded. No payment and no document is changed; the membership's payment status and payment date are recalculated from its payments as when a payment is edited (Paid when the payments cover the fee, Partially Paid when they do not).
- **History.** Every correction is recorded — who, when, the reason, the values before and after, and the payments recorded at the time — and shown in the membership's Corrections history. The history is never changed or deleted.

Editing the membership never issues another invoice and never allocates another number, and never changes the issued receipt. The invoice number, prefix, invoice date, payment date, currency and tax terms stay as issued, as does everything copied from elsewhere when it was issued (business, customer, bank details, terms, signatory, signature, logo) and the plan, description, period and amounts.

### Editing an Issued Invoice
After an invoice is issued, Admin may edit **only**:
- Invoice number (the numeric number)
- Invoice date

The invoice prefix is **not** editable from Invoice Edit: the historical prefix stored on the invoice stays unchanged when its number is edited. The number must still obey the existing rules (a positive whole number, unique, not below the Starting Invoice Number), and the date must still obey the Invoice Date rules above.

Invoice Edit does not edit the student/customer identity, membership amount, membership dates, payment date, tax values, terms, signatory, signature, invoice prefix, business identity or any other content: the amount, plan and period change only by editing the membership (see "The Receipt Follows the Membership"), and the rest is a snapshot. *(V1 Tax Adjustment.)* Other corrections to an issued document follow cancel-and-reissue (see "Corrections" below).

### Tax
- Tax can be enabled or disabled, with a configurable tax name and tax rate.
- V1 uses a tax-inclusive model: the membership amount is the customer's final amount, and when tax is enabled the tax is calculated (back-calculated) from that amount.
- The tax used is preserved on each issued invoice.

### Paid → Pending
Once an invoice has been issued for a membership, the issued invoice is preserved and is never silently invalidated. V1 has no refund or credit-note handling, so the application prevents an unsafe Paid → Pending change after an invoice has been issued. The exact guard is an implementation matter.

### Tax Invoice Preference
*(V1 Tax Adjustment.)*
- Tax invoice issuance is **enabled by default**.
- The owner can set a default preference per student (§4 Student Information).
- The Admin can override the preference for an individual payment. A payment-level override applies to that payment only and never silently changes the student's saved preference.
- Preferences do not override legal tax obligations.

### Payment Documents
*(V1 Tax Adjustment.)*
- Each payment has its own document decision and its own associated document. *(V1 Fee Structure.)* This holds whether the membership is Upcoming, Active or Expired, and for class-count memberships as for duration-based ones.
- When a tax invoice is issued, it uses the **existing tax invoice numbering sequence** (§5A "Invoice Number").
- When the non-tax option is selected, a clearly identified **payment receipt** is issued, numbered from its **own, separate sequence**.
- A tax invoice number is never consumed or reused for a payment receipt.
- The legal treatment of invoices for installments, and the precise classification of the non-tax document, must be confirmed before implementation.

### Corrections
*(V1 Tax Adjustment.)*
- Issued document numbers are permanent and are never reused.
- A correction follows a **cancel-and-reissue** process: the original document is cancelled — not edited, overwritten or deleted — and a replacement is issued with a **new** document number.
- The original document, its cancellation reason, the link to its replacement and the correction history are preserved.
- Issued historical documents are never silently overwritten or deleted.

*(Cancel Document and Correct & Reissue — payment documents; migration 0055.)* An Admin can handle an issued **payment document** (a tax invoice or a payment receipt) in two separate ways. Neither edits the issued document.
- **Cancel Document.** The Admin gives a required reason (at most 500 characters). The document is cancelled and kept: it keeps its number, date and every detail, is marked Cancelled with its reason, and **no replacement is issued**. The payment and the membership are not changed, and the payment **stays locked** (a payment that has had any document, even a cancelled one, can no longer be edited directly); its amount or methods can then be corrected only through Correct & Reissue. A document issued later for that payment receives a new number.
- **Correct & Reissue.** The Admin corrects the details, reviews the recalculated replacement, gives a required reason (at most 500 characters) and confirms. In one transaction the original is cancelled with that reason and a replacement is issued with a **new** number from the **same series** (a tax invoice stays a tax invoice, a payment receipt stays a payment receipt), linked to the original in the correction history. The original keeps every detail it was issued with. What can be corrected:
  - the **customer details** (name, phone country code, phone, email) and the **business details** (name, address, phone, email), and the **GSTIN of a tax invoice** (never on a payment receipt) — they appear on the replacement only; the student record and the center profile are **not** changed;
  - the **invoice date**, which keeps the original date unless another valid date is chosen: not before the payment date and not in the future;
  - the payment's **methods and amount** (add, remove or edit a method, its amount, reference ID and notes). The **payment date never changes**. The corrected total must be greater than zero and no more than the membership's amount less its **other** payments; the payment being corrected is not counted twice, and a payment that exactly settles the balance is allowed. The membership's payment status and outstanding balance are recalculated from its payments. A **lower** amount only corrects the record: no refund or credit note is processed or recorded.
- A tax invoice's tax is recalculated tax-inclusively from the corrected total at the **current** tax rate; a payment receipt carries no tax. The Admin sees the recalculated document, the membership's resulting payment status and balance before confirming, and the database refuses a replacement that differs from what was reviewed. A failure at any point changes nothing: no payment change, no cancelled original without its replacement, no duplicate replacement, and the same document cannot be corrected twice.
- The replacement carries forward, exactly as stored on the original, its **plan, description, membership period and service details**. They are never refreshed from the current membership, enrollment, batch or schedule, and no existing document is rewritten.
- A **legacy membership-level receipt** has no cancel or correction workflow yet (see "The Receipt Keeps Its Issued Details"). The membership's price, package terms, validity, attendance eligibility and every other payment are never changed by a document correction.

*(Service details on a new document — migration 0056.)* The batch, class days and times shown on a document are a snapshot taken when the **first** document of a membership is issued. They are resolved for the membership's **start date**; **only if no enrollment applies then**, they are resolved for the center's date of issue; if neither finds a batch, the document shows the generic membership description and period. Several batches or schedules are each listed once, in a fixed order. This applies to new documents only: an existing document is never backfilled, and a replacement never re-reads this data.

### Documents Register (Central Documents)
*(Approved 2026-10-16. **Phase 1 is a read-only list**; the enhancements listed at the end are future and not approved.)*

**Purpose.** Let the Admin see every stored invoice and receipt across all memberships in one place, without opening each membership. It is a view of the existing `invoices` documents (§5A): there is no second document table, and nothing in the register issues, edits, cancels or corrects a document.

**Who.** Admin only. An Instructor has no access to the register (the same rule as every invoice and receipt).

**What it lists.** One row per stored document, issued **and** cancelled: payment-level **tax invoices** (invoice series), **payment receipts** (payment receipt series) and **legacy membership-level receipts** (invoice series, no payment). A cancelled document and its replacement are two separate rows — the cancelled one marked Cancelled, the replacement Issued — so the history stays visible for audit. Nothing is merged, hidden or counted: the register shows documents, it does not total them, so a payment that has a cancelled document and a replacement is never counted twice.

**Columns.**
- **Document number** (the stored prefix and number, for example INV-837), linking to the document's existing detail page.
- **Type** — the document's **stored title** (Invoice, Receipt or Payment Receipt).
- **Customer** — the customer name **as written on the document** (its snapshot, which can differ from the student's current name after a correction) and the customer code.
- **Membership** — the membership number, linking to Membership Details.
- **Document date.**
- **Amount** — the document's stored total (tax included where it has tax).
- **Status** — Issued or Cancelled.

**Search and filters** (all in the URL, so a view can be shared and reloaded; changing one returns to page 1).
- **Search** matches the document number (typed with or without its prefix, for example INV-837 or 837), the **snapshot** customer name and the customer code. It does **not** search the student's current name.
- **Document series** — all, invoice series (tax invoices and legacy membership-level receipts) or payment receipt series.
- **Status** — all, Issued or Cancelled.
- **Document date** — from and to (inclusive).

**Order and paging.** Newest document date first (Oldest first is selectable), then the highest number, then a stable tie-break, in pages of 10, exactly like the Memberships list.

**Opening a document.** A payment-level document opens `/memberships/[id]/documents/[documentId]` (its page shows the Cancelled status, reason, replacement link and correction history). A legacy membership-level receipt opens `/memberships/[id]/invoice`.

**Rules.** Numbering, issuing, cancelling, correcting, payments, memberships and the stored snapshots are unchanged by the register, and it adds no database table or migration.

**Future enhancements (not approved, not part of Phase 1).** A correction-history column on each row ("Replaces INV-837" / "Replaced by INV-838"); summary figures or totals (if ever added, only Issued documents may be summed); export; and search by the student's current name.

### Actions
A stored invoice is intended to support:
- View
- Edit (number and date only)
- Print
- Download PDF
- Share / WhatsApp

WhatsApp remains a plain click-to-chat / share workflow, not a WhatsApp Business API integration. `wa.me` cannot attach a file; where the browser supports it, the Web Share API can share the generated PDF, and otherwise the PDF can be downloaded and a text message shared. The PDF technique is an implementation decision.

### Not Included
- Online payment gateway, automatic billing
- Refunds, credit notes
- Full accounting, revenue accounting, financial ledger
- Multi-center or multi-organization billing

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
A batch is not tied to one fixed time. The same batch can have multiple schedules across different days and times, **including several on the same weekday** — Hatha Yoga General running Monday at 6:00 AM, 7:00 AM, 5:00 PM and 7:00 PM is four schedules of one batch, not four batches.

Each of those schedules produces its own class sessions, and students enrolled in the batch attend only the ones they are assigned to (§4 "Schedule Assignment").

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
Admin can add new schedules anytime, edit schedules, change future schedules, deactivate schedules, delete unused schedules, assign instructors, and set effective dates.

### Future Changes
Changes to recurring schedules apply to future sessions only. Past sessions and historical attendance remain unchanged.

Editing a schedule's day, time or instructor is therefore versioned rather than applied in place: the existing schedule is closed by setting its effective until date to the day before the change takes effect, and a new schedule version is created starting from that date. The earlier version remains available, so what was scheduled on any past date can always be reconstructed.

Which of those two things happens depends on whether the schedule being edited has ever been in effect:

1. **The schedule has already started** — the new effective from date falls after the current version's own effective from date. The current version is closed at the day before the new date, and a new version carries the edited values forward. This is the ordinary case.
2. **The schedule has not started yet** — the new effective from date falls on or before the current version's own effective from date. There is no elapsed period to preserve, so the current version is updated in place. Versioning here would have to close the current version before it ever began, which is not a period that can be expressed.
3. **The new effective from date is before today** — rejected. Back-dating a change would rewrite what was scheduled on a date that has already passed.

Both of the first two outcomes leave every schedule version with an effective period that starts on or before it ends; the third is what keeps the past out of reach of an edit.

### Unused Schedules — Direct Correction and Deletion
A schedule that has not become part of the historical record can be corrected or removed outright. Versioning exists to protect history; a schedule that has none needs no protecting. A schedule is **unused** when, together:

1. **No class session references it** — of any status. A materialized session (§7A) is historical data even when it has no attendance: a Cancelled or Holiday session, an edited session, or one whose attendance was saved all count.
2. **Its schedule series has exactly one schedule version.** An edit that versioned it created another; the version chain is history and is never deleted.
3. **No schedule assignment (§4) on its series has started** — every assignment starts today or later in the centre's timezone (§7A "Centre Timezone"). An assignment that has already covered a past day is history.

Occurrences that were only ever projected (§7A) — including past dates nobody recorded anything for — are not sessions and do not make a schedule used.

**Direct edit.** An unused schedule is edited in place — day, time, instructor and effective dates — with no new version and no need to choose an effective date. The days work as when adding: unticking the schedule's own day and ticking another moves it; any other ticked day creates a new schedule. If students hold unstarted assignments on it, changing its day moves those assignments with it, and Review says so. Every other schedule keeps the versioned edit above.

**Delete.** An unused schedule can be deleted. Its unstarted schedule assignments are withdrawn with it (§4), and its now-empty schedule series is removed. Before confirming, Admin is told how many students are affected, and how many past occurrences were never recorded and will no longer appear. A schedule that is not unused cannot be deleted; Deactivate is how it stops.

Both are decided by the database in the same transaction as the change, not from what the screen last showed: a session materialized after the confirmation opened blocks the change instead of being lost. Deleting does not create, cancel or alter any session.

### Schedule Series
Versioning means a single real-world class — "the Monday 6:00 AM Hatha Yoga class" — is represented over time by a succession of schedule versions, each with its own effective period. A **schedule series** is the stable identity those versions share: editing a schedule creates a new version within the same series, never a new series.

The series is what everything outside the Schedule area refers to when it means "that class":

- Student schedule assignments (§4) are held against the series, so an admin editing a schedule's time or instructor never orphans the students who attend it.
- Attendance eligibility (§8) matches a class session's schedule to the series a student is assigned to, not to one particular version.

A class session still records the specific version it was generated from (§7A), so what the class actually looked like on a given date remains exact. The series answers "which class is this?"; the version answers "what were its details then?".

### Conflicts
V1 does not prevent overlapping schedules. A batch may hold more than one schedule covering the same day and time, and an instructor may be assigned to more than one schedule at the same day and time. These situations are visible to the Admin in both Schedule views — listed in the List View, and shown side by side in the Weekly Schedule grid — and are treated as an operational judgement, not a system-enforced constraint.

### Elapsed Effective Period
A schedule whose effective until date has passed remains stored as Active or Inactive exactly as the Admin left it. Status is never rewritten automatically. Where it is useful, the interface may additionally indicate that the schedule's effective period has ended, derived from the dates rather than stored.

### Specific Future Session Changes
Admin can change one specific future session without changing the recurring schedule.

### Cancellation / Holiday
A specific session can be marked Cancelled or Holiday. Such sessions do not require attendance and the recurring schedule remains unchanged.

### Deactivation
A schedule that has been used is deactivated rather than deleted — it is closed with an effective until date and marked inactive. Historical sessions and attendance remain available. Only an unused schedule (see "Unused Schedules") can be permanently deleted; a schedule with a class session, an earlier version, or a started student assignment never can.

### Online / Offline
Online/offline is not a required property of the recurring schedule. Students may attend online or offline based on their circumstances. V1 attendance records only Present or Absent.

---

## 7A. Class Sessions

Numbered 7A rather than 8 deliberately: this section was added after the
rest of the document, and renumbering the sections below it would
invalidate the section references already cited throughout the codebase.

### Purpose
A class session is one dated occurrence of a recurring schedule. It is the record attendance attaches to, and the point at which the product model stops describing a repeating pattern and starts describing a specific class that did or did not happen (§1: Batch → Recurring Schedule → Class Session → Attendance).

### Relationship to Schedule
Every class session belongs to exactly one recurring schedule. There are no ad-hoc sessions in V1 — a session cannot exist without a schedule to derive it from. Creating a one-off class therefore means creating a schedule for it, not creating a session directly.

### Projection and Materialization
Section 7 says a recurring schedule is used to "generate or identify" class sessions. That is resolved as follows.

Occurrences are **projected** from the recurring pattern for display: the system calculates which dates a schedule falls on and shows them, without storing anything. A session is **materialized** — written as a real, persistent record — the first time something must attach to that specific occurrence:

1. a session-specific change (Edit This Session),
2. marking it Cancelled or Holiday,
3. attendance being recorded against it.

Until one of those happens, no session record exists and the occurrence is purely calculated.

This avoids a generation job and avoids drift: an occurrence that nobody has touched always reflects the current schedule version, and an occurrence that someone *has* touched is fixed at the moment it was touched.

### Session Information
- Schedule — required
- Batch — snapshot
- Instructor — snapshot
- Session date
- Start time — snapshot
- End time — snapshot
- Status
- Note — optional

Duration is derived from start and end time and is never stored. A class session has no product-facing identifier: unlike Student ID and Membership ID, nothing in the product or the approved wireframes identifies a session by a code, so none is assigned.

### Session Status
Four states are persisted:

- `scheduled`
- `completed`
- `cancelled`
- `holiday`

Five statuses are displayed, exactly as listed in §3:

| Displayed | Derived from |
|---|---|
| Upcoming | persisted `scheduled`, and the current time is before the session's start time |
| Ongoing | persisted `scheduled`, and the current time falls from start time through end time, inclusive |
| Completed | persisted `scheduled` with the current time after end time, **or** persisted `completed` |
| Cancelled | persisted `cancelled` |
| Holiday | persisted `holiday` |

Upcoming and Ongoing are therefore never stored — they are readings of the same `scheduled` state at different moments, and storing either would go stale the moment the clock passed it. A projected occurrence that has not been materialized behaves as `scheduled`.

Completed is different: it has both a stored form and a purely displayed one, and the two must not be confused. A `scheduled` session whose end time has passed is *shown* as Completed the moment anyone looks at it, but its stored status stays `scheduled` — nothing about looking at a session, or the clock simply moving past its end time, ever writes to the database. The stored value only becomes `completed` when attendance is saved for the session (§8), a separate, explicit, later event. Conflating "displays as Completed" with "is recorded as completed" would let the clock silently change a stored value, which is exactly what §12's Historical Integrity rules forbid elsewhere in this product.

### Centre Timezone
Upcoming, Ongoing and the displayed-Completed reading above all depend on what time it is *at the centre*, so all three are derived against the **centre's timezone** — a single Center Setting (§11 "Regional Settings"), an IANA identifier such as `Asia/Kolkata` or `America/New_York`, whose daylight-saving rules come from the IANA time zone database. It defaults to **Asia/Kolkata**, which is what an existing centre keeps. The timezone belongs to the centre: it never depends on the browser, device or location of the admin, instructor or student viewing the app. There is no per-user, per-branch or per-schedule timezone — multi-branch management is explicitly outside V1 (§13).

### Snapshot and Historical Integrity
When a session is materialized it snapshots its batch, instructor, date, start time and end time. Those snapshot values are authoritative for that session from then on:

- A later schedule edit, version or deactivation never rewrites an existing session.
- Only future occurrences that have not been materialized follow the current schedule version.
- A specific future session is changed through Edit This Session, which affects that session alone and leaves the recurring schedule untouched (§7).

This is what makes §12's Historical Integrity rules hold in practice: a session that has already been cancelled, altered or attended keeps the details it had at the time, no matter what happens to the schedule afterwards.

### Inactive or Ended Schedules
An inactive schedule version, or one whose effective period has ended, produces no further unmaterialized occurrences. Sessions that were already materialized under it remain available and are never deleted.

### Editing a Specific Session
A specific session's instructor and/or time can be changed without changing the recurring schedule (§7 "Specific Future Session Changes"). Its date and batch cannot change on a session edit — a session belongs to exactly one schedule and date; moving it to a different day or batch is a schedule change, not a session exception.

Only a session currently displayed as Upcoming can be edited. Editing an Ongoing session is not permitted, since the class is already underway; editing a Completed session would rewrite what happened, which §12's Historical Integrity rules forbid; a Cancelled or Holiday session has nothing to reschedule.

Editing materializes the session, same as Cancellation and Holiday below, and only when the edit actually changes something — opening the edit screen, or confirming it unchanged, writes nothing.

### Cancellation and Holiday
A specific session can be marked Cancelled or Holiday, with an optional note. Doing so materializes the session. The recurring schedule is unchanged, other occurrences of it are unaffected, and the session requires no attendance (§8).

Only a session whose stored status is still `scheduled` can be marked — not one already `completed`, `cancelled` or `holiday`. This is checked against the stored status, not the displayed one: a `scheduled` session may be marked whether it currently displays as Upcoming, Ongoing, or a clock-derived Completed reading, since none of those are a real stored `completed`. Once attendance exists (§8), a session only ever becomes stored `completed` when its attendance is saved — so this same rule then also means a session with attendance already recorded cannot be cancelled or marked holiday, without needing a separate check for that.

Marking a session Cancelled or Holiday cannot be reversed in V1. There is no un-cancel action, matching how an already-cancelled membership cannot be cancelled again (§5).

### Data Requirements
- At most one session per schedule per date.
- A session always references its schedule, batch and instructor; those references restrict deletion rather than cascading.
- Sessions are never deleted — cancellation replaces deletion, matching every other entity in this product.
- Admin-only in V1. Instructors will need read access to their own sessions when Attendance is introduced (§8).

---

## 8. Attendance

### Purpose
Allow instructors and administrators to quickly record and maintain attendance for each class session.

### Eligibility
Only students meeting all four conditions are shown:
1. The student is active.
2. Active enrollment in the relevant batch, covering the class session's own date — the enrollment's status is active, its effective start date is on or before the session date, and its effective end date (if any) is on or after the session date.
3. A schedule assignment on that enrollment covering the session date, for the same schedule series the class session belongs to (§4 "Schedule Assignment", §7 "Schedule Series"). Being enrolled in the batch is not sufficient: a student assigned only to the 6:00 AM class is not eligible for the same batch's 7:00 PM class.
4. Active membership covering the class session date — the membership's start and end dates cover the session date, and the membership was not yet cancelled as of that date (see Membership below). *(V1 Fee Structure.)* Only a duration-based membership satisfies this condition. A class-count membership does not make a student eligible for a class session: it is used only by Class Count Attendance (below). A student holding both kinds is shown in session attendance by the duration-based membership alone, and the attendance workflow for duration-based memberships is unchanged.

Eligibility is always evaluated against the class session's own date, never against today — a past session's eligible list reflects who qualified on that date, not who qualifies now. The batch used is the class session's own batch (its snapshot once materialized, §7A), not the recurring schedule's current batch; the schedule series used is the one the session's own schedule belongs to, so a session generated before a schedule edit and one generated after it both resolve to the same series and the same assigned students.

An inactive student is excluded from new eligibility from that point on; a session that already has an attendance record for a student who later became inactive keeps that record regardless (Historical Integrity, §12).

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

Unmarked is never itself stored — an eligible student with no attendance record for the session is unmarked; a status other than Present or Absent does not exist as a stored value. Attendance can be saved with some or all students still unmarked; saving still completes the session (see Completion).

Attendance can only be taken for a session whose date is today or earlier, in the centre timezone (§7A). A future-dated session has nothing to record yet.

### Completion
After attendance is saved, the class session is marked Completed — regardless of how many students were marked.

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

A membership's cancellation only affects eligibility for session dates on or after the cancellation date. Cancelling a membership today must not retroactively remove eligibility for a session that already happened while the membership was still active.

### Summary
Show:
- Total eligible students
- Present count
- Absent count
- Attendance percentage

Attendance percentage is Present ÷ Eligible × 100, not Present ÷ Marked — a session with unmarked students shows a correspondingly lower percentage rather than looking complete. A session with zero eligible students shows 0%, never an error.

### Class Count Attendance
*(V1 Fee Structure.)* A separate workflow records attendance against class-count memberships. It is the third tab of Attendance, beside Today's Sessions and All Sessions, and is shown to an **Admin** and to an **Instructor** (an Instructor's list and recording are limited to their own students, below). Reversing a record and every other administrative action stay **Admin only**. It is not tied to a class session or its time, and it does not change session attendance (above), which stays as it is for duration-based memberships.
- **Instructors.** An Instructor may record a class for a student they are **authorized for** — the same rule as their view of class-count history (§8 "Visibility on Student Details and Attendance History"): a current active enrollment with a current schedule assignment on a series they teach, or attendance on a session they own. The Instructor's list shows only those students' eligible memberships, without the student's phone number; recording for any other student, or for a membership that does not exist, is refused in the same way. Every rule below applies unchanged to an Instructor: eligibility, the attendance date, one deduction per request, never below zero, and the audit record, which names the Instructor who recorded it. An Instructor **cannot reverse** a record (not even the one they recorded), edit an expiry, renew a membership, or see a reversal reason; the Renew action and the "No classes remaining" list are shown to an Admin only. Session attendance is unaffected.
- **Who is shown.** The students with a class-count membership that is usable today: active student, not Cancelled, started, with remaining classes, and — when it has an expiry date — not expired (§5 "Class-Count Packages"). Each shows their remaining classes.
- **Record a class.** Each student has an action that records one completed class. The Admin **confirms** it before it is recorded, and chooses the **attendance date** — the day the class was actually held, offered as today in the centre timezone and never replaced by it silently. The date must be on or after the membership's start date, on or before its end date when it has one, and not in the future in the centre timezone. The membership must be eligible now (usable today, as above) and the student active; a Cancelled membership never receives a new record. Recording deducts exactly one class and creates one attendance record linked to that membership, that student and the attendance date, keeping who recorded it and when. Several classes on the same date are separate records.
- **No duplicate deductions.** One recorded attendance deducts one class once. Repeating the same action — a double click, a retry, a second device — never deducts again. Each record is made by its own request: recording a class again, including one that was reversed, is a new record with a new request.
- **Never below zero.** Remaining classes cannot go below zero; nothing is recorded when none remain.
- **Reversing a record.** An Admin can reverse an attendance record made by mistake. A record is never edited or deleted: the reversal is a separate record that keeps **who** reversed it, **when**, and **why**, and the original record stays exactly as it was, shown as Reversed. A reason is required — trimmed, 3 to 500 characters. Reversing restores exactly one class to the remaining count (usage counts only records that have not been reversed). A record can be reversed once: reversing it again, or repeating the same reversal (a double click, a retry, a second device), does not reverse anything twice. Reversing is Admin only.
- **No classes remaining.** The student is ineligible for further Class Count Attendance. Instead of the record action, an appropriate **renewal action** is shown (Flow 09); the renewal is a new membership as in §5 "Renewal".
- **Right membership.** A student with both a duration-based and a class-count membership is attended in each workflow against that workflow's own membership. A class-count record never consumes or alters a duration-based membership, and session attendance never consumes a class.
- **History.** Records already made — with their reversals, the people who made them, their times and their reasons — and memberships of either kind that expired or ran out, are preserved and are never changed by later fee, package or membership changes. Membership Details shows a class-count membership's records (§5 "Membership Information"; 02-ux.md "Class Count Attendance"). Its class total cannot be set below the classes recorded and not reversed.
- **Visibility on Student Details and Attendance History.** Class-count records are also shown beside session attendance, always labelled as a different type from a scheduled session, and never counted with it. **Student Details is Admin only. Attendance History is shown to an Admin and, within limits, to an Instructor (below).** Reversing stays Admin only; recording is open to an Instructor for their own students (see "Instructors" below).
  - **Student Details → Recent Attendance** is one newest-first list of the student's 5 latest records, session and class-count together, each labelled **Session** or **Class count**. A class-count row shows its membership instead of a batch and instructor, and its status — **Recorded**, or **Reversed**.
  - **Attendance History** shows each date's class-count records in a separate **Class count** section under that date's sessions. A date that has only class-count records is shown too, and appears on the calendar and in Quick dates. The existing batch, instructor and Present / Absent filters hide class-count records (they have none of those); the search matches the student's name or the membership code.
  - A **Reversed** record stays visible with its reason and is never valid class usage. The informational flag **Attendance after current expiry** appears only on a record that is not reversed and is dated after the membership's current expiry.
  - An **Instructor** sees class-count records in Attendance History only for the students they are authorized for, never another instructor's or an unrelated student's: a student who has an **active enrollment with a current schedule assignment on a schedule series that instructor teaches** (an active schedule version in effect today), **or** who has **attendance on a session that instructor owns**. A deactivated instructor sees none. The Instructor sees the record, its date, the student and the membership code, and whether it is **Reversed** — but **not the Admin's free-text reversal reason**, who recorded or reversed it, or the reversal time, and has no link to Membership Details (which is Admin only). The authorization is enforced by the database, not by the screen; the class-count tables themselves stay Admin only. An Instructor's batch and Present / Absent filters hide the records as for an Admin, and the search can only narrow what they may already see. The Instructor's calendar markers and Quick dates include only their own students' class-count dates.
  - Class-count records are **never** part of a session's eligible, present or absent counts, attendance percentage, any report, or a "Sessions" count label. Membership Details keeps the full history, including who recorded and reversed each record and the reason.
- **Expiry edits.** After an audited expiry edit (§5 "Class-Count Packages"), new records follow the current expiry. A record made earlier whose attendance date is now after the expiry is kept unchanged, is not reversed, does not change the class balance, and shows the informational flag **Attendance after current expiry** (no acknowledgement step in V1).

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

Center name, address, phone, email and logo are also the business identity used on the Invoice / Receipt (§5A); they are not duplicated in the Invoice / Receipt Settings.

### Regional Settings
Part of Center Profile. Admin can set:
- **Time Zone** — the centre's IANA time zone (searchable by country, city or identifier). Default **Asia/Kolkata**. It is the business timezone for every date the application derives: today, session status, membership validity, attendance eligibility, schedule dates (§7A "Centre Timezone").
- **Currency** — the centre's ISO 4217 currency code (searchable by code, name or symbol). Default **INR**. It controls how amounts are displayed, and which currency **new** memberships are priced in.

Changing the currency never converts an amount. Each membership records the currency it was priced in (existing memberships are INR), so past amounts keep their original meaning after the centre changes currency; a renewal starts blank rather than carrying over an amount priced in a different currency.

The Logo is uploaded from Center Profile (PNG, JPG or WebP, up to 2 MB) and appears in the application's brand slot and on the Invoice / Receipt. An invoice that has already been issued keeps the logo it was issued with (§5A).

### Invoice / Receipt Settings
*(V1 Invoice / Receipt Enhancement.)* A new Settings area for Invoice / Receipt configuration. Admin can set:
- **Starting Invoice Number** — the first number the new feature uses (for example 1224 when the last existing invoice is 1223). Later invoices continue sequentially, and the setting must never cause a duplicate number.
- **Invoice Number Prefix** — optional (§5A Invoice Number Prefix). Blank means no prefix. It can be changed at any time, even after invoices exist, and affects only invoices issued afterwards; it is not locked like the Starting Invoice Number.
- **Tax** — enabled or disabled; tax name; tax rate (§5A Tax)
- **GSTIN** — the centre's 15-character GST identification number, optional (blank means none). It is checked for the GSTIN format and its check character, kept in the Tax area (it does not depend on the tax switch), and initially set to the centre's own GSTIN. It is printed in the business details of newly issued **tax invoices** only: a payment receipt (§5A "Payment Documents") is not a tax document and never shows it. It is copied into each tax invoice when it is issued, like every other business detail: changing or clearing it later never alters a document already issued, and a document issued without one shows none.
- **Terms & Conditions**
- **Signatory name** and **signatory designation**
- **Signature image**
- **Document title** — configurable; the document is presented as either **Invoice** or **Receipt**. The intended default for the current client is Invoice. This changes only how one document is titled; it does not create separate Invoice and Receipt systems.
- *(V1 Tax Adjustment.)* **Payment receipt numbering** — the non-tax payment receipt (§5A "Payment Documents") has its own numbering sequence, separate from the tax invoice sequence.

Business identity (name, address, phone, email, logo) continues to come from Center Profile. Changing these settings affects invoices issued afterwards, never invoices already issued.

### Packages and Fees
*(V1 Fee Structure.)* Admin only. Admin configures (§5 "Packages and Fee Structure"):
- **Packages** — name, optional description, and type (duration-based or class-count; the type cannot change once the package has been used). No frequency field.
- **Duration-based packages** — the duration options offered (Monthly, Quarterly, Half Yearly, Annual, Custom in whole calendar months), the monthly base fee, and an optional package discount (fixed amount or percentage of the standard fee) for Quarterly, Half Yearly and Annual. Monthly has none; Custom (months chosen per membership) uses the discount of the largest standard duration not exceeding its months, or none if that duration has none configured.
- **Class-count packages** — the class allowance and an independent price. No validity is configured on the package; the expiry is chosen per membership.
- **Fee history** — effective-dated fee entries (monthly base fee and package discounts, or class-count price), including future schedules, which can be edited or cancelled before they take effect and corrected afterwards only with a reason; every action is audited.
- **Activation** — deactivate (no new purchases) and reactivate.

A package that is no longer offered is deactivated, not deleted; a used package can never be deleted. Changing a package's fees or terms affects memberships created afterwards, never existing ones. Instructors cannot view or change packages, fees, discounts or expiry.

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

Instructor does not manage global Students, Memberships, Documents, Batches, Schedules, Reports, or Settings.

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
- A batch enrollment records which of the batch's schedules the student attends.
- Schedule assignment belongs to the batch enrollment, not to the student directly.
- One enrollment can hold several schedule assignments at the same time.
- A batch enrollment should have at least one schedule assignment.
- Schedule assignments are held against a schedule series, not a single schedule version.
- Schedule assignments have an effective period and no separate status; the dates alone determine validity.
- Changing a student's schedule closes the existing assignment and creates a new one from the effective date; earlier assignments are retained, never rewritten.
- Overlapping times across a student's own schedule assignments are not blocked.

One active enrollment per batch keeps attendance eligibility unambiguous: a duplicate active enrollment would list the same student twice for a single class session.

### Membership
- Membership ID is system-generated, unique, and immutable.
- Membership ID uses the sequential format MEM-000001.
- Membership is independent of batch enrollment.
- One membership can cover multiple batch enrollments.
- Covered batch enrollments are derived from enrollment effective dates that overlap the membership period, not stored directly.
- Membership status (Upcoming/Active/Expired) is derived from the current date, not stored; cancellation overrides any date-derived status.
- A student cannot have overlapping non-cancelled duration-based membership periods. *(V1 Fee Structure.)* A student may hold a duration-based and a class-count membership at the same time.
- Cancelled memberships are excluded from the overlap rule.
- End date is calculated from plan and start date. For a legacy membership it remains editable. *(V1 Fee Structure.)* For a package-linked duration membership it is calculated by calendar months (clamped to the last day of a shorter month, then minus one day) and cannot be overridden manually; for a class-count membership it is the chosen expiry date or none, changed only through the audited expiry edit.
- End date cannot precede start date; a same-day start and end date is allowed.
- Renewal's default start date is the previous membership's end date plus one day.
- Payment status is Pending, Partially Paid or Paid, determined by the payments recorded against the membership; Paid means the recorded payments cover the full membership amount.
- A membership can have multiple payments (installments), and one payment can combine several payment methods, each with its relevant details.
- Payment status does not determine membership status.
- Payment status does not affect attendance eligibility.
- Attendance eligibility requires active membership on the session date.
- Renewals create new membership records.
- *(V1 Fee Structure.)* A package-linked membership is priced with the package's fee entry in effect on its start date: standard fee → package discount (against the standard fee) → individual discount (against the remaining fee) → final agreed fee. Each discount calculation is rounded half up to two decimal places; combined discounts cannot exceed the standard fee; the final agreed fee is greater than ₹0. The fee, discounts, package name, terms and currency are kept with the membership; later package or fee changes never alter them, and it is never repriced automatically. An individual discount always has a reason (Promotional Offer, Returning Member, Special Approval, or Other with an explanation); a renewal never inherits it. A Custom duration's months are chosen per membership, and it takes the package discount of the largest standard duration not exceeding them, or none if that duration has none. A valid standard fee is in the centre's current currency; fees are never converted. Standard pricing is the default; an Admin may explicitly use a **Custom Fee Plan** (custom agreed fee > ₹0, mandatory reason, Admin and time recorded, explicit confirmation before creation) for a special price or when no valid standard fee applies; its amount is the final agreed fee, with no package or individual discount applied on top. Changing an existing membership's agreed fee, discounts or terms is a separate, Admin-only, audited action with a reason.
- *(V1 Fee Structure.)* Legacy memberships are never migrated or linked to packages automatically and keep their current edit workflow, except that issued documents never change silently and a class-count membership's expiry changes only through the audited expiry edit, for legacy and package-linked memberships alike.
- *(V1 Fee Structure.)* A class-count membership consumes one class for each recorded Class Count Attendance that has not been reversed (§8), never twice for the same one, and never below zero. The attendance date is chosen at recording: on or after the membership start, on or before its end date when it has one, never in the future (centre timezone); the membership must be eligible now, the student active, and a Cancelled membership takes no new record. An Admin can reverse a record with a required reason (3–500 characters): the original record and the reversal (who, when, why) are both kept, one class is restored, and a record is reversed once. With an expiry date it is usable only with remaining classes and unexpired; with no expiry, only with remaining classes. The expiry is chosen per membership (a date or No expiry) and changed only by an Admin-only, audited expiry edit with a reason, which may extend, shorten or switch it; shortening keeps and flags any attendance already recorded after the new expiry, and a reversal never extends the expiry. With none remaining it is ineligible and a renewal action is shown. Unused classes are neither refunded nor carried forward automatically. Class-count attendance is separate from session attendance, which is unchanged.
- *(V1 Fee Structure.)* A membership can have multiple payments, each with its own document, whether it is Upcoming, Active or Expired.
- Expired memberships remain in history.
- Cancelled memberships remain in history; cancellation does not delete the record.
- A Paid membership has a payment date; it defaults to the current date in the centre timezone when the membership becomes Paid. Historical payment dates are never invented for memberships that were Paid before the Invoice / Receipt Enhancement.

Deriving status from dates, rather than storing it, prevents a membership from silently remaining Active after its end date passes. Overlap prevention keeps a student's eligibility unambiguous on any date — the same reasoning as one active enrollment per batch.

### Invoice / Receipt
*(V1 Invoice / Receipt Enhancement — §5A.)*
- An invoice is issued when a membership becomes Paid, or by the explicit Issue Invoice action for a membership that was already Paid.
- Invoice numbers are sequential, unique and continue from the configured Starting Invoice Number; existing invoice numbers are never renumbered or changed.
- Invoice date defaults to the payment date and is stored independently of it; it cannot be before the payment date or in the future, and it is never silently recalculated.
- The invoice number prefix is optional (none = prefix OFF). It is stored separately from the numeric invoice number, is copied into each invoice when it is issued, is frozen afterwards, may be changed in settings even after invoices exist (affecting only future invoices), and takes no part in numbering or uniqueness. The numeric invoice number stays globally unique and sequential.
- Prefix validation: 1–20 characters, no leading or trailing whitespace, must not end with a digit; an empty string is invalid.
- Adding the prefix feature never back-fills or alters existing invoices.
- Admin may edit only the invoice number (the numeric part) and invoice date of an issued invoice; the prefix is not editable and stays as issued.
- An issued invoice preserves its financial, customer, business, tax, terms and signatory information; later settings or profile changes never alter it.
- Tax is tax-inclusive: the membership amount is the final amount and tax is back-calculated when tax is enabled.
- Once an invoice is issued for a membership, the application prevents an unsafe Paid → Pending change and the issued invoice is preserved.
- *(V1 Tax Adjustment.)* Each payment has its own document decision and document: a tax invoice from the existing tax invoice sequence, or a clearly identified payment receipt from its own separate sequence. A tax invoice number is never consumed or reused for a payment receipt.
- *(V1 Tax Adjustment.)* Tax invoice issuance is enabled by default, the owner can set a default per student, and the Admin can override it for one payment without changing the student's saved preference. Preferences do not override legal tax obligations.
- *(V1 Tax Adjustment.)* Issued document numbers are permanent and never reused. Corrections are cancel-and-reissue: the original is preserved with its cancellation reason, a link to its replacement and its history, and the replacement receives a new number. Issued documents are never silently overwritten or deleted.
- V1 has no refunds or credit notes.

### Batch
- A batch can have multiple recurring schedules.
- A batch can have more than one schedule on the same weekday, at different times.
- A batch does not have a fixed time.
- Enrolling in a batch does not by itself mean attending every one of its schedules.
- Batch capacity is not required in V1.
- Short code is required.
- Short code must be unique, compared case-insensitively.
- Short codes are normalized to uppercase.
- Inactive batches remain available for historical records.

Short code uniqueness protects identification. The Weekly Schedule identifies a batch by its short code alone, without the batch name, so two batches sharing a code would make a calendar entry ambiguous.

### Schedule
- Schedules recur weekly.
- A batch can have different days/times, including several schedules on the same weekday.
- Every schedule belongs to a schedule series, the stable identity its versions share.
- Editing a schedule creates a new version within the same series, never a new series.
- Student schedule assignments and attendance eligibility refer to the series, so an edit never orphans them.
- A class session records the specific schedule version it came from, while the series identifies which class it is.
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
- A schedule that has been used is deactivated rather than deleted.
- An unused schedule — no class session, a single version, no started assignment — may be deleted, and may be edited directly instead of versioned.
- A schedule with any class session (any status), an earlier version, or a started student assignment is never deleted and is never edited in place.
- A schedule version is never deleted on its own.

Versioning schedule edits is what makes "future changes only" true: a schedule that was rewritten in place would silently change what the past looked like, which §12's Historical Integrity rules forbid.

### Class Session
- Every class session belongs to exactly one recurring schedule.
- There are no ad-hoc class sessions in V1.
- At most one session exists per schedule per date.
- Occurrences are projected from the recurring pattern until a session needs a persistent record.
- A session is materialized on its first session-specific change, cancellation/holiday, or attendance.
- A materialized session snapshots its batch, instructor, date, start time and end time.
- Snapshot values win over later schedule changes.
- Schedule edits, versioning and deactivation never rewrite an existing session.
- Only future unmaterialized occurrences follow the current schedule version.
- Inactive or ended schedule versions produce no further unmaterialized occurrences.
- Materialized sessions are retained and never deleted.
- Persisted session states are scheduled, completed, cancelled and holiday.
- Upcoming, Ongoing, and a displayed Completed reading of a scheduled session past its end time are all derived from the session's date and time in the centre timezone (§7A), never stored.
- A scheduled session past its end time is never automatically persisted as completed — only displayed as Completed.
- A session's stored status becomes completed only when its attendance is saved.
- Duration is derived from start and end time.
- A class session has no product-facing identifier.
- A session's instructor and/or time can be edited without changing the recurring schedule; its date and batch cannot.
- Only an Upcoming session can be edited.
- Editing a session materializes it, and only when the edit actually changes something.
- A session can be marked Cancelled or Holiday, with an optional note, only while its stored status is still scheduled.
- Marking a session Cancelled or Holiday materializes it and does not change the recurring schedule or any other occurrence.
- Marking a session Cancelled or Holiday cannot be reversed in V1.

Materializing only on first touch is what keeps a schedule and its sessions from drifting apart: an untouched occurrence is always a live reading of the current schedule, and a touched one is a fixed historical fact. Storing every occurrence up front would require both a generation job and a reconciliation rule for what to do with rows generated from a schedule version that no longer exists.

### Attendance
- Attendance belongs to a specific class session.
- At most one attendance record exists per student per session.
- Only eligible students appear for attendance.
- Eligibility requires an active student, active batch enrollment covering the session date, a schedule assignment covering the session date for the session's own schedule series, and active membership covering the session date — all evaluated as of the session's own date.
- Being enrolled in a batch is not sufficient; the student must be assigned to the specific schedule the session belongs to.
- A membership cancellation only affects eligibility for session dates on or after the cancellation date.
- V1 statuses are Present and Absent.
- Unmarked is never stored — it is the absence of an attendance record for an eligible student, not a value.
- Attendance can only be taken for a session dated today or earlier, in the centre timezone.
- Saving attendance is allowed with some or all students unmarked, and still completes the session.
- Online/offline does not change attendance status.
- *(V1 Fee Structure.)* Session attendance uses duration-based memberships only. Class-count attendance is a separate workflow (§8), linked to the class-count membership it uses.
- Attendance remains historically available.
- Attendance records are never deleted; a correction updates the record in place.
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
- Stored Invoice / Receipt with invoice settings (V1 Invoice / Receipt Enhancement, §5A)
- Central Documents register: a read-only, Admin-only list of every stored invoice and receipt, issued and cancelled, with search and filters (§5A; Phase 1)
- Payments with installments and mixed payment methods; a tax invoice or payment receipt per payment; cancel-and-reissue corrections (V1 Tax Adjustment, §5, §5A)
- Centre-configured packages with an effective-dated fee history, package discounts, individual discounts with a mandatory reason and an audit record, audited corrections, and class-count packages with an audited expiry edit with their separate, Admin-only Class Count Attendance workflow (a third Attendance tab): a chosen attendance date, confirmation before recording, and audited reversals (V1 Fee Structure, §5, §8, §11)

### Not Included in V1
- Student login
- Online payment gateway
- Automatic billing
- Payment reminders
- Refunds, credit notes, full accounting
- Discount approval workflow
- WhatsApp/SMS/email integrations (a plain WhatsApp click-to-chat / share workflow for the Invoice / Receipt is not an integration)
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
Keep Student, Membership, Batch, Enrollment, Schedule Assignment, Recurring Schedule, Class Session, and Attendance distinct.

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
- Class Sessions — APPROVED
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
