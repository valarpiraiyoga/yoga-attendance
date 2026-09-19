import { cn } from "@/lib/utils";

/**
 * RETIRED (06-ui-implementation-rules.md §8/§9/§22.5): this no longer
 * applies the gradient wash + `backdrop-blur` frosted-surface treatment.
 * `03-visual-tokens.md` §6 lists decorative gradients under "Avoid", and
 * every approved table/card-grid reference (`03`, `06`, `09`, `13`,
 * `18 Settings instructor`, `02`, `05`, `08`, `12`) shows a plain surface.
 *
 * This file now renders the canonical plain bordered surface (`Panel`'s own
 * treatment) so all 16 existing call sites get that fix applied for free,
 * with no page-level edits — deliberately, per this task's "do not
 * redesign individual pages yet simply to compensate for this change".
 * `tone` is accepted and ignored; it no longer has a visual effect.
 *
 * This is a compatibility shim, not the canonical import going forward.
 * The contract's end state (§8 rule 1) has card grids sitting directly on
 * the page background with no wrapper at all, and tables importing
 * `Panel` (`components/layout/Panel.js`) directly — each of this file's 16
 * callers adopts one or the other when that page is next implemented, and
 * this file is deleted once none remain.
 */
export default function DataTableShell({ children, tone, className }) {
  return (
    <div className={cn("overflow-hidden rounded-card border border-border bg-surface shadow-xs", className)}>
      {children}
    </div>
  );
}
