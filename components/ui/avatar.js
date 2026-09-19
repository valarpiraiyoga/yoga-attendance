import { getInitials } from "@/lib/format";
import { cn } from "@/lib/utils";

const SIZE_CLASSES = {
  sm: "size-8",
  md: "size-10",
  lg: "size-14",
};

const TONE_CLASSES = {
  brand: "bg-brand/15 text-brand",
  neutral: "bg-neutral/15 text-text-secondary",
};

/**
 * The one initials/photo avatar (06-ui-implementation-rules.md §21),
 * replacing 17 duplicated `getInitials` + inline-markup copies. Renders a
 * photo when `src` is given, otherwise a tinted initials circle from
 * `lib/format.js`'s `getInitials`.
 *
 * `bordered` adds the subtle ring `student-card-item.js` uses on its list
 * avatar (`border-surface/80` + `shadow-xs`) for a card sitting on a tinted
 * surface; plain (unbordered) is the default used everywhere else.
 */
export default function Avatar({ name, src, size = "md", tone = "brand", shape = "circle", bordered = false, className }) {
  const dimension = SIZE_CLASSES[size] ?? SIZE_CLASSES.md;
  const shapeClass = shape === "square" ? "rounded-lg" : "rounded-full";

  if (src) {
    // Same `<img>` tradeoff as the existing photo renders this consolidates
    // (app/students/[id]/page.js, dashboard class cards) — not addressed in
    // this task; see docs/05-ui-implementation-audit.md's lint baseline.
    return (
      <img
        src={src}
        alt=""
        className={cn(dimension, shapeClass, "shrink-0 object-cover", className)}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center text-small font-semibold",
        dimension,
        shapeClass,
        TONE_CLASSES[tone] ?? TONE_CLASSES.brand,
        bordered && "border border-surface/80 shadow-xs",
        className
      )}
    >
      {getInitials(name)}
    </span>
  );
}
