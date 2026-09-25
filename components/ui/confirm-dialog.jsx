"use client"

import { AlertTriangle, CheckCircle2, Info, Trash2 } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const TONE_ICON = {
  danger: Trash2,
  warning: AlertTriangle,
  info: Info,
  success: CheckCircle2,
}

const TONE_CIRCLE = {
  danger: "bg-danger/10 text-danger",
  warning: "bg-warning/10 text-warning",
  info: "bg-info/10 text-info",
  success: "bg-success/10 text-success",
}

const NOTE_TONE_CLASSES = {
  danger: "border-danger/20 bg-danger/5 text-danger",
  warning: "border-warning/20 bg-warning/5 text-warning",
  info: "border-info/20 bg-info/5 text-info",
  success: "border-success/20 bg-success/5 text-success",
}

/**
 * Reusable Review → Confirm → Save gate (02-ux.md Flows 10 and 11), and the
 * canonical destructive/discard/acknowledgement dialog
 * (06-ui-implementation-rules.md §12 — `Warning.png`, `Error.png`,
 * `discard.png`, `00 Design System.png` §18): a tone-colored icon circle,
 * centered title and description, an optional inline tone-matched note, and
 * an explicit Confirm/Cancel step before the underlying action runs.
 * Controlled by the caller (`open`/`onOpenChange`) so it can wrap either a
 * direct server-action call (Deactivate Student) or a form's own submit
 * (Save Enrollment).
 *
 * `tone` picks the icon and its circle color. `destructive` remains for
 * backward compatibility: when `tone` is not given, `destructive` implies
 * `"danger"`, otherwise the dialog defaults to `"info"` — every existing
 * caller keeps its current confirm-button color (`destructive` ⇒ the
 * `destructive` Button variant) and gains only the icon/centering treatment.
 *
 * `pendingLabel` is the confirm button's text while `isPending` ("Saving…" by
 * default; a delete says "Deleting…").
 *
 * `context` is the "which record is this about?" card (a `ContextCard` - a student, a
 * schedule, a session): it sits right under the title and description, before the note and
 * the review content, so the person knows what the question below acts on.
 *
 * `children` is the "Review" content — a short inline note fits the
 * `note` prop; a larger review summary (a definition list of what is about
 * to change) renders as `children` below the centered header, in its own
 * natural (left-aligned) layout — the anatomy in §12 governs the icon/
 * title/description/footer chrome, not caller-supplied review content.
 */
export default function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  note,
  context,
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  pendingLabel = "Saving…",
  onConfirm,
  isPending = false,
  destructive = false,
  tone,
  hideCancel = false,
}) {
  const resolvedTone = tone ?? (destructive ? "danger" : "info")
  const Icon = TONE_ICON[resolvedTone] ?? Info
  const isDangerButton = destructive || resolvedTone === "danger"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader className="items-center gap-3 pr-0 text-center">
          <span
            aria-hidden="true"
            className={cn(
              "flex size-14 shrink-0 items-center justify-center rounded-full",
              TONE_CIRCLE[resolvedTone] ?? TONE_CIRCLE.info
            )}
          >
            <Icon className="size-6" aria-hidden="true" />
          </span>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>

        {context}

        {note ? (
          <p
            className={cn(
              "rounded-card border px-3 py-2.5 text-small",
              NOTE_TONE_CLASSES[resolvedTone] ?? NOTE_TONE_CLASSES.info
            )}
          >
            {note}
          </p>
        ) : null}

        {children}

        <DialogFooter className="sm:justify-center">
          {hideCancel ? null : (
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              className="flex-1"
              onClick={() => onOpenChange(false)}
            >
              {cancelLabel}
            </Button>
          )}
          <Button
            type="button"
            variant={isDangerButton ? "destructive" : "default"}
            disabled={isPending}
            className={cn(hideCancel ? "w-full" : "flex-1")}
            onClick={onConfirm}
          >
            {isPending ? pendingLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
