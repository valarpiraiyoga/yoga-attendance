import { cn } from "@/lib/utils";

/**
 * Vertical page section.
 *
 * Establishes the consistent 32px rhythm between sections using the approved
 * spacing scale. The final section drops its trailing space so it does not
 * fight the main column's bottom padding.
 */
export default function Section({ className, children, ...props }) {
  return (
    <section className={cn("mb-8 last:mb-0", className)} {...props}>
      {children}
    </section>
  );
}
