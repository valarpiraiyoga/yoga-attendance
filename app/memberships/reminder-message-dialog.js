"use client";

import { useId, useState } from "react";
import { BellRing, ChevronDown, CreditCard, Copy, ExternalLink, FileText, History, Info, Mail, MessageCircle, Send } from "lucide-react";
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
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-info/20 bg-info/5 p-3">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar name={student?.full_name} src={student?.photo_url} size="lg" className="shrink-0" />
              <div className="min-w-0">
                <p className="text-body font-semibold break-words text-text-primary">{student?.full_name ?? "—"}</p>
                {student?.student_code ? <p className="text-small text-text-secondary">Student ID: {student.student_code}</p> : null}
                <p className="text-small flex items-center gap-1.5 text-text-secondary">
                  <CreditCard className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="break-words">{[membership?.code, membership?.planLabel, membership?.period].filter(Boolean).join(" · ")}</span>
                </p>
              </div>
            </div>
            {student?.id ? (
              <Button variant="outline" size="sm" className="text-info" render={<a href={`/students/${student.id}`} target="_blank" rel="noopener noreferrer" />} nativeButton={false}>
                <ExternalLink className="size-4" aria-hidden="true" />
                View Details
                <span className="sr-only"> (opens in a new tab)</span>
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

            <div className="grid gap-2 sm:grid-cols-2">
              <Button type="button" variant="secondary" onClick={copyMessage} disabled={!hasMessage} aria-describedby={hasMessage ? undefined : emptyNoteId}>
                <Copy className="size-4" aria-hidden="true" />
                Copy Message
              </Button>
              {whatsAppUrl ? (
                <Button variant="outline" className="border-success/30 bg-success/10 text-success hover:bg-success/15 hover:text-success" render={<a href={whatsAppUrl} target="_blank" rel="noopener noreferrer" />} nativeButton={false}>
                  <MessageCircle className="size-4" aria-hidden="true" />
                  Open WhatsApp
                  <span className="sr-only"> (opens in a new tab)</span>
                </Button>
              ) : (
                <Button type="button" variant="outline" disabled aria-describedby={noWhatsApp ? whatsAppNoteId : emptyNoteId}>
                  <MessageCircle className="size-4" aria-hidden="true" />
                  Open WhatsApp
                </Button>
              )}
              {mailtoUrl ? (
                <Button variant="outline" render={<a href={mailtoUrl} />} nativeButton={false}>
                  <Mail className="size-4" aria-hidden="true" />
                  Open Email
                </Button>
              ) : (
                <Button type="button" variant="outline" disabled aria-describedby={noEmail ? emailNoteId : emptyNoteId}>
                  <Mail className="size-4" aria-hidden="true" />
                  Open Email
                </Button>
              )}
              {student?.id ? (
                <Button
                  variant="outline"
                  render={<a href={communicationHistoryHref(student.id)} target="_blank" rel="noopener noreferrer" />}
                  nativeButton={false}
                >
                  <History className="size-4" aria-hidden="true" />
                  View Communication History
                  <span className="sr-only"> (opens in a new tab)</span>
                </Button>
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
