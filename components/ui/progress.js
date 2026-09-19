import { cn } from "@/lib/utils";

/**
 * A thin horizontal progress bar (`05 Memberships card view` validity bar;
 * `07` Days Progress). Tone is a semantic token; the fill width is the only
 * inline style (a dynamic percentage can't be a static Tailwind class).
 *
 * It carries real meaning, so it is a `progressbar` with a value and a
 * label — unlike `StatTile`'s decorative chart. Pass `label` (e.g.
 * "Membership validity used") so assistive tech knows what it measures.
 */
const FILL_TONE = {
  brand: "bg-brand",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
};

export default function Progress({ value, tone = "success", label, className }) {
  const percent = Math.min(100, Math.max(0, Math.round(Number(value) || 0)));

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-neutral/15", className)}
    >
      <div
        className={cn("h-full rounded-full", FILL_TONE[tone] ?? FILL_TONE.success)}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
