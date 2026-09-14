"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export default function BatchTableRow({ batch }) {
  const [focused, setFocused] = useState(false);
  const isActive = batch.status === "active";

  return (
    <TableRow
      className={cn(
        "border-border/40 transition-colors",
        focused ? "bg-brand/10" : "hover:bg-brand/5"
      )}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setFocused(false);
        }
      }}
    >
      <TableCell className="px-5 py-3.5">
        <p className="font-semibold text-text-primary">{batch.name}</p>
        <p className="text-small text-text-secondary">{batch.code}</p>
      </TableCell>
      <TableCell className="px-5 py-3.5 text-text-secondary">{batch.category || "—"}</TableCell>
      <TableCell className="max-w-xs truncate px-5 py-3.5 text-text-secondary">
        {batch.description || "—"}
      </TableCell>
      <TableCell className="px-5 py-3.5">
        <Badge variant={isActive ? "success" : "danger"} className="rounded-full px-2 py-0">
          <span className="text-[10px] leading-[14px] font-medium">{isActive ? "Active" : "Inactive"}</span>
        </Badge>
      </TableCell>
      <TableCell className="px-5 py-3.5">
        <Button
          size="icon-sm"
          variant="ghost"
          className="text-text-secondary hover:text-brand"
          render={<Link href={`/batches/${batch.id}`} />}
          nativeButton={false}
          aria-label={`View batch ${batch.name}`}
        >
          <Eye className="size-4" aria-hidden="true" />
        </Button>
      </TableCell>
    </TableRow>
  );
}
