"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ArrowRight, Lock, Mail } from "lucide-react";
import { signIn } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import PasswordInput from "@/components/ui/password-input";

/**
 * The sign-in form: email and password (each with its leading icon), the shared `PasswordInput`'s show /
 * hide control, "Forgot password?" under it, and Sign In. Signing in is exactly what it was - the same
 * `signIn` action and the same fields; only the presentation changed.
 */
export default function LoginForm({ initialError }) {
  const [state, formAction, isPending] = useActionState(
    signIn,
    initialError ? { error: initialError } : {}
  );

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
        <PasswordInput
          id="password"
          name="password"
          icon={Lock}
          autoComplete="current-password"
          required
          disabled={isPending}
          placeholder="Enter your password"
          className="h-11 bg-surface"
        />
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
