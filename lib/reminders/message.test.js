// Run with `npm test` (Node's built-in test runner).
//
// The reminder message popup (02-ux.md "Membership & payment reminders" -> "Reminder message"). The message, the choice of reminder and the
// WhatsApp / email links are pure and tested by running them; the popup and its two openers need the Next.js runtime, so - the project's way -
// their wiring is pinned from source. Browser behaviour (clipboard, opening WhatsApp or the email app) is not proved here.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  REMINDER_MESSAGE_TEMPLATES,
  REMINDER_UNAVAILABLE,
  buildReminderMessage,
  expiryStatusPhrase,
  initialReminderMessageType,
  reminderEmailSubject,
  reminderMailtoUrl,
  reminderMessageTypes,
  reminderWhatsAppUrl,
} from "./message.js";
import { collectReminders } from "./rules.js";
import { remindersByMembership } from "./presentation.js";
import { COMMUNICATION_HISTORY_ANCHOR, communicationHistoryHref } from "../communications/core.js";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

const BOTH = {
  expiry: { daysUntilEnd: 3, endDate: "2026-11-20", text: "Expires in 3 days" },
  payment: { balancePaise: 150000, currency: "INR", text: "Balance ₹1,500.00" },
};
const context = (overrides = {}) => ({ studentName: "Asha Rao", membershipCode: "MEM-0042", centreName: "Lotus Yoga", ...BOTH, ...overrides });

// ---- the message -----------------------------------------------------------------------------------------------------------------------------

test("expiry message: the approved template, filled with the student, membership, expiry status and centre", () => {
  assert.equal(
    buildReminderMessage("expiry", context()),
    "Dear Asha Rao,\n\nYour yoga membership (MEM-0042) will expire on Nov 20, 2026.\n\nWe invite you to renew your membership to continue attending classes.\n\nPlease contact us if you need any assistance.\n\nThank you,\nLotus Yoga"
  );
});

test("payment message: the approved template with the outstanding balance in the membership's currency", () => {
  assert.equal(
    buildReminderMessage("payment", context()),
    "Dear Asha Rao,\n\nOur records show an outstanding balance of ₹1,500.00 for your yoga membership (MEM-0042).\n\nKindly arrange the pending payment. If you have already paid, please contact us so we can verify the payment.\n\nThank you,\nLotus Yoga"
  );
  assert.match(buildReminderMessage("payment", context({ payment: { balancePaise: 1999, currency: "USD" } })), /outstanding balance of \$19\.99 for/);
});

test("expiry status follows the days left: future, today, already expired - never a wrong tense", () => {
  assert.equal(expiryStatusPhrase(6, "2026-10-29"), "will expire on Oct 29, 2026");
  assert.equal(expiryStatusPhrase(0, "2026-10-23"), "expires today");
  assert.equal(expiryStatusPhrase(-5, "2026-10-18"), "expired on Oct 18, 2026");
  assert.equal(expiryStatusPhrase(undefined, null), "is due for renewal");
  assert.equal(expiryStatusPhrase(2, null), "is due to expire soon");
  assert.equal(expiryStatusPhrase(-2, null), "has expired");
});

test("templates: every placeholder is filled, and missing names never leave a {placeholder} or 'undefined' in the message", () => {
  for (const type of Object.keys(REMINDER_MESSAGE_TEMPLATES)) {
    for (const ctx of [context(), context({ studentName: null, membershipCode: "", centreName: undefined })]) {
      const message = buildReminderMessage(type, ctx);
      assert.ok(message.startsWith("Dear "), type);
      assert.doesNotMatch(message, /\{\w+\}|undefined|null/, type);
    }
  }
  const unnamed = buildReminderMessage("expiry", context({ studentName: "  ", membershipCode: null, centreName: "" }));
  assert.ok(unnamed.startsWith("Dear Student,") && unnamed.includes("membership (your membership)") && unnamed.endsWith("Thank you,"));
});

test("no message for a reminder the membership does not have, or an unknown type", () => {
  assert.equal(buildReminderMessage("payment", context({ payment: undefined })), "");
  assert.equal(buildReminderMessage("sms", context()), "");
  assert.equal(buildReminderMessage("expiry", null), "");
});

// ---- choosing the reminder -------------------------------------------------------------------------------------------------------------------

test("selection: both reminders offered (expiry first) when both apply; one when one applies; the requested one when it applies", () => {
  assert.deepEqual(reminderMessageTypes(BOTH), ["expiry", "payment"]);
  assert.deepEqual(reminderMessageTypes({ payment: BOTH.payment }), ["payment"]);
  assert.deepEqual(reminderMessageTypes(undefined), []);
  assert.equal(initialReminderMessageType(BOTH), "expiry");
  assert.equal(initialReminderMessageType(BOTH, "payment"), "payment");
  assert.equal(initialReminderMessageType({ payment: BOTH.payment }, "expiry"), "payment", "a type it does not have is never chosen");
  assert.equal(initialReminderMessageType({}), null);
});

// ---- WhatsApp and email ----------------------------------------------------------------------------------------------------------------------

test("WhatsApp: the existing click-to-chat link with the whole message encoded, newlines included; none without a usable number", () => {
  const message = buildReminderMessage("expiry", context());
  const url = reminderWhatsAppUrl({ phone: "98765 43210", phoneCountryCode: "+91" }, message);
  assert.ok(url.startsWith("https://wa.me/919876543210?text="));
  assert.equal(decodeURIComponent(url.split("?text=")[1]), message);
  assert.ok(url.includes("%0A%0A") && !url.includes("\n") && !url.includes(" "));
  assert.equal(reminderWhatsAppUrl({ phone: "", phoneCountryCode: "+91" }, message), null);
  assert.equal(reminderWhatsAppUrl({ phone: "123" }, message), null);
  assert.equal(reminderWhatsAppUrl(null, message), null);
});

test("email: a mailto link with the address, subject and message, paragraphs sent as CRLF and every part encoded; none without an address", () => {
  const message = buildReminderMessage("payment", context());
  const subject = reminderEmailSubject("payment", "MEM-0042");
  assert.equal(subject, "Payment reminder - MEM-0042");
  assert.equal(reminderEmailSubject("expiry", "MEM-0042"), "Membership renewal reminder - MEM-0042");
  assert.equal(reminderEmailSubject("expiry", null), "Membership renewal reminder");

  const url = reminderMailtoUrl(" asha@example.com ", subject, message);
  assert.ok(url.startsWith("mailto:asha@example.com?subject=Payment%20reminder%20-%20MEM-0042&body="));
  const body = decodeURIComponent(url.split("&body=")[1]);
  assert.equal(body, message.replace(/\n/g, "\r\n"));
  assert.ok(!/[\s&?#]/.test(url.split("&body=")[1]), "nothing in the body can break the link");
  const tricky = reminderMailtoUrl("a@b.co", "x", "Fees & dues? 100% #1");
  assert.equal(decodeURIComponent(tricky.split("&body=")[1]), "Fees & dues? 100% #1");

  for (const email of [null, "", "   ", "not-an-email", "a@b"]) assert.equal(reminderMailtoUrl(email, subject, message), null, String(email));
});

test("unavailable actions are explained, never silently missing", () => {
  assert.match(REMINDER_UNAVAILABLE.whatsApp, /no registered mobile number/);
  assert.match(REMINDER_UNAVAILABLE.email, /no email address/);
});

test("View Communication History opens the existing Student Details panel for that student", () => {
  assert.equal(COMMUNICATION_HISTORY_ANCHOR, "communication-history");
  assert.equal(communicationHistoryHref("stu-1"), "/students/stu-1#communication-history");
  const panel = code("app/students/[id]/communications/communication-history.js");
  assert.ok(panel.includes('<Panel id={COMMUNICATION_HISTORY_ANCHOR} className="scroll-mt-6">'));
});

// ---- eligibility is unchanged --------------------------------------------------------------------------------------------------------------

test("eligibility is the reminder rules' alone: the popup reads the same grouped reminders and does not filter or add any", () => {
  const today = "2026-10-23";
  const memberships = [
    { id: "m1", student_id: "s1", start_date: "2026-09-27", end_date: "2026-10-26", payment_status: "pending", amount: 1500 },
    { id: "m2", student_id: "s2", start_date: "2026-10-01", end_date: "2027-03-31", payment_status: "paid", amount: 3000 },
  ];
  const reminders = collectReminders({ memberships, today, balancePaiseById: { m1: 150000, m2: 0 } });
  const grouped = remindersByMembership(reminders);
  assert.deepEqual(reminderMessageTypes(grouped.m1), ["expiry", "payment"]);
  assert.deepEqual(reminderMessageTypes(grouped.m2), []);

  for (const path of ["lib/reminders/message.js", "app/memberships/reminder-message-dialog.js", "app/memberships/membership-reminder-message.js"]) {
    const source = code(path);
    assert.doesNotMatch(source, /collectReminders|expiryReminderOf|paymentReminderOf|isLatestEndingMembership|getReminders/, path);
  }
});

// ---- the popup and its two openers ------------------------------------------------------------------------------------------------------------

test("rows AND cards: the red bell button and the More menu's Reminder Message open the SAME popup instance", () => {
  for (const path of ["app/memberships/membership-table.js", "app/memberships/membership-card-item.js"]) {
    const source = code(path);
    assert.ok(source.includes("const [reminderOpen, setReminderOpen] = useState(false);"), path);
    assert.ok(source.includes("<ReminderMessageButton reminders={reminders} studentName={student?.full_name} onClick={() => setReminderOpen(true)} />"), path);
    assert.ok(source.includes("onOpenReminderMessage={() => setReminderOpen(true)}"), path);
    assert.equal((source.match(/<MembershipReminderMessage\b/g) ?? []).length, 1, path);
    assert.match(source, /<MembershipReminderMessage\s+membership=\{membership\}\s+reminders=\{reminders\}\s+centreName=\{centreName\}\s+open=\{reminderOpen\}\s+onOpenChange=\{setReminderOpen\}/);
    assert.ok(source.indexOf("<ReminderMessageButton") < source.indexOf("<MembershipCardMenu"), `${path}: the bell sits outside, before the menu`);
  }
  const menu = code("app/memberships/membership-card-menu.js");
  assert.match(menu, /\{onOpenReminderMessage \? <DropdownMenuItem onClick=\{onOpenReminderMessage\}>\s*\{icon\(BellRing\)\}\s*Reminder Message\s*<\/DropdownMenuItem> : null\}/);
  assert.ok(menu.indexOf("Reminder Message") < menu.indexOf("<DropdownMenuSeparator />"), "inside the menu's reminders section");
});

test("the bell button: red, labelled, and only while the membership has a reminder", () => {
  const opener = code("app/memberships/membership-reminder-message.js");
  assert.ok(opener.includes("if (!hasReminder(reminders)) return null;"));
  assert.ok(opener.includes('className="shrink-0 text-danger hover:bg-danger/10 hover:text-danger"'));
  assert.ok(opener.includes("aria-label={label}"));
  assert.ok(opener.includes("<BellRing"));
});

test("reminder text is red (design token) in the menu and the popup", () => {
  const menu = code("app/memberships/membership-card-menu.js");
  assert.ok(menu.includes('font-medium text-danger">{reminders.expiry.text}') && menu.includes('font-medium text-danger">{reminders.payment.text}'));
  assert.doesNotMatch(menu, /text-warning/);
  const dialog = code("app/memberships/reminder-message-dialog.js");
  assert.ok(dialog.includes('font-medium text-danger">{reminders[option].text}'));
  assert.ok(dialog.includes("text-danger"));
  assert.doesNotMatch(dialog, /#[0-9a-f]{3,6}\b/i, "no raw colours");
});

test("the popup: identifies the student and membership, offers the choice only when both apply, and the message is editable", () => {
  const dialog = code("app/memberships/reminder-message-dialog.js");
  // The compact student strip (avatar, name, Student ID, membership line) with an eye icon button to Student Details, and the red reminder
  // card (View Payments / View Membership).
  assert.ok(dialog.includes("{student?.full_name ?? \"—\"}") && dialog.includes("Student ID: {student.student_code}"));
  assert.ok(dialog.includes("[membership?.code, membership?.planLabel, membership?.period].filter(Boolean).join(\" · \")"));
  assert.match(dialog, /<Button\s+variant="secondary"\s+size="icon-sm"[\s\S]*?aria-label=\{`View Details of [^`]*\(opens in a new tab\)`\}[\s\S]*?render=\{<a href=\{`\/students\/\$\{student\.id\}`\} target="_blank" rel="noopener noreferrer" \/>\}[\s\S]*?<Eye className="size-4" aria-hidden="true" \/>/);
  assert.ok(dialog.includes('{isPayment ? "View Payments" : "View Membership"}'));
  assert.ok(dialog.includes("Use Template") && dialog.includes("{message.length}/{MESSAGE_MAX}"));
  assert.ok(dialog.includes("{types.length > 1 ? ("));
  assert.ok(dialog.includes('type="radio"'));
  assert.ok(dialog.includes("<Textarea") && dialog.includes("onChange={(event) => editMessage(event.target.value)}"));
  assert.ok(dialog.includes("const message = drafts[type] ?? generated;"), "an edited draft wins over the template, per type");
});

test("the popup's actions: Copy, WhatsApp, Email and History; disabled with a reason when contact data is missing; no claim of sending", () => {
  const dialog = code("app/memberships/reminder-message-dialog.js");
  assert.ok(dialog.includes("navigator.clipboard.writeText(message)"));
  // Four compact card buttons: Copy, WhatsApp (new tab), Email (mailto) and History (new tab, so the draft is kept).
  assert.match(dialog, /<ActionCard\s+icon=\{Copy\}[\s\S]*?onClick=\{copyMessage\}/);
  assert.match(dialog, /<ActionCard\s+icon=\{MessageCircle\}[\s\S]*?href=\{whatsAppUrl\}\s+newTab/);
  assert.match(dialog, /<ActionCard\s+icon=\{Mail\}[\s\S]*?href=\{mailtoUrl\}/);
  assert.match(dialog, /<ActionCard\s+icon=\{History\}[\s\S]*?href=\{communicationHistoryHref\(student\.id\)\}\s+newTab/, "a new tab keeps the draft");
  assert.ok(dialog.includes('{...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}'));
  assert.ok(dialog.includes('<div className="grid grid-cols-2 gap-2 sm:grid-cols-4">'), "one row of four, two by two on a phone");
  // Disabled with its reason when contact data (or the message) is missing.
  assert.ok(dialog.includes("describedBy={whatsAppUrl ? undefined : noWhatsApp ? whatsAppNoteId : emptyNoteId}") && dialog.includes("REMINDER_UNAVAILABLE.whatsApp"));
  assert.ok(dialog.includes("describedBy={mailtoUrl ? undefined : noEmail ? emailNoteId : emptyNoteId}") && dialog.includes("REMINDER_UNAVAILABLE.email"));
  assert.ok(dialog.includes("disabled={disabled} aria-describedby={describedBy}"));
  assert.ok(dialog.includes("Nothing is sent from the application."));
  assert.doesNotMatch(dialog, /\b(sent successfully|message sent|was sent|delivered)\b/i);
  // No new messaging integration and no automatic history record.
  assert.doesNotMatch(dialog, /fetch\(|"use server"|recordStudentCommunication|record_student_communication|supabase/);
});

test("the list read carries the student's contact details, and the page the centre's name, for the message", () => {
  const data = read("lib/memberships/data.js");
  assert.match(data, /const LIST_COLUMNS =[\s\S]*?students\(id, full_name, student_code, photo_url, phone, phone_country_code, email\)"/);
  const page = code("app/memberships/page.js");
  assert.match(page, /getCenterSettings\(\)\s*\.then\(\(settings\) => settings\.name\)\s*\.catch\(\(\) => DEFAULT_CENTER_SETTINGS\.name\)/);
  assert.match(page, /reminders=\{reminders\}\s+centreName=\{centreName\}/);
});

// ---- one primary action ----------------------------------------------------------------------------------------------------------------------

test("primary action: the red bell REPLACES the document icon while any reminder applies; otherwise the document icon - never both", () => {
  for (const path of ["app/memberships/membership-table.js", "app/memberships/membership-card-item.js"]) {
    const source = code(path);
    const gate = source.indexOf("{hasReminder(reminders) ? (");
    const bell = source.indexOf("<ReminderMessageButton", gate);
    const otherwise = source.indexOf(") : (", bell);
    const documentIcon = source.indexOf("<DocumentIcon", otherwise);
    const menu = source.indexOf("<MembershipCardMenu");
    assert.ok(gate > 0 && gate < bell && bell < otherwise && otherwise < documentIcon && documentIcon < menu, `${path}: bell, else document icon, then the menu`);
    assert.equal((source.match(/<ReminderMessageButton/g) ?? []).length, 1, `${path}: one bell, whichever reminders apply`);
    assert.equal((source.match(/<DocumentIcon/g) ?? []).length, 1, path);
    assert.ok(source.includes("<MembershipCardMenu"), `${path}: the More menu is rendered for every membership`);
  }
});

test("primary action: one bell for payment, expiry or both - the grouped reminders decide, not payment status or dates", () => {
  // The component file is JSX with aliased imports, so the one-line predicate is run from its source.
  const body = code("app/memberships/membership-reminder-message.js").match(/export function hasReminder\(reminders\) \{\s*return ([^;]+);/)[1];
  const hasReminder = new Function("reminders", `return ${body};`);
  assert.equal(hasReminder(undefined), false);
  assert.equal(hasReminder({}), false);
  assert.equal(hasReminder({ payment: BOTH.payment }), true);
  assert.equal(hasReminder({ expiry: BOTH.expiry }), true);
  assert.equal(hasReminder(BOTH), true);
  const source = code("app/memberships/membership-reminder-message.js");
  assert.ok(source.includes("Boolean(reminders?.expiry || reminders?.payment)"));
  for (const path of ["app/memberships/membership-table.js", "app/memberships/membership-card-item.js"]) {
    assert.doesNotMatch(code(path).slice(code(path).indexOf("{hasReminder(reminders)"), code(path).indexOf("<MembershipCardMenu")), /payment_status|end_date/, path);
  }
});

test("More menu: the document action is always in it (so it stays reachable when the bell replaces the icon); Reminder Message only inside the reminders section", () => {
  const menu = code("app/memberships/membership-card-menu.js");
  assert.ok(menu.includes("{documentAction.label}") && menu.includes("onClick={onIssueInvoice}"));
  assert.ok(menu.includes("{reminders?.expiry || reminders?.payment ? ("), "no reminder: no Reminder Message item");
  assert.ok(menu.indexOf("Reminder Message") > menu.indexOf("{reminders?.expiry || reminders?.payment ? (") && menu.indexOf("Reminder Message") < menu.indexOf("View Membership"));
  assert.equal((menu.match(/Reminder Message/g) ?? []).length, 1);
});

test("alignment: the bell and the document icon are the same icon-sm ghost button in the same slot, so the More menu never moves", () => {
  const bell = code("app/memberships/membership-reminder-message.js");
  assert.ok(bell.includes('variant="ghost"') && bell.includes('size="icon-sm"') && bell.includes('className="shrink-0 text-danger hover:bg-danger/10 hover:text-danger"'));
  for (const path of ["app/memberships/membership-table.js", "app/memberships/membership-card-item.js"]) {
    assert.ok(code(path).includes('size="icon-sm"'), path);
  }
});

// ---- Dashboard reminder rows ----------------------------------------------------------------------------------------------------------------

test("Dashboard: every reminder row carries the actions - the red bell and the More menu - beside, not inside, the row's link", () => {
  const panel = code("app/dashboard-reminders.js");
  assert.ok(panel.includes("<DashboardReminderActions reminder={reminder} reminders={membershipReminders} centreName={centreName} />"));
  const link = panel.indexOf("<Link"), linkEnd = panel.indexOf("</Link>"), actions = panel.indexOf("<DashboardReminderActions");
  assert.ok(link > 0 && linkEnd > link && actions > linkEnd, "buttons are never nested inside the link");
  assert.equal((panel.match(/<DashboardReminderActions/g) ?? []).length, 1, "one per row, every row");
  assert.ok(panel.includes("const byMembership = remindersByMembership(reminders);") && panel.includes("membershipReminders={byMembership[reminder.membershipId]}"), "grouped from the listed reminders, not recomputed");
  assert.doesNotMatch(panel, /collectReminders|expiryReminderOf|paymentReminderOf|payment_status|end_date/);
});

test("Dashboard actions: the Send Reminder button and the menu's Reminder Message open the SAME shared popup, on the row's own reminder, with the right student and membership", () => {
  const actions = code("app/dashboard-reminder-actions.js");
  assert.ok(actions.includes("onClick={() => setReminderOpen(true)}") && actions.includes("Send Reminder"), "the labelled opener");
  assert.ok(actions.includes("onOpenReminderMessage={() => setReminderOpen(true)}"));
  assert.equal((actions.match(/<MembershipReminderMessage\b/g) ?? []).length, 1, "one popup instance per row");
  assert.ok(actions.includes("initialType={reminder.type}"), "opens on the row's own reminder");
  assert.ok(actions.includes("const { student, membership } = reminder;"));
  for (const field of ["id: membership.id", "membership_code: membership.code", "package_name: membership.packageName", "start_date: membership.startDate", "end_date: membership.endDate",
    "id: student.id", "full_name: student.fullName", "student_code: student.studentCode", "photo_url: student.photoUrl", "phone: student.phone", "phone_country_code: student.phoneCountryCode", "email: student.email"]) {
    assert.ok(actions.includes(field), field);
  }
  assert.ok(actions.indexOf("Send Reminder") < actions.indexOf("<MembershipCardMenu"), "the button, then More");
  // Reuse: the Memberships list's own components - no second popup, no second message builder.
  assert.ok(actions.includes('from "@/app/memberships/membership-card-menu"') && actions.includes('from "@/app/memberships/membership-reminder-message"'));
  assert.doesNotMatch(actions, /ReminderMessageDialog|buildReminderMessage|reminderWhatsAppUrl|reminderMailtoUrl/);
});

test("Dashboard menu: the Memberships menu's actions, without the document item the Dashboard has no data for; Reminder Message only inside reminders", () => {
  const actions = code("app/dashboard-reminder-actions.js");
  assert.ok(actions.includes("hideDocumentAction"));
  const menu = code("app/memberships/membership-card-menu.js");
  assert.ok(menu.includes("hideDocumentAction = false,"), "the Memberships list is unchanged by default");
  assert.ok(menu.includes("const showDocumentAction = !hideDocumentAction") && menu.includes("{!showDocumentAction ? null : documentAction.href ? ("));
  for (const label of ["View Membership", "Edit Membership", "Renew Membership", "View Student", "Record Payment", "Reminder Message"]) assert.ok(menu.includes(label), label);
  for (const path of ["app/memberships/membership-table.js", "app/memberships/membership-card-item.js"]) {
    assert.doesNotMatch(code(path), /hideDocumentAction/, `${path}: Memberships list behaviour unchanged`);
  }
});

test("Dashboard popup context: the page passes the centre's name; the reminder read adds the student's contact details and nothing else", () => {
  const page = code("app/page.js");
  assert.ok(page.includes("<DashboardReminders result={reminders} centreName={centreName} />"));
  assert.match(page, /getCenterSettings\(\)\.then\(\(settings\) => settings\.name\)\.catch\(\(\) => DEFAULT_CENTER_SETTINGS\.name\)/);
  assert.ok(page.includes("isAdmin ? getReminders().catch(() => null) : Promise.resolve(null)"), "Admin-only read, unchanged");
  const core = code("lib/reminders/data-core.js");
  assert.ok(core.includes("students(id, full_name, student_code, photo_url, phone, phone_country_code, email)"));
  assert.ok(core.includes("phone: membership.students?.phone ?? null") && core.includes("email: membership.students?.email ?? null"));
});

test("the popup opens on the requested reminder when the membership has it, else the first it has", () => {
  assert.equal(initialReminderMessageType(BOTH, "payment"), "payment");
  assert.equal(initialReminderMessageType(BOTH, "expiry"), "expiry");
  assert.equal(initialReminderMessageType({ expiry: BOTH.expiry }, "payment"), "expiry");
  const dialog = code("app/memberships/reminder-message-dialog.js");
  assert.ok(dialog.includes("useState(() => initialReminderMessageType(reminders, initialType))"));
  assert.ok(dialog.includes("{types.length > 1 ? ("), "both types: the Admin chooses");
});
