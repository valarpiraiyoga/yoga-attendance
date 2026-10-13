"use client";

import { useState, useTransition } from "react";

/**
 * Runs one package server action from a dialog (`lib/packages/actions.js` returns `{ success }` or
 * `{ error, fieldErrors? }`). Holds the pending flag, the banner error and the field errors; `onSuccess` gets the result.
 */
export function usePackageAction(onSuccess) {
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [isPending, startTransition] = useTransition();

  function reset() {
    setError(null);
    setFieldErrors({});
  }

  function run(call) {
    reset();
    startTransition(async () => {
      const result = await call();
      if (result?.success) {
        onSuccess?.(result);
        return;
      }
      setError(result?.error ?? "Something went wrong. Try again.");
      setFieldErrors(result?.fieldErrors ?? {});
    });
  }

  return { error, fieldErrors, isPending, run, reset };
}
