import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * The one labelled-field wrapper (06-ui-implementation-rules.md §7),
 * replacing ~60 hand-wired `label` / control / `aria-describedby` / error
 * blocks. Owns the id/label pairing, `aria-invalid`, `aria-describedby`
 * (pointing at the error and/or help text) and the
 * `role="alert"` error paragraph — the exact wiring every existing form
 * field already repeats by hand.
 *
 * `children` is a render function so `FormField` can wrap any control
 * (`Input`, `Select`, `Textarea`, a custom control) without cloning
 * arbitrary elements: `{(field) => <Input {...field} />}`. `field` carries
 * `id`, `aria-invalid` and `aria-describedby` only — `name`, `value`,
 * `onChange` etc. stay the caller's own props on the control.
 */
export default function FormField({ id, label, error, help, required, className, children }) {
  const errorId = error ? `${id}-error` : undefined;
  const helpId = help ? `${id}-help` : undefined;
  const describedBy = [errorId, helpId].filter(Boolean).join(" ") || undefined;

  const field = {
    id,
    "aria-invalid": Boolean(error),
    "aria-describedby": describedBy,
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {label ? (
        <Label htmlFor={id}>
          {label}
          {required ? (
            <span className="text-danger" aria-hidden="true">
              {" "}
              *
            </span>
          ) : null}
        </Label>
      ) : null}

      {typeof children === "function" ? children(field) : children}

      {help && !error ? (
        <p id={helpId} className="text-small text-text-secondary">
          {help}
        </p>
      ) : null}

      {error ? (
        <p id={errorId} role="alert" className="text-small text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The locked form-actions row (06-…-rules.md §7): Cancel (outline, links
 * back) + submit (primary, pending label). Exact class string every
 * existing form already uses — kept verbatim, not restyled, so adopting
 * this component changes no pixels.
 */
export function FormActions({ children, className }) {
  return (
    <div className={cn("mt-2 flex justify-end gap-3 border-t border-border pt-5", className)}>
      {children}
    </div>
  );
}
