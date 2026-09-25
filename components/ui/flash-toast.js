"use client";

import { useCallback, useEffect, useState } from "react";
import Toast from "@/components/ui/toast";

/**
 * Shows a server-known success message (a page reached by a redirect with
 * `?success=<key>`, the project's redirect-after-save convention) through the
 * shared `Toast`, instead of an inline banner that would sit in the layout and
 * push the page down. It is only the bridge between a server page and the
 * client-only toast: the message, position, styling, timing and announcement are
 * all `Toast`'s own (bottom-right overlay, `role="status"`, 4s, close button).
 *
 * The `success` query parameter is removed from the address once shown, so a
 * reload or a copied link does not show the toast again. That is a history
 * `replaceState` (no navigation, no server round trip, no scroll or focus move).
 * A later save that lands on the same page with a new message shows again.
 *
 * @param {object} props
 * @param {string|null|undefined} props.message
 */
export default function FlashToast({ message }) {
  const [text, setText] = useState(message ?? null);
  const [prevMessage, setPrevMessage] = useState(message ?? null);

  // A different message from the server (another save landing here) shows again.
  if ((message ?? null) !== prevMessage) {
    setPrevMessage(message ?? null);
    if (message) setText(message);
  }

  useEffect(() => {
    if (!message) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("success")) return;
    url.searchParams.delete("success");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }, [message]);

  const dismiss = useCallback(() => setText(null), []);

  return <Toast message={text} tone="success" onDismiss={dismiss} />;
}
