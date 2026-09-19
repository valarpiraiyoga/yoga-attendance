"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/ui/avatar";
import { TableCell, TableRow } from "@/components/ui/table";
import { formatDate, formatTimeRange } from "@/lib/format";
import { ENTITY_STATUS } from "@/lib/status";
import { DAY_LABELS } from "@/lib/schedules/validation";
import { cn } from "@/lib/utils";
import ScheduleCardMenu from "@/app/schedule/schedule-card-menu";

/**
 * Schedule table row (`13 schedule table view.png`, columns per
 * `02-ux.md`): Batch (avatar + name + code), Day, Time, Instructor,
 * Effective From, Effective Until, Status, Action (finalized eye + overflow
 * menu).
 */
export default function ScheduleTableRow({ schedule }) {
  const [menuOpen, setMenuOpen] = useState(false);

  const status = ENTITY_STATUS[schedule.status] ?? ENTITY_STATUS.inactive;
  const batchName = schedule.batches?.name ?? "—";

  return (
    <TableRow
      className={cn(
        "border-border/30 bg-surface/40 transition-colors hover:bg-surface/70",
        menuOpen && "bg-brand/10 hover:bg-brand/10"
      )}
    >
      <TableCell>
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={batchName} shape="square" />
          <div className="min-w-0">
            <p className="font-semibold text-text-primary">{batchName}</p>
            {schedule.batches?.code ? (
              <p className="text-small text-text-secondary">{schedule.batches.code}</p>
            ) : null}
          </div>
        </div>
      </TableCell>
      <TableCell className="text-text-secondary">
        {DAY_LABELS[schedule.day_of_week] ?? schedule.day_of_week}
      </TableCell>
      <TableCell className="whitespace-nowrap text-text-secondary">
        {formatTimeRange(schedule.start_time, schedule.end_time)}
      </TableCell>
      <TableCell className="text-text-secondary">{schedule.instructors?.full_name ?? "—"}</TableCell>
      <TableCell className="whitespace-nowrap text-text-secondary">{formatDate(schedule.effective_from)}</TableCell>
      <TableCell className="whitespace-nowrap text-text-secondary">{formatDate(schedule.effective_until)}</TableCell>
      <TableCell>
        <Badge variant={status.variant}>{status.label}</Badge>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-brand hover:bg-brand/10 hover:text-brand"
            aria-label={`View schedule for ${batchName}`}
            render={<Link href={`/schedule/${schedule.id}`} />}
            nativeButton={false}
          >
            <Eye className="size-4" aria-hidden="true" />
          </Button>
          <ScheduleCardMenu
            scheduleId={schedule.id}
            batchId={schedule.batches?.id}
            batchName={batchName}
            onOpenChange={setMenuOpen}
          />
        </div>
      </TableCell>
    </TableRow>
  );
}
