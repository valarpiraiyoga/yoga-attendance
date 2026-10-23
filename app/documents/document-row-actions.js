"use client";

import Link from "next/link";
import { FileText, MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/**
 * The Documents list row's actions: the document icon (open the document - the link the number already is, and the card's open-document icon)
 * and the More (⋮) menu with the same destinations, View Document and, when the document has one, View Membership. The register is read-only:
 * nothing here creates, edits or cancels a document.
 */
export default function DocumentRowActions({ document }) {
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-brand hover:bg-brand/10 hover:text-brand"
        aria-label={`Open ${document.titleLabel} ${document.number}`}
        title="Open document"
        render={<Link href={document.href} />}
        nativeButton={false}
      >
        <FileText className="size-4" aria-hidden="true" />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="shrink-0 text-brand hover:bg-brand/10 hover:text-brand"
              aria-label={`Document actions for ${document.number}`}
            />
          }
        >
          <MoreVertical className="size-4" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuItem render={<Link href={document.href} />} nativeButton={false}>
            View Document
          </DropdownMenuItem>
          {document.membershipCode ? (
            <DropdownMenuItem render={<Link href={document.membershipHref} />} nativeButton={false}>
              View Membership
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
