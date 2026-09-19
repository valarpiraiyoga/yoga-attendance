import { clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge only knows Tailwind's built-in type scale (`text-sm`,
 * `text-lg`, …). Our custom tokens (`text-page-title`, `text-section-title`,
 * `text-body`, `text-small`, `text-button` — `03-visual-tokens.md` §2,
 * declared in `app/globals.css`) were therefore classified as text *colours*,
 * so `cn("text-small text-success")` silently dropped `text-small` and the
 * element fell back to the inherited 16px/24px. Registering them as font
 * sizes makes a size and a colour coexist, while two sizes still resolve
 * last-wins, exactly like the built-in scale.
 *
 * Keep this list in step with the `--text-*` tokens in `globals.css`.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["page-title", "section-title", "body", "small", "button"],
    },
  },
});

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
