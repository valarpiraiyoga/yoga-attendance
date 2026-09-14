import { cn } from "@/lib/utils";

const TONE_GRADIENTS = {
  brand: "from-brand/10 via-surface to-info/10",
  info: "from-info/10 via-surface to-brand/10",
  warning: "from-warning/10 via-surface to-brand/10",
};

/**
 * Shared soft-panel frame for data tables (Memberships / Students reference).
 * Gradient wash + frosted inner surface — wrap any `<Table>` with this.
 */
export default function DataTableShell({ children, tone = "info", className }) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-r p-2 shadow-xs sm:p-3",
        TONE_GRADIENTS[tone] ?? TONE_GRADIENTS.info,
        className
      )}
    >
      <div className="overflow-hidden rounded-xl bg-surface/55 backdrop-blur-sm">{children}</div>
    </div>
  );
}
