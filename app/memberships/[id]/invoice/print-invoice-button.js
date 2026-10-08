"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Opens the browser's print dialog for the invoice page (the app chrome, page header and this button are hidden in print). */
export default function PrintInvoiceButton() {
  return (
    <Button type="button" onClick={() => window.print()}>
      <Printer className="size-4" aria-hidden="true" />
      Print
    </Button>
  );
}
