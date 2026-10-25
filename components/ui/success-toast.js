"use client";

import { useSyncExternalStore } from "react";
import Toast from "@/components/ui/toast";

/**
 * The app-wide success toast for saves that happen in place - a dialog or an inline form that saves and closes (Record Payment, Issue
 * Receipt, Add Communication, a bank account, a package fee ...) rather than redirecting to a page with `?success=` (those use
 * `FlashToast`). Any client component calls `showSuccessToast("Payment recorded successfully.")` after its action succeeds; the one
 * `SuccessToastHost` in the app shell shows it through the shared `Toast` (top-right, tinted, `role="status"`, auto-dismiss, close
 * button). Because the message lives here and not in the component that saved, it survives that component closing or unmounting and a
 * `router.push` to another page.
 *
 * A tiny external store (no context, no library): one current message, replaced by the next one.
 */
let current = null;
let sequence = 0;
const listeners = new Set();

function emit() {
  for (const listener of listeners) listener();
}

/** Show `text` as a success toast (replacing any toast already showing). */
export function showSuccessToast(text) {
  if (!text) return;
  sequence += 1;
  current = { id: sequence, text };
  emit();
}

function dismiss() {
  current = null;
  emit();
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = () => current;
const getServerSnapshot = () => null;

/** Mounted once, in the app shell: renders whatever `showSuccessToast` last asked for. */
export function SuccessToastHost() {
  const toast = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // Keyed by the message's id, so a second save with the same text restarts the toast's timer.
  return <Toast key={toast?.id ?? "none"} message={toast?.text} tone="success" onDismiss={dismiss} />;
}
