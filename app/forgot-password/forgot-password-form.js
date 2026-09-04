"use client";

import { useActionState } from "react";
import { requestPasswordReset } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ForgotPasswordForm() {
  const [state, formAction, isPending] = useActionState(
    requestPasswordReset,
    {}
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

      {state?.success ? (
        <p
          role="status"
          className="text-body rounded-input border border-success/30 bg-success/5 px-3 py-2 text-text-primary"
        >
          {state.success}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          disabled={isPending}
          placeholder="Enter your email"
        />
      </div>

      <Button type="submit" disabled={isPending} className="mt-1 w-full">
        {isPending ? "Sending…" : "Send reset link"}
      </Button>
    </form>
  );
}
