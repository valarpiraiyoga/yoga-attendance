"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * The one password field: an `Input` with a show / hide control on the right, and optionally a leading icon
 * (the sign-in page's lock). Everything else - `id`, `name`, `autoComplete`, `value`, `onChange`, `aria-*` - is
 * the caller's, so it works uncontrolled in a form or controlled, and inside `FormField`.
 *
 * The control is a real button with an accessible name and `aria-pressed`, keyboard reachable, and never submits
 * the form. It only changes how the field's own text is displayed.
 *
 * @param {object} props
 * @param {import("react").ComponentType<{ className?: string }>} [props.icon] - a leading icon (lucide).
 */
export default function PasswordInput({ icon: Icon, className, disabled, ...props }) {
  const [shown, setShown] = useState(false);

  return (
    <div className="relative">
      {Icon ? (
        <Icon
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-secondary"
          aria-hidden="true"
        />
      ) : null}
      <Input
        type={shown ? "text" : "password"}
        disabled={disabled}
        className={cn(Icon && "pl-10", "pr-10", className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setShown((value) => !value)}
        aria-label={shown ? "Hide password" : "Show password"}
        aria-pressed={shown}
        disabled={disabled}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-input text-text-secondary outline-none hover:text-text-primary focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
      >
        {shown ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
      </button>
    </div>
  );
}
