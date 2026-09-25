"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { ArrowRight, Eye, EyeOff, Lock, Mail } from "lucide-react";
import { signIn } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The sign-in form: email and password (each with its leading icon), a show / hide control on the
 * password, "Forgot password?" under it, and Sign In. Signing in is exactly what it was - the same
 * `signIn` action and the same fields; only the presentation changed.
 */
export default function LoginForm({ initialError }) {
  const [state, formAction, isPending] = useActionState(
    signIn,
    initialError ? { error: initialError } : {}
  );
  const [showPassword, setShowPassword] = useState(false);

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {state?.error ? (
        <p
          role="alert"
          className="text-body rounded-input border border-danger/30 bg-danger/5 px-3 py-2 text-danger"
        >
          {state.error}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email address</Label>
        <div className="relative">
          <Mail
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-secondary"
            aria-hidden="true"
          />
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            disabled={isPending}
            placeholder="Enter your email address"
            className="h-11 bg-surface pl-10"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <div className="relative">
          <Lock
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-secondary"
            aria-hidden="true"
          />
          <Input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            disabled={isPending}
            placeholder="Enter your password"
            className="h-11 bg-surface px-10"
          />
          <button
            type="button"
            onClick={() => setShowPassword((shown) => !shown)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            disabled={isPending}
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-input text-text-secondary outline-none hover:text-text-primary focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
          >
            {showPassword ? (
              <EyeOff className="size-4" aria-hidden="true" />
            ) : (
              <Eye className="size-4" aria-hidden="true" />
            )}
          </button>
        </div>
        <Link href="/forgot-password" className="text-small self-end font-medium text-brand hover:underline">
          Forgot password?
        </Link>
      </div>

      <Button type="submit" disabled={isPending} className="h-11 w-full">
        {isPending ? (
          "Signing in…"
        ) : (
          <>
            Sign In
            <ArrowRight className="size-4" aria-hidden="true" />
          </>
        )}
      </Button>
    </form>
  );
}
