"use client";

import { CircleHelp } from "lucide-react";
import { Popover } from "@base-ui/react/popover";

/**
 * A small "?" icon that opens its explanation in a popup on click or tap (Enter / Space from the keyboard) instead of permanent
 * helper text. It closes on Escape, on an outside click, or by clicking the icon again. `label` is the button's accessible name;
 * `children` is the explanatory text.
 */
export default function HelpTip({ label, children }) {
  return (
    <Popover.Root>
      <Popover.Trigger
        type="button"
        aria-label={label}
        className="inline-flex size-6 items-center justify-center rounded-full text-text-secondary outline-none hover:text-text-primary focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:text-brand"
      >
        <CircleHelp className="size-4" aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="end" sideOffset={8} collisionPadding={8} className="isolate z-50">
          <Popover.Popup className="text-small w-64 max-w-[calc(100vw-1rem)] origin-(--transform-origin) rounded-lg border border-border bg-surface p-3 text-text-secondary shadow-md outline-none duration-100 data-ending-style:opacity-0 data-starting-style:opacity-0">
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
