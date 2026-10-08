"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Opens the browser's print dialog for the receipt page (the app chrome and this button are hidden in print). */
export default function PrintReceiptButton() {
  return (
    <Button type="button" onClick={() => window.print()}>
      <Printer className="size-4" aria-hidden="true" />
      Print Due Notice
    </Button>
  );
}
