"use client";

import { useCallback, useRef, useState } from "react";
import { Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import Toast from "@/components/ui/toast";
import { shareInvoice } from "@/lib/invoices/share-invoice";

/**
 * Share / WhatsApp for the Invoice Detail page. It fetches the PDF from the existing PDF route and
 * either hands it to the browser's native share sheet (where file sharing is supported) or, where it
 * is not, downloads it and opens a WhatsApp click-to-chat with a prepared message - see
 * lib/invoices/share-invoice.js for the flow and the exact behaviour. Nothing is built in the
 * browser: no PDF library, no second endpoint.
 *
 * `share` is `invoiceShareProps(...)` from the page (the route, file name, title, message and chat
 * link). While it works the button is disabled and reads "Preparing…"; a second click cannot start a
 * second run (the ref guards the gap before React re-renders). Closing the share sheet shows nothing.
 * Hidden in print with the page header.
 */
export default function ShareInvoiceButton({ share }) {
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const running = useRef(false);
  const dismiss = useCallback(() => setToast(null), []);

  async function handleShare() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setToast(null);

    try {
      const outcome = await shareInvoice(share, {
        fetch: (url) => fetch(url),
        navigator: typeof navigator === "undefined" ? undefined : navigator,
        createFile: (blob, filename) => new File([blob], filename, { type: "application/pdf" }),
        download: (blob, filename) => {
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = filename;
          document.body.appendChild(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 10000);
        },
        openWindow: (url) => {
          const opened = window.open(url, "_blank");
          if (opened) opened.opener = null;
          return opened;
        },
      });

      if (outcome.message) {
        setToast({ message: outcome.message, tone: outcome.status === "error" || outcome.status === "downloaded-not-opened" ? "error" : "success" });
      }
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={handleShare} disabled={busy} aria-busy={busy}>
        <Share2 className="size-4" aria-hidden="true" />
        {busy ? "Preparing…" : "Share / WhatsApp"}
      </Button>
      <Toast message={toast?.message} tone={toast?.tone} onDismiss={dismiss} />
    </>
  );
}
