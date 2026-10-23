// The reminder message popup's text and links (02-ux.md "Membership & payment reminders" -> "Reminder message"). Pure: relative imports only, so
// `npm test` loads it and the client popup can use it. It only words a message the Admin sends themselves - through a plain `wa.me` click-to-chat
// link (`lib/whatsapp.js`, as the membership receipt does) or a `mailto:` link to their own email app. Nothing is sent, stored or logged by the
// application, and nothing here decides whether a reminder applies: that is lib/reminders/rules.js, unchanged.

import { formatCurrency } from "../currencies.js";
import { formatDate } from "../format.js";
import { fromPaise } from "../memberships/payments-core.js";
import { buildWhatsAppUrl } from "../whatsapp.js";
import { REMINDER_TYPES } from "./rules.js";

/** The approved templates. `{placeholders}` are filled by `buildReminderMessage`; the Admin can edit the result before sending it. */
export const REMINDER_MESSAGE_TEMPLATES = Object.freeze({
  [REMINDER_TYPES.EXPIRY]:
    "Dear {studentName},\n\nYour yoga membership ({membershipCode}) {expiryStatus}.\n\nWe invite you to renew your membership to continue attending classes.\n\nPlease contact us if you need any assistance.\n\nThank you,\n{centreName}",
  [REMINDER_TYPES.PAYMENT]:
    "Dear {studentName},\n\nOur records show an outstanding balance of {outstandingBalance} for your yoga membership ({membershipCode}).\n\nKindly arrange the pending payment. If you have already paid, please contact us so we can verify the payment.\n\nThank you,\n{centreName}",
});

/** The popup's choice labels, in the order the popup lists them. */
export const REMINDER_MESSAGE_LABELS = Object.freeze({
  [REMINDER_TYPES.EXPIRY]: "Expiry reminder",
  [REMINDER_TYPES.PAYMENT]: "Payment reminder",
});

/** Why a send action is unavailable - shown beside the disabled action, never a silent no-op. */
export const REMINDER_UNAVAILABLE = Object.freeze({
  whatsApp: "WhatsApp is unavailable: this student has no registered mobile number.",
  email: "Email is unavailable: this student has no email address.",
});

/**
 * The expiry sentence's ending from `daysUntilEnd` (end date minus the centre's today): "will expire on Nov 20, 2026", "expires today",
 * "expired on Oct 10, 2026". Without a usable end date or day count it stays factual: "is due for renewal".
 */
export function expiryStatusPhrase(daysUntilEnd, endDate) {
  if (!Number.isInteger(daysUntilEnd)) return "is due for renewal";
  if (daysUntilEnd === 0) return "expires today";
  if (!endDate) return daysUntilEnd > 0 ? "is due to expire soon" : "has expired";
  return daysUntilEnd > 0 ? `will expire on ${formatDate(endDate)}` : `expired on ${formatDate(endDate)}`;
}

/** The outstanding balance in the membership's own currency, as the reminder badges show it: "₹1,500.00". */
export function outstandingBalanceText(balancePaise, currency) {
  return formatCurrency(fromPaise(balancePaise), currency ?? undefined);
}

const fill = (template, values) => template.replace(/\{(\w+)\}/g, (match, key) => (key in values ? values[key] : match));

/**
 * The message for one reminder of one membership, from the approved template.
 *
 * @param {"expiry"|"payment"} type
 * @param {{ studentName?: string|null, membershipCode?: string|null, centreName?: string|null,
 *   expiry?: { daysUntilEnd: number, endDate: string|null }, payment?: { balancePaise: number, currency: string|null } }} context
 * @returns {string} "" for a type without a template or without that reminder's data.
 */
export function buildReminderMessage(type, context) {
  const template = REMINDER_MESSAGE_TEMPLATES[type];
  const reminder = context?.[type];
  if (!template || !reminder) return "";

  const values = {
    studentName: context.studentName?.trim() || "Student",
    membershipCode: context.membershipCode?.trim() || "your membership",
    centreName: context.centreName?.trim() || "",
  };
  if (type === REMINDER_TYPES.EXPIRY) values.expiryStatus = expiryStatusPhrase(reminder.daysUntilEnd, reminder.endDate);
  if (type === REMINDER_TYPES.PAYMENT) values.outstandingBalance = outstandingBalanceText(reminder.balancePaise, reminder.currency);
  return fill(template, values).trimEnd();
}

/**
 * The reminder types a membership currently has, expiry first - the popup's choices. One entry of `remindersByMembership`.
 *
 * @returns {("expiry"|"payment")[]}
 */
export function reminderMessageTypes(reminders) {
  return [REMINDER_TYPES.EXPIRY, REMINDER_TYPES.PAYMENT].filter((type) => Boolean(reminders?.[type]));
}

/** The type the popup opens on: the requested one when the membership has it, otherwise the first it has (expiry before payment). */
export function initialReminderMessageType(reminders, requested) {
  const types = reminderMessageTypes(reminders);
  return types.includes(requested) ? requested : (types[0] ?? null);
}

/** The click-to-chat link with the message prefilled (encoded), or null when the student has no usable mobile number. */
export function reminderWhatsAppUrl(contact, message) {
  return buildWhatsAppUrl(contact?.phone, message, contact?.phoneCountryCode);
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The subject line for the email app. */
export function reminderEmailSubject(type, membershipCode) {
  const code = membershipCode?.trim();
  const subject = type === REMINDER_TYPES.PAYMENT ? "Payment reminder" : "Membership renewal reminder";
  return code ? `${subject} - ${code}` : subject;
}

/**
 * A `mailto:` link that opens the Admin's own email app with the address, subject and message filled in, or null without a usable address. Line
 * breaks are sent as CRLF (RFC 6068) and every part is percent-encoded, so the message arrives with its paragraphs intact.
 */
export function reminderMailtoUrl(email, subject, message) {
  const address = String(email ?? "").trim();
  if (!EMAIL_PATTERN.test(address)) return null;
  const encode = (value) => encodeURIComponent(String(value ?? "").replace(/\r?\n/g, "\r\n"));
  return `mailto:${encodeURIComponent(address).replace(/%40/g, "@")}?subject=${encode(subject)}&body=${encode(message)}`;
}
