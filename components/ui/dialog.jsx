"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

/**
 * Centered modal dialog. Same Base UI primitive as components/ui/sheet.jsx
 * (@base-ui/react/dialog exposes both shapes) — Sheet is edge-anchored,
 * Dialog is viewport-centered, matching the shadcn Dialog/Sheet split.
 *
 * Viewport safety (06-ui-implementation-rules.md §12): every dialog keeps a
 * 16px gutter on each side (`w-[calc(100%-2rem)]`) and is never taller than
 * the dynamic viewport less that gutter (`max-h-[calc(100dvh-2rem)]`), so a
 * tall dialog can no longer grow past the top and bottom of the screen. On its
 * own the popup scrolls as a whole; a dialog with a fixed header and footer
 * (ConfirmDialog, ReviewDialog) passes `overflow-hidden` and scrolls only its
 * `DialogBody`.
 */

function Dialog({ ...props }) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogClose({ ...props }) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogPortal({ ...props }) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogOverlay({ className, ...props }) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/30 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({ className, children, showCloseButton = true, ...props }) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto overscroll-contain rounded-card border border-border bg-surface p-6 shadow-lg transition duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton ? (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={<Button variant="ghost" size="icon-sm" className="absolute top-3 right-3" />}
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }) {
  return (
    <div data-slot="dialog-header" className={cn("flex flex-col gap-1.5 pr-6", className)} {...props} />
  )
}

/**
 * The scrolling middle of a dialog whose header and footer stay in view. It takes the
 * height left between them (`min-h-0 flex-1`) and scrolls inside itself. It reaches the
 * popup's side edges (`-mx-6 px-6`, matching DialogContent's `p-6`) so the scrollbar sits at
 * the edge, and keeps 4px above and below (`-my-1 py-1`) so a field's 3px focus ring is
 * never cut off. A dialog with other padding passes the matching margin and padding.
 */
function DialogBody({ className, ...props }) {
  return (
    <div
      data-slot="dialog-body"
      className={cn("-mx-6 -my-1 min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-1", className)}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn("flex flex-col-reverse gap-3 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  )
}

function DialogTitle({ className, ...props }) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-section-title font-semibold text-text-primary", className)}
      {...props}
    />
  )
}

function DialogDescription({ className, ...props }) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-body text-text-secondary", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
