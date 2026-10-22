"use client";

import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * A single horizontal row that scrolls inside its own box (the page never scrolls sideways), with previous / next buttons and the
 * selected card scrolled into view on load. The cards are the children; the one to reveal carries `data-selected="true"`.
 */
export default function StripScroller({ children, label }) {
  const rowRef = useRef(null);

  useEffect(() => {
    const row = rowRef.current;
    const selected = row?.querySelector("[data-selected='true']");
    if (!row || !selected) return;
    // Scroll the row itself (scrollIntoView would also move the page).
    row.scrollLeft = selected.offsetLeft - (row.clientWidth - selected.offsetWidth) / 2;
  }, []);

  function scrollBy(direction) {
    const row = rowRef.current;
    if (row) row.scrollBy({ left: direction * row.clientWidth * 0.8, behavior: "smooth" });
  }

  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="outline" size="icon-sm" className="shrink-0" aria-label="Scroll attendance earlier" onClick={() => scrollBy(-1)}>
        <ChevronLeft className="size-4" aria-hidden="true" />
      </Button>
      <div ref={rowRef} role="list" aria-label={label} className="relative flex min-w-0 flex-1 gap-2 overflow-x-auto scroll-smooth py-1 scrollbar-slim">
        {children}
      </div>
      <Button type="button" variant="outline" size="icon-sm" className="shrink-0" aria-label="Scroll attendance later" onClick={() => scrollBy(1)}>
        <ChevronRight className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
