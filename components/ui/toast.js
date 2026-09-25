"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { CircleAlert, CircleCheck, X } from "lucide-react";
import { cn } from "@/lib/utils";

const TONES = {
  success: { icon: CircleCheck, iconClass: "text-success", border: "border-success/30", tint: "bg-success/10", role: "status" },
  error: { icon: CircleAlert, iconClass: "text-danger", border: "border-danger/30", tint: "bg-danger/10", role: "alert" },
};

/**
 * A transient message pinned to the top-right of the window, on a tinted
 * background in its tone's colour (green for success, red for an error), outside
 * the layout: it never pushes or wraps the content that triggered it. Below `lg`
 * it sits under the 48px mobile top bar rather than over it. Rendered
 * into `document.body`, so no clipping or stacking context of the trigger
 * (sticky / overflow-hidden cards) can hide it.
 *
 * Controlled: the owner keeps the message in state, renders `<Toast>` while it
 * is set, and clears it in `onDismiss`. It dismisses itself after `duration`
 * ms (4s success, 6s error by default) and has a close button. `role` is
 * `status` for success and `alert` for errors so assistive tech announces it.
 * `onDismiss` must be stable (e.g. `useCallback`), or the timer restarts on
 * every render.
 *
 * @param {object} props
 * @param {string|null|undefined} props.message - nothing renders while empty.
 * @param {"success"|"error"} [props.tone]
 * @param {() => void} props.onDismiss
 * @param {number} [props.duration]
 */
export default function Toast({ message, tone = "success", onDismiss, duration }) {
  useEffect(() => {
    if (!message) return undefined;
    const timer = setTimeout(onDismiss, duration ?? (tone === "error" ? 6000 : 4000));
    return () => clearTimeout(timer);
  }, [message, tone, duration, onDismiss]);

  if (!message || typeof document === "undefined") return null;

  const { icon: Icon, iconClass, border, tint, role } = TONES[tone] ?? TONES.success;

  return createPortal(
    <div className="pointer-events-none fixed inset-x-4 top-16 z-50 flex justify-end sm:inset-x-auto sm:right-6 lg:top-6 print:hidden">
      {/* The tint sits on a solid surface, so the page behind never shows through the colour. */}
      <div
        role={role}
        className={cn(
          "pointer-events-auto w-full max-w-sm rounded-lg border bg-surface shadow-sm animate-in fade-in slide-in-from-top-2",
          border
        )}
      >
       <div className={cn("flex items-start gap-3 rounded-[inherit] p-3", tint)}>
        <Icon className={cn("mt-0.5 size-4 shrink-0", iconClass)} aria-hidden="true" />
        <p className="text-body min-w-0 flex-1 break-words text-text-primary">{message}</p>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss message"
          className="-m-1 shrink-0 rounded-md p-1 text-text-secondary transition-colors outline-none hover:bg-background hover:text-text-primary focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
       </div>
      </div>
    </div>,
    document.body
  );
}
