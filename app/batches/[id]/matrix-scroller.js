"use client";

import { useEffect, useRef } from "react";

/**
 * The Attendance Summary's horizontal scroll box: the table scrolls sideways inside it (the page never does), and on load today's column
 * (the header cell marked `data-selected="true"`) is scrolled into view, clear of the sticky Time and Instructor columns.
 */
export default function MatrixScroller({ children, label }) {
  const boxRef = useRef(null);

  useEffect(() => {
    const box = boxRef.current;
    const selected = box?.querySelector("[data-selected='true']");
    if (!box || !selected) return;
    // Scroll the box itself (scrollIntoView would also move the page), clear of the two sticky columns.
    const heads = box.querySelectorAll("thead th");
    const sticky = (heads[0]?.offsetWidth ?? 0) + (heads[1]?.offsetWidth ?? 0);
    box.scrollLeft = Math.max(0, selected.offsetLeft - sticky - (box.clientWidth - sticky - selected.offsetWidth) / 2);
  }, []);

  return (
    <div ref={boxRef} role="region" aria-label={label} tabIndex={0} className="overflow-x-auto rounded-card border border-border scrollbar-slim focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
      {children}
    </div>
  );
}
