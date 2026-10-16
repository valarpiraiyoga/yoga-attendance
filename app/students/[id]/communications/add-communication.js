"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import FormField from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import StudentContext from "@/components/ui/student-context";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  COMMUNICATION_TYPES,
  FOLLOW_UP_NOTE_MAX,
  NOTES_MAX,
  SUBJECT_MAX,
  defaultCommunicatedAt,
  validateCommunicationInput,
} from "@/lib/communications/core";
import { recordStudentCommunication, updateStudentCommunication } from "@/lib/communications/actions";

const emptyDraft = (timeZone) => ({
  communicatedAt: defaultCommunicatedAt(new Date(), timeZone),
  type: "",
  subject: "",
  notes: "",
  followUp: false,
  followUpDate: "",
  followUpNote: "",
  followUpLocked: false,
});

const MODES = {
  add: {
    title: "Add communication",
    description: "Record a conversation with this student. Optionally add a follow-up to do by a date.",
    confirmLabel: "Save Communication",
  },
  edit: {
    title: "Edit Communication",
    description: "Correct this communication. Who recorded it, and when, stay as they are; your edit is recorded.",
    confirmLabel: "Save Changes",
  },
};

/**
 * Add Communication - records one communication with the student, in the project's form-dialog pattern (Edit Payment, Record
 * Payment): the student's context card, the fields, and Save. Date & Time defaults to now on the centre's clock and can be moved
 * back to record an earlier conversation. "Add Follow-up" reveals the follow-up date and note; switched off, they are neither
 * shown nor sent.
 *
 * Validated here for immediate field errors, then by the server action and the database, which writes the staff attribution. On
 * success the dialog closes and the page refreshes with the new record at the top of the history.
 */
export default function AddCommunication({ studentId, student, timeZone, variant = "default", size = "sm", label = "Add Communication" }) {
  return (
    <CommunicationDialog
      mode="add"
      studentId={studentId}
      student={student}
      timeZone={timeZone}
      initialDraft={() => emptyDraft(timeZone)}
      triggerVariant={variant}
      triggerSize={size}
      triggerLabel={label}
    />
  );
}

/**
 * Edit Communication (migration 0058) - the same form, opened with the record's current values. A pending follow-up can be
 * changed or removed, and one can be added. A COMPLETED follow-up is shown but locked: it records what was done, so its date and
 * note cannot be changed and it cannot be removed (the database refuses the same). The recorder and the recorded time are never
 * changed; the database records who edited and when.
 */
export function EditCommunication({ studentId, student, timeZone, communicationId, draft, subject }) {
  return (
    <CommunicationDialog
      mode="edit"
      studentId={studentId}
      student={student}
      timeZone={timeZone}
      communicationId={communicationId}
      initialDraft={() => ({ ...draft })}
      triggerLabel={`Edit communication: ${subject}`}
    />
  );
}

function CommunicationDialog({ mode, studentId, student, timeZone, communicationId, initialDraft, triggerVariant, triggerSize, triggerLabel }) {
  const router = useRouter();
  const copy = MODES[mode];
  const idPrefix = mode === "edit" ? `communication-edit-${communicationId}` : "communication";
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(initialDraft);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [isPending, startTransition] = useTransition();
  // A second click before the first request has finished must never save the communication twice.
  const inFlight = useRef(false);
  const locked = Boolean(draft.followUpLocked);

  function handleOpenChange(next) {
    if (!next && inFlight.current) return;
    // Every time it opens it shows the values saved NOW (the page may have refreshed since).
    if (next) setDraft(initialDraft());
    setOpen(next);
    if (!next) {
      setFieldErrors({});
      setFormError(null);
    }
  }

  function update(key, value) {
    setDraft((current) => ({ ...current, [key]: value }));
    if (fieldErrors[key]) setFieldErrors((current) => ({ ...current, [key]: undefined }));
  }

  function save() {
    if (inFlight.current) return;

    const checked = validateCommunicationInput(draft, defaultCommunicatedAt(new Date(), timeZone));
    if (!checked.success) {
      setFieldErrors(checked.fieldErrors);
      setFormError(null);
      return;
    }

    inFlight.current = true;
    setFieldErrors({});
    setFormError(null);

    startTransition(async () => {
      try {
        const result =
          mode === "edit"
            ? await updateStudentCommunication(studentId, communicationId, draft)
            : await recordStudentCommunication(studentId, draft);
        if (result?.error) {
          setFieldErrors(result.fieldErrors ?? {});
          setFormError(result.fieldErrors ? null : result.error);
          return;
        }
        inFlight.current = false;
        handleOpenChange(false);
        router.refresh();
      } catch {
        setFormError("Could not reach the server. Try again.");
      } finally {
        inFlight.current = false;
      }
    });
  }

  return (
    <>
      {mode === "edit" ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-text-secondary hover:bg-brand/10 hover:text-brand"
          aria-label={triggerLabel}
          title="Edit Communication"
          onClick={() => handleOpenChange(true)}
        >
          <Pencil className="size-4" aria-hidden="true" />
        </Button>
      ) : (
        <Button type="button" variant={triggerVariant} size={triggerSize} onClick={() => handleOpenChange(true)}>
          <Plus className="size-4" aria-hidden="true" />
          {triggerLabel}
        </Button>
      )}

      <ConfirmDialog
        open={open}
        onOpenChange={handleOpenChange}
        title={copy.title}
        context={<StudentContext student={student} />}
        description={copy.description}
        confirmLabel={copy.confirmLabel}
        pendingLabel="Saving…"
        isPending={isPending}
        onConfirm={save}
      >
        <div className="flex flex-col gap-4">
          {formError ? (
            <p role="alert" className="text-body rounded-input border border-danger/30 bg-danger/5 px-3 py-2 text-danger">
              {formError}
            </p>
          ) : null}

          <FormField id={`${idPrefix}-at`} label="Date & Time" required error={fieldErrors.communicatedAt}>
            {(field) => (
              <Input
                {...field}
                type="datetime-local"
                required
                disabled={isPending}
                value={draft.communicatedAt}
                max={defaultCommunicatedAt(new Date(), timeZone)}
                onChange={(event) => update("communicatedAt", event.target.value)}
              />
            )}
          </FormField>

          <FormField id={`${idPrefix}-type`} label="Communication Type" required error={fieldErrors.type}>
            {(field) => (
              <Select
                items={COMMUNICATION_TYPES}
                value={draft.type || null}
                onValueChange={(value) => update("type", value ?? "")}
                disabled={isPending}
              >
                <SelectTrigger {...field} className="w-full">
                  <SelectValue placeholder="Select a type…" />
                </SelectTrigger>
                <SelectContent>
                  {COMMUNICATION_TYPES.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>

          <FormField id={`${idPrefix}-subject`} label="Subject" required error={fieldErrors.subject} help="For example, Membership renewal.">
            {(field) => (
              <Input
                {...field}
                required
                maxLength={SUBJECT_MAX}
                disabled={isPending}
                value={draft.subject}
                onChange={(event) => update("subject", event.target.value)}
              />
            )}
          </FormField>

          <FormField id={`${idPrefix}-notes`} label="Communication Notes" required error={fieldErrors.notes} help="What was discussed and the outcome.">
            {(field) => (
              <Textarea
                {...field}
                required
                rows={4}
                maxLength={NOTES_MAX}
                disabled={isPending}
                value={draft.notes}
                onChange={(event) => update("notes", event.target.value)}
              />
            )}
          </FormField>

          <div className="flex items-center gap-3 border-t border-border pt-4">
            <Switch
              id={`${idPrefix}-follow-up`}
              checked={draft.followUp}
              onCheckedChange={(checked) => update("followUp", Boolean(checked))}
              disabled={isPending || locked}
            />
            <Label htmlFor={`${idPrefix}-follow-up`}>Add Follow-up</Label>
          </div>

          {locked ? (
            <p className="text-small rounded-input border border-border bg-background px-3 py-2 text-text-secondary">
              This follow-up is completed. Its date and note record what was done, so they cannot be changed or removed.
            </p>
          ) : null}

          {draft.followUp ? (
            <div className="flex flex-col gap-4">
              <FormField id={`${idPrefix}-follow-up-date`} label="Follow-up Date" required error={fieldErrors.followUpDate}>
                {(field) => (
                  <Input
                    {...field}
                    type="date"
                    required
                    disabled={isPending || locked}
                    value={draft.followUpDate}
                    min={!locked && draft.communicatedAt ? draft.communicatedAt.slice(0, 10) : undefined}
                    onChange={(event) => update("followUpDate", event.target.value)}
                  />
                )}
              </FormField>

              <FormField
                id={`${idPrefix}-follow-up-note`}
                label="Follow-up Note"
                required
                error={fieldErrors.followUpNote}
                help={locked ? undefined : "The action to take."}
              >
                {(field) => (
                  <Textarea
                    {...field}
                    required
                    rows={2}
                    maxLength={FOLLOW_UP_NOTE_MAX}
                    disabled={isPending || locked}
                    value={draft.followUpNote}
                    onChange={(event) => update("followUpNote", event.target.value)}
                  />
                )}
              </FormField>
            </div>
          ) : null}
        </div>
      </ConfirmDialog>
    </>
  );
}
