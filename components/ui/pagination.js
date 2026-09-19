import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** `[1,2,…,total-1,total]` style truncation once there are more than 7 pages. */
function getPageNumbers(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const pages = new Set([1, 2, total - 1, total, current - 1, current, current + 1]);
  return [...pages].filter((page) => page >= 1 && page <= total).sort((a, b) => a - b);
}

/**
 * The one pagination control (06-ui-implementation-rules.md §17), replacing
 * the inline implementation duplicated across six list pages. `getHref(n)`
 * builds each page's URL (the caller owns how other filter params are
 * preserved, same as today's `buildListHref`).
 */
export default function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  itemLabel = "results",
  getHref,
  ariaLabel = "Pagination",
  className,
}) {
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(total, page * pageSize);
  const pageNumbers = getPageNumbers(page, totalPages);

  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between", className)}>
      <p className="text-small text-text-secondary">
        Showing {rangeStart}–{rangeEnd} of {total} {itemLabel}
      </p>

      <nav aria-label={ariaLabel} className="flex items-center gap-1.5">
        {page > 1 ? (
          <Button variant="outline" size="icon-sm" aria-label="Previous page" render={<Link href={getHref(page - 1)} />} nativeButton={false}>
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Button>
        ) : (
          <Button variant="outline" size="icon-sm" aria-label="Previous page" disabled>
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Button>
        )}

        {pageNumbers.map((number, index) => {
          const previous = pageNumbers[index - 1];
          const showEllipsisBefore = previous !== undefined && number - previous > 1;
          const isCurrent = number === page;

          return (
            <span key={number} className="flex items-center gap-1.5">
              {showEllipsisBefore ? <span className="px-1 text-small text-text-secondary">…</span> : null}
              {isCurrent ? (
                // A plain element, not a disabled Button — "current page" is a full-strength
                // state, not a faded/disabled one (Button's `disabled:opacity-50` would dim it).
                <span
                  aria-current="page"
                  className={cn(buttonVariants({ variant: "default", size: "icon-sm" }), "cursor-default")}
                >
                  {number}
                </span>
              ) : (
                <Button variant="outline" size="icon-sm" render={<Link href={getHref(number)} />} nativeButton={false}>
                  {number}
                </Button>
              )}
            </span>
          );
        })}

        {page < totalPages ? (
          <Button variant="outline" size="icon-sm" aria-label="Next page" render={<Link href={getHref(page + 1)} />} nativeButton={false}>
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        ) : (
          <Button variant="outline" size="icon-sm" aria-label="Next page" disabled>
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        )}
      </nav>
    </div>
  );
}
