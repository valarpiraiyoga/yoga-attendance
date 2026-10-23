/**
 * The hover border for the Students list (opt-in; the CSS is `.card-border-ring` in app/globals.css): an SVG rounded rect laid over its
 * positioned parent - a `EntityCard animatedBorder` card or a `.card-border-animated-row` table row's first cell - drawing the steady blue
 * border and the slow arc that runs round it on hover, at a constant speed. Purely decorative: hidden from assistive tech, never takes the pointer, adds no layout.
 * `rx` is the parent's corner radius (`rounded-card`, 12px).
 */
export default function AnimatedBorder() {
  return (
    <svg aria-hidden="true" focusable="false" className="card-border-ring">
      <rect className="card-border-ring-base" width="100%" height="100%" rx="12" />
      <rect className="card-border-ring-tail" width="100%" height="100%" rx="12" pathLength="100" />
      <rect className="card-border-ring-head" width="100%" height="100%" rx="12" pathLength="100" />
    </svg>
  );
}
