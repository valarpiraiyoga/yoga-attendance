"use client";

import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

/**
 * The "Review ... " step of Review -> Confirm -> Save (02-ux.md Flows 09, 10, 14):
 * a left-aligned dialog - an info icon, the title and its explanation, a bordered
 * panel holding the details being saved (`children`, usually `ReviewRow`s and
 * sections), and equal-width Cancel and Confirm & Save actions. Add / Edit
 * Enrollment and Add / Renew Membership all use it, so every review reads the same.
 *
 * `context` is the "which record is this about?" card (a `ContextCard`), between the
 * header and the details panel.
 *
 * Controlled by the form (`open` / `onOpenChange`); confirming runs the form's own
 * submit (`onConfirm`), so nothing here saves anything. The panel scrolls inside
 * itself when the content is taller than the screen.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {(open: boolean) => void} props.onOpenChange
 * @param {string} props.title
 * @param {string} props.description
 * @param {boolean} [props.isPending]
 * @param {() => void} props.onConfirm
 * @param {string} [props.confirmLabel]
 * @param {import("react").ReactNode} [props.context]
 * @param {import("react").ReactNode} [props.children]
 */
export default function ReviewDialog({
  open,
  onOpenChange,
  title,
  description,
  isPending = false,
  onConfirm,
  confirmLabel = "Confirm & Save",
  context,
  children,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg gap-5 p-6 sm:p-7">
        <div className="flex flex-col gap-3 pr-8">
          <span
            aria-hidden="true"
            className="flex size-12 shrink-0 items-center justify-center rounded-full bg-info/10 text-info"
          >
            <Info className="size-6" aria-hidden="true" />
          </span>
          <DialogTitle className="text-page-title">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </div>

        {context}

        {children ? (
          <div className="flex max-h-[55vh] flex-col gap-4 overflow-y-auto rounded-lg border border-border bg-background/60 p-4">
            {children}
          </div>
        ) : null}

        <div className="flex gap-3">
          <Button type="button" variant="outline" className="flex-1" disabled={isPending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" className="flex-1" disabled={isPending} onClick={onConfirm}>
            {isPending ? "Saving…" : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** One label / value line of a review panel: icon and label on the left, value on the right. */
export function ReviewRow({ icon: Icon, label, children }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-4 gap-y-1">
      <dt className="flex items-center gap-3 text-body text-text-secondary">
        <Icon className="size-4 shrink-0" aria-hidden="true" />
        {label}
      </dt>
      <dd className="min-w-0 text-body font-medium break-words text-text-primary">{children}</dd>
    </div>
  );
}
