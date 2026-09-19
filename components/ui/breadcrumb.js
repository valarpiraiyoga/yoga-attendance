import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The canonical detail-page header lead-in (06-ui-implementation-rules.md
 * §19): breadcrumb + top-right action cluster, replacing the five
 * `← Back to X` links. `items`: `{ label, href? }[]` — the last item (or
 * any item without an `href`) renders as the current, non-linked crumb.
 */
export default function Breadcrumb({ items, className }) {
  return (
    <nav aria-label="Breadcrumb" className={cn("mb-4", className)}>
      <ol className="flex flex-wrap items-center gap-1.5 text-small text-text-secondary">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          const isCurrent = isLast || !item.href;

          return (
            <li key={item.label} className="flex items-center gap-1.5">
              {index > 0 ? (
                <ChevronRight className="size-3.5 text-text-secondary/60" aria-hidden="true" />
              ) : null}
              {isCurrent ? (
                <span aria-current={isLast ? "page" : undefined} className={cn(isLast && "font-medium text-text-primary")}>
                  {item.label}
                </span>
              ) : (
                <Link href={item.href} className="transition-colors hover:text-text-primary hover:underline">
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
