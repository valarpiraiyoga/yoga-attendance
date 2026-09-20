"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye } from "lucide-react";
import Avatar from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import { DISPLAY_STATUS_LABELS, DISPLAY_STATUS_BADGE_VARIANTS } from "@/lib/class-sessions/validation";
import { cn } from "@/lib/utils";
import HistoryCardMenu from "@/app/attendance-history/history-card-menu";

function formatTime(value) {
  if (!value) return "—";
  const [hours, minutes] = value.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${period}`;
}

function formatDate(value) {
  if (!value) return "—";
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function getInitials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0].toUpperCase();

  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/**
 * One Attendance History table row, for both role variants (the columns are
 * the wireframe's: admin shows Instructor and Attendance %, an instructor
 * shows the Completed status). Only the Action cell follows the finalized
 * pattern shared with the other list pages — eye icon (View Details) +
 * overflow menu (View Details, Edit Attendance), the same `HistoryCardMenu`
 * the Card View uses. The row tints while its menu is open. `hideBatch` omits
 * the Batch cell (must match the table header) on batch-scoped pages, where
 * the freed width goes to keeping Date and Time on one line.
 */
export default function HistoryTableRow({ session, variant = "admin", hideBatch = false }) {
  const [menuOpen, setMenuOpen] = useState(false);

  const summary = session.attendanceSummary;
  const instructorName = session.instructors?.full_name ?? null;
  const instructorPhotoUrl = session.instructors?.photo_url ?? null;
  const batchName = session.batches?.name ?? "—";
  const detailsHref = `/attendance-history/${session.schedule_id}/${session.session_date}`;

  return (
    <TableRow className={cn(menuOpen && "bg-brand/10 hover:bg-brand/10")}>
      <TableCell className={cn("px-5 py-3.5 font-medium text-text-primary", hideBatch && "whitespace-nowrap")}>
        {formatDate(session.session_date)}
      </TableCell>
      <TableCell className={cn("px-5 py-3.5 text-text-secondary", hideBatch && "whitespace-nowrap")}>
        {formatTime(session.start_time)} – {formatTime(session.end_time)}
      </TableCell>
      {!hideBatch ? (
        <TableCell className="px-5 py-3.5">
          {session.batches ? (
            <>
              <p className="font-semibold text-text-primary">{session.batches.name}</p>
              <p className="text-small text-text-secondary">{session.batches.code}</p>
            </>
          ) : (
            <span className="text-text-secondary">—</span>
          )}
        </TableCell>
      ) : null}
      {variant === "admin" ? (
        <TableCell className="px-5 py-3.5">
          <span className="inline-flex min-w-0 items-center gap-2">
            {instructorPhotoUrl ? (
              <Avatar name={instructorName} src={instructorPhotoUrl} className="size-7" />
            ) : (
              <span
                aria-hidden="true"
                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand/10 text-[10px] font-semibold leading-none text-brand"
              >
                {instructorName ? getInitials(instructorName) : "?"}
              </span>
            )}
            <span className="truncate text-text-secondary">{instructorName || "—"}</span>
          </span>
        </TableCell>
      ) : null}
      <TableCell className="px-5 py-3.5 text-right tabular-nums text-text-secondary">
        {summary?.eligibleCount ?? 0}
      </TableCell>
      <TableCell className="px-5 py-3.5 text-right tabular-nums font-medium text-success">
        {summary?.presentCount ?? 0}
      </TableCell>
      <TableCell className="px-5 py-3.5 text-right tabular-nums font-medium text-danger">
        {summary?.absentCount ?? 0}
      </TableCell>
      {variant === "admin" ? (
        <TableCell className="px-5 py-3.5 text-right tabular-nums font-semibold text-text-primary">
          {summary?.percentage ?? 0}%
        </TableCell>
      ) : (
        <TableCell className="px-5 py-3.5">
          <Badge variant={DISPLAY_STATUS_BADGE_VARIANTS.completed} className="rounded-full px-2 py-0">
            <span className="text-[10px] leading-[14px] font-medium">{DISPLAY_STATUS_LABELS.completed}</span>
          </Badge>
        </TableCell>
      )}
      <TableCell className="px-5 py-3.5">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-brand hover:bg-brand/10 hover:text-brand"
            aria-label={`View attendance details for ${batchName}`}
            render={<Link href={detailsHref} />}
            nativeButton={false}
          >
            <Eye className="size-4" aria-hidden="true" />
          </Button>
          <HistoryCardMenu batchName={batchName} detailsHref={detailsHref} onOpenChange={setMenuOpen} />
        </div>
      </TableCell>
    </TableRow>
  );
}
