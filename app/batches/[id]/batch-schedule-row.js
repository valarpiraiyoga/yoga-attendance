"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/ui/avatar";
import { TableCell, TableRow } from "@/components/ui/table";
import { formatDate, formatTimeRange } from "@/lib/format";
import { DAY_LABELS } from "@/lib/schedules/validation";
import { cn } from "@/lib/utils";
import ScheduleCardMenu from "@/app/schedule/schedule-card-menu";
import { scheduleContextOf } from "@/app/schedule/schedule-context";

/**
 * One row of Batch Details' Schedules tab: day, time, instructor, effective
 * period and status, with the finalized action pair — eye icon (View
 * Schedule) + the shared schedule overflow menu (View Schedule, Edit
 * Schedule). No batch is passed to the menu, so it omits "View Batch": this
 * tab already is the batch. Cells stay on one line so the table scrolls inside
 * its container instead of wrapping at narrow widths.
 */
export default function BatchScheduleRow({ schedule }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const day = DAY_LABELS[schedule.day_of_week] ?? schedule.day_of_week;
  const time = formatTimeRange(schedule.start_time, schedule.end_time);
  // Accessible label for the row's actions (the batch name would not tell the rows apart).
  const label = `${day} ${time}`;

  return (
    <TableRow className={cn(menuOpen && "bg-brand/10 hover:bg-brand/10")}>
      {/* Day + Time are the primary, easiest-to-scan info: Day gets the strongest weight,
          Time stays legible but secondary. Effective dates are quieter still (text-small)
          — real, unchanged values (formatDate), just visually de-emphasized. */}
      <TableCell className="py-3 whitespace-nowrap font-medium text-text-primary">{day}</TableCell>
      <TableCell className="py-3 whitespace-nowrap text-text-secondary">{time}</TableCell>
      <TableCell className="py-3 whitespace-nowrap text-text-secondary">
        {schedule.instructors?.full_name ? (
          <span className="inline-flex items-center gap-2">
            <Avatar name={schedule.instructors.full_name} src={schedule.instructors.photo_url} size="sm" />
            {schedule.instructors.full_name}
          </span>
        ) : (
          "—"
        )}
      </TableCell>
      <TableCell className="py-3 text-small whitespace-nowrap text-text-secondary">
        {formatDate(schedule.effective_from)}
      </TableCell>
      <TableCell className="py-3 text-small whitespace-nowrap text-text-secondary">
        {schedule.effective_until ? formatDate(schedule.effective_until) : "—"}
      </TableCell>
      <TableCell className="py-3">
        <Badge variant={schedule.status === "active" ? "success" : "danger"}>
          {schedule.status === "active" ? "Active" : "Inactive"}
        </Badge>
      </TableCell>
      <TableCell className="w-px px-3 py-3 whitespace-nowrap sm:px-4">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-brand hover:bg-brand/10 hover:text-brand"
            aria-label={`View schedule ${label}`}
            render={<Link href={`/schedule/${schedule.id}`} />}
            nativeButton={false}
          >
            <Eye className="size-4" aria-hidden="true" />
          </Button>
          <ScheduleCardMenu
            scheduleId={schedule.id}
            batchName={label}
            scheduleContext={scheduleContextOf(schedule)}
            onOpenChange={setMenuOpen}
          />
        </div>
      </TableCell>
    </TableRow>
  );
}
