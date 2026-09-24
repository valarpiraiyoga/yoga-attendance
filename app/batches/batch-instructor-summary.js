import { UserRound } from "lucide-react";
import Avatar from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/**
 * The batch's current instructor(s), as an avatar + name (one instructor) or
 * overlapping avatars + a compact count ("2 instructors", never listing every
 * name — 01-product.md's "one batch can have several instructors across its
 * schedules"). Shared by the Batches list card and table row rather than
 * duplicated in both.
 *
 * Derived here, not in `summarizeCurrentSchedules`
 * (lib/batches/summary.js, unmodified by this component): that function
 * already reduces the same `currentSchedules` to a plain "Kannan Thangavel" /
 * "2 instructors" *string* for its own text-only callers; this re-derives
 * the underlying unique instructor objects from the same already-loaded
 * `schedules` to additionally render their avatars, without touching the
 * shared summary logic or its query. `photo_url` is not currently selected
 * for a schedule's instructor (lib/batches/data.js), so `Avatar` renders its
 * existing initials fallback — no broken image, nothing to change there.
 *
 * `size` controls the avatar's dimension directly (`components/ui/avatar.js`'s
 * own presets — "sm" 32px for the compact table row, "md" 40px for the
 * card's richer treatment), rather than a `className` override on top of
 * `Avatar`'s default — a className-based size override on this same `Avatar`
 * component proved unreliable elsewhere in this app (the Weekly Schedule
 * calendar card), so the built-in `size` prop is used instead, a guaranteed
 * mechanism rather than a class-merge bet.
 *
 * `showLabel` adds a quiet "Instructor" line under the name — only for the
 * single-instructor case (the card's own approved layout); the multi-
 * instructor case already reads as "2 instructors", so no extra label is added.
 *
 * @param {{ schedules: { instructors?: { id: string, full_name: string, photo_url?: string } | null }[], size?: "sm"|"md", showLabel?: boolean, className?: string }} props
 */
export default function BatchInstructorSummary({ schedules, size = "sm", showLabel = false, className }) {
  const byId = new Map();
  for (const schedule of schedules ?? []) {
    if (schedule.instructors?.id) byId.set(schedule.instructors.id, schedule.instructors);
  }
  const instructors = [...byId.values()];

  if (instructors.length === 0) {
    return (
      <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
        <UserRound className="size-3.5 shrink-0 text-text-secondary" aria-hidden="true" />
        <span className="min-w-0 truncate">—</span>
      </span>
    );
  }

  if (instructors.length === 1) {
    return (
      <span className={cn("inline-flex min-w-0 items-center", showLabel ? "gap-2.5" : "gap-1.5", className)}>
        <Avatar name={instructors[0].full_name} src={instructors[0].photo_url} size={size} className="shrink-0" />
        {showLabel ? (
          <span className="min-w-0">
            <p className="truncate text-small font-semibold text-text-primary">{instructors[0].full_name}</p>
            <p className="text-small text-text-secondary">Instructor</p>
          </span>
        ) : (
          <span className="min-w-0 truncate">{instructors[0].full_name}</span>
        )}
      </span>
    );
  }

  return (
    <span
      className={cn("inline-flex min-w-0 items-center", showLabel ? "gap-2.5" : "gap-1.5", className)}
      title={instructors.map((instructor) => instructor.full_name).join(", ")}
    >
      <span className="flex shrink-0 -space-x-1.5">
        {instructors.slice(0, 3).map((instructor) => (
          <Avatar
            key={instructor.id}
            name={instructor.full_name}
            src={instructor.photo_url}
            size={size}
            className="shrink-0 ring-2 ring-surface"
          />
        ))}
      </span>
      <span className={cn("min-w-0 truncate", showLabel && "text-small font-semibold text-text-primary")}>
        {instructors.length} instructors
      </span>
    </span>
  );
}
