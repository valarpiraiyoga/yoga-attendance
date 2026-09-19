import { cn } from "@/lib/utils";

/**
 * The one icon-label-value field display (06-ui-implementation-rules.md
 * §19), replacing 6 identical local definitions across the detail pages
 * (Student, Membership, Batch, Schedule, Attendance session).
 */
export default function FieldRow({ icon: Icon, label, children, className }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-center gap-1.5">
        {Icon ? <Icon className="size-3.5 shrink-0 text-text-secondary" aria-hidden="true" /> : null}
        <p className="text-small text-text-secondary">{label}</p>
      </div>
      <div className="mt-1">{children}</div>
    </div>
  );
}
