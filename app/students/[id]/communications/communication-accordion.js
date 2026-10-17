"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * One communication in the history, as an accordion. The summary (subject, type, date, who recorded it) is always visible;
 * `actions` (the Edit pencil) sit at its right with the expand / collapse chevron directly beside them; the details (the notes and
 * the follow-up with its Mark as Completed action) open and close below. All entries start open, so nothing is hidden until the
 * person collapses it. While collapsed, `collapsedHint` (the follow-up's status) stays in view so a pending follow-up is never
 * out of sight.
 *
 * The details stay in the page when closed (`hidden`), so an open dialog or a screen reader's structure is never destroyed. The
 * button is a real toggle: `aria-expanded`, `aria-controls` the details, and a label that names the communication.
 */
export default function CommunicationAccordion({ subject, title, meta, actions, collapsedHint, children }) {
  const [open, setOpen] = useState(true);
  const detailsId = useId();

  return (
    <div>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {title}
          {meta}
          {!open && collapsedHint ? <div className="mt-2">{collapsedHint}</div> : null}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {actions}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-text-secondary hover:bg-brand/10 hover:text-brand"
            aria-expanded={open}
            aria-controls={detailsId}
            aria-label={`${open ? "Collapse" : "Expand"} communication: ${subject}`}
            title={open ? "Collapse" : "Expand"}
            onClick={() => setOpen((current) => !current)}
          >
            <ChevronDown className={cn("size-4 transition-transform duration-150", open && "rotate-180")} aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div id={detailsId} hidden={!open}>
        {children}
      </div>
    </div>
  );
}
