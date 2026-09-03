import { cn } from "@/lib/utils";

/**
 * Primary content width constraint for application pages.
 *
 * Caps content at 1200px and centres it within the main column. Horizontal
 * page gutters are applied by the shell's <main> element, so this primitive
 * intentionally owns width and centring only — keeping the gutter in one
 * place avoids double padding.
 */
export default function Container({ className, children }) {
  return (
    <div className={cn("mx-auto w-full max-w-[1200px]", className)}>
      {children}
    </div>
  );
}
