"use client";

import { useId, useState } from "react";
import { BellRing, ChevronDown, CreditCard, Copy, Eye, FileText, Hash, History, Info, Mail, MessageCircle, Send } from "lucide-react";
import Avatar from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { communicationHistoryHref } from "@/lib/communications/core";
import {
  REMINDER_MESSAGE_LABELS,
  REMINDER_UNAVAILABLE,
  buildReminderMessage,
  initialReminderMessageType,
  outstandingBalanceText,
  reminderEmailSubject,
  reminderMailtoUrl,
  reminderMessageTypes,
  reminderWhatsAppUrl,
} from "@/lib/reminders/message";
import { cn } from "@/lib/utils";

const MESSAGE_MAX = 1000;

// The popup's four send-side actions as compact card buttons: a tinted round icon above a short label, one tone per action. A link card
// (`href`) or a button card (`onClick`); a disabled one is a disabled button that keeps its reason (`describedBy`). Literal class strings.
const ACTION_CARD =
  "flex min-w-0 flex-col items-center justify-center gap-1.5 rounded-card border border-border bg-surface px-2 py-3 text-center text-small font-medium text-text-primary transition-colors outline-none hover:border-brand/30 hover:bg-brand/5 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50";
const ACTION_TONE = {
  brand: "bg-brand/10 text-brand",
  success: "bg-success/10 text-success",
  info: "bg-info/10 text-info",
  accent: "bg-brand-accent/10 text-brand-accent",
};

function ActionCard({ icon: Icon, tone, label, href, newTab = false, onClick, disabled = false, describedBy, ariaLabel }) {
  const content = (
    <>
      <span aria-hidden="true" className={cn("flex size-9 items-center justify-center rounded-full", ACTION_TONE[tone])}>
        <Icon className="size-4" />
      </span>
      <span className="leading-tight">{label}</span>
      {newTab ? <span className="sr-only"> (opens in a new tab)</span> : null}
    </>
  );
  if (href && !disabled) {
    return (
      <a href={href} className={ACTION_CARD} aria-label={ariaLabel} {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
        {content}
      </a>
    );
  }
  return (
    <button type="button" className={ACTION_CARD} onClick={onClick} disabled={disabled} aria-describedby={describedBy} aria-label={ariaLabel}>
      {content}
    </button>
  );
}

const COPY_STATUS = {
  copied: "Message copied.",
  failed: "The message could not be copied. Select the text and copy it yourself.",
};

/**
 * The reminder message popup (02-ux.md "Membership & payment reminders" -> "Reminder message"): ONE dialog per membership row or card, opened by
 * the row's reminder (bell) button and by Reminder Message in its More (⋮) menu - both set the same `open`. It says which student and membership
 * it is about, lets the Admin choose the expiry or the payment reminder when both apply, and prepares the approved message, which they can edit.
 *
 * Then the Admin sends it themselves: Copy, Open WhatsApp (a `wa.me` click-to-chat link with the message prefilled, as the membership receipt
 * does) or Open Email (a `mailto:` link to their own email app). Nothing is sent, stored or logged by the application, so no wording says the
 * message was sent. View Communication History opens the student's existing Communication History (Student Details) in a new tab, so the draft
 * here is kept; recording the conversation there stays the Admin's choice.
 *
 * The drafts live in this component (one per reminder type), so switching the type or closing and reopening the popup keeps what was edited.
 *
 * @param {object} props
 * @param {{ expiry?: { daysUntilEnd: number, endDate: string, text: string }, payment?: { balancePaise: number, currency: string|null, text: string } }} props.reminders
 * @param {{ id: string, full_name: string, student_code?: string, photo_url?: string|null, phone?: string|null, phone_country_code?: string|null, email?: string|null }|null} props.student
 * @param {{ code: string, planLabel?: string, period?: string }} props.membership
 * @param {string} props.centreName
 * @param {"expiry"|"payment"} [props.initialType] - the reminder the popup opens on (the Dashboard row's own); expiry first by default.
 */
export default function ReminderMessageDialog({ open, onOpenChange, reminders, student, membership, centreName, initialType }) {
  const types = reminderMessageTypes(reminders);
  const [selected, setSelected] = useState(() => initialReminderMessageType(reminders, initialType));
  const [drafts, setDrafts] = useState({});
  const [copyStatus, setCopyStatus] = useState(null);
  const ids = useId();

  // The reminders can change after a refresh (a payment recorded elsewhere): fall back to one the membership still has.
  const type = types.includes(selected) ? selected : initialReminderMessageType(reminders);
  if (!type) return null;

  const generated = buildReminderMessage(type, {
    studentName: student?.full_name,
    membershipCode: membership?.code,
    centreName,
    expiry: reminders.expiry,
    payment: reminders.payment,
  });
  const message = drafts[type] ?? generated;
  const hasMessage = message.trim().length > 0;
  const whatsAppUrl = hasMessage ? reminderWhatsAppUrl({ phone: student?.phone, phoneCountryCode: student?.phone_country_code }, message) : null;
  const mailtoUrl = hasMessage ? reminderMailtoUrl(student?.email, reminderEmailSubject(type, membership?.code), message) : null;
  const noWhatsApp = !reminderWhatsAppUrl({ phone: student?.phone, phoneCountryCode: student?.phone_country_code }, "");
  const noEmail = !reminderMailtoUrl(student?.email, "", "");

  const messageId = `${ids}-message`;
  const whatsAppNoteId = `${ids}-whatsapp-note`;
  const emailNoteId = `${ids}-email-note`;
  const emptyNoteId = `${ids}-empty-note`;

  function editMessage(value) {
    setDrafts((current) => ({ ...current, [type]: value }));
    setCopyStatus(null);
  }

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(message);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }

  const unavailableNote = (id, text) => (
    <p id={id} className="text-small text-info">
      {text}
    </p>
  );

  // Use Template: put the approved template back (dropping this reminder's edits), choosing which reminder's template when the membership has both.
  function applyTemplate(option) {
    setSelected(option);
    setDrafts((current) => {
      const next = { ...current };
      delete next[option];
      return next;
    });
    setCopyStatus(null);
  }

  const isPayment = type === "payment";
  const reminderLabel = isPayment ? "Outstanding Balance" : "Membership Expiry";
  const reminderValue = isPayment ? outstandingBalanceText(reminders.payment.balancePaise, reminders.payment.currency) : reminders.expiry.text;
  const membershipId = membership?.id;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl overflow-hidden">
        <DialogHeader className="flex-row items-center gap-3">
          <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-info/10 text-info">
            <Send className="size-5" />
          </span>
          <div className="min-w-0">
            <DialogTitle>Reminder message</DialogTitle>
            <DialogDescription className="text-small">Prepare the message, then send it yourself. Nothing is sent from the application.</DialogDescription>
          </div>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          {/* Who and which membership. */}
          <div className="flex items-center gap-3 rounded-card border border-border bg-background/60 px-3 py-2.5">
            <Avatar name={student?.full_name} src={student?.photo_url} size="md" className="shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-body truncate font-semibold text-text-primary">{student?.full_name ?? "—"}</p>
              <p className="text-small flex flex-wrap items-center gap-x-3 gap-y-0.5 text-text-secondary">
                {student?.student_code ? (
                  <span className="inline-flex items-center gap-1">
                    <Hash className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="sr-only">Student ID: {student.student_code}</span>
                    <span aria-hidden="true">{student.student_code}</span>
                  </span>
                ) : null}
                <span className="inline-flex min-w-0 items-center gap-1">
                  <CreditCard className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{[membership?.code, membership?.planLabel, membership?.period].filter(Boolean).join(" · ")}</span>
                </span>
              </p>
            </div>
            {student?.id ? (
              <Button
                variant="secondary"
                size="icon-sm"
                className="shrink-0"
                aria-label={`View Details of ${student.full_name ?? "the student"} (opens in a new tab)`}
                title="View student details"
                render={<a href={`/students/${student.id}`} target="_blank" rel="noopener noreferrer" />}
                nativeButton={false}
              >
                <Eye className="size-4" aria-hidden="true" />
              </Button>
            ) : null}
          </div>

          {/* The reminder itself, in red. With both reminders the Admin chooses which one to prepare. */}
          {types.length > 1 ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-small mb-2 font-medium text-text-primary">Reminder</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {types.map((option) => (
                  <label
                    key={option}
                    className={cn(
                      "flex cursor-pointer items-start gap-2.5 rounded-card border px-3 py-2.5 transition-colors has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
                      option === type ? "border-danger/40 bg-danger/5" : "border-border hover:bg-background"
                    )}
                  >
                    <input
                      type="radio"
                      name={`${ids}-type`}
                      value={option}
                      checked={option === type}
                      onChange={() => {
                        setSelected(option);
                        setCopyStatus(null);
                      }}
                      className="mt-0.5 accent-danger"
                    />
                    <span className="min-w-0">
                      <span className="text-body block font-medium text-text-primary">{REMINDER_MESSAGE_LABELS[option]}</span>
                      <span className="text-small block font-medium text-danger">{reminders[option].text}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-danger/20 bg-danger/5 p-3">
            <div className="flex min-w-0 items-center gap-3">
              <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-danger/10 text-danger">
                <BellRing className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="text-small text-danger">
                  <span className="sr-only">{REMINDER_MESSAGE_LABELS[type]}: </span>
                  {reminderLabel}
                </p>
                <p className="text-section-title font-semibold break-words text-danger tabular-nums">{reminderValue}</p>
              </div>
            </div>
            {membershipId ? (
              <Button variant="outline" size="sm" className="border-danger/30 text-danger hover:bg-danger/10 hover:text-danger" render={<a href={`/memberships/${membershipId}`} target="_blank" rel="noopener noreferrer" />} nativeButton={false}>
                <CreditCard className="size-4" aria-hidden="true" />
                {isPayment ? "View Payments" : "View Membership"}
                <span className="sr-only"> (opens in a new tab)</span>
              </Button>
            ) : null}
          </div>

          {/* The message, editable, with the approved template one click away. */}
          <section className="flex flex-col gap-3 rounded-card border border-border bg-surface p-3">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor={messageId} className="text-body font-semibold">Message</Label>
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" className="text-info" />}>
                  <FileText className="size-4" aria-hidden="true" />
                  Use Template
                  <ChevronDown className="size-4" aria-hidden="true" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-48">
                  {types.map((option) => (
                    <DropdownMenuItem key={option} onClick={() => applyTemplate(option)}>
                      {REMINDER_MESSAGE_LABELS[option]} template
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="flex flex-col gap-1">
              <Textarea
                id={messageId}
                value={message}
                onChange={(event) => editMessage(event.target.value)}
                rows={10}
                maxLength={MESSAGE_MAX}
                className="min-h-44 resize-y"
                aria-describedby={hasMessage ? undefined : emptyNoteId}
              />
              <p className="text-small text-right text-text-secondary tabular-nums" aria-live="polite">
                {message.length}/{MESSAGE_MAX}
              </p>
              {hasMessage ? null : unavailableNote(emptyNoteId, "Write a message to copy or send it.")}
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <ActionCard
                icon={Copy}
                tone="brand"
                label="Copy"
                ariaLabel="Copy Message"
                onClick={copyMessage}
                disabled={!hasMessage}
                describedBy={hasMessage ? undefined : emptyNoteId}
              />
              <ActionCard
                icon={MessageCircle}
                tone="success"
                label="WhatsApp"
                ariaLabel={whatsAppUrl ? "Open WhatsApp (opens in a new tab)" : "Open WhatsApp"}
                href={whatsAppUrl}
                newTab
                disabled={!whatsAppUrl}
                describedBy={whatsAppUrl ? undefined : noWhatsApp ? whatsAppNoteId : emptyNoteId}
              />
              <ActionCard
                icon={Mail}
                tone="info"
                label="Email"
                ariaLabel="Open Email"
                href={mailtoUrl}
                disabled={!mailtoUrl}
                describedBy={mailtoUrl ? undefined : noEmail ? emailNoteId : emptyNoteId}
              />
              {student?.id ? (
                <ActionCard
                  icon={History}
                  tone="accent"
                  label="History"
                  ariaLabel="View Communication History (opens in a new tab)"
                  href={communicationHistoryHref(student.id)}
                  newTab
                />
              ) : null}
            </div>

            {noWhatsApp || noEmail ? (
              <div className="flex items-start gap-2.5 rounded-card border border-info/20 bg-info/5 px-3 py-2.5">
                <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden="true" />
                <div className="flex flex-col gap-1">
                  {noWhatsApp ? unavailableNote(whatsAppNoteId, REMINDER_UNAVAILABLE.whatsApp) : null}
                  {noEmail ? unavailableNote(emailNoteId, REMINDER_UNAVAILABLE.email) : null}
                </div>
              </div>
            ) : null}

            <p role="status" className={cn("text-small", copyStatus === "failed" ? "text-danger" : "text-success", !copyStatus && "sr-only")}>
              {copyStatus ? COPY_STATUS[copyStatus] : ""}
            </p>
          </section>
        </DialogBody>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
