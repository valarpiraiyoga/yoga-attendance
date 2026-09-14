"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import { DAY_LABELS } from "@/lib/schedules/validation";
import { cn } from "@/lib/utils";

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

export default function ScheduleTableRow({ schedule }) {
  const [focused, setFocused] = useState(false);
  const isActive = schedule.status === "active";

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
        {schedule.batches ? (
          <>
            <p className="font-semibold text-text-primary">{schedule.batches.name}</p>
            <p className="text-small text-text-secondary">{schedule.batches.code}</p>
          </>
        ) : (
          <span className="text-text-secondary">—</span>
        )}
      </TableCell>
      <TableCell className="px-5 py-3.5 text-text-secondary">
        {DAY_LABELS[schedule.day_of_week] ?? schedule.day_of_week}
      </TableCell>
      <TableCell className="px-5 py-3.5 text-text-secondary">
        {formatTime(schedule.start_time)} – {formatTime(schedule.end_time)}
      </TableCell>
      <TableCell className="px-5 py-3.5 text-text-secondary">
        {schedule.instructors?.full_name ?? "—"}
      </TableCell>
      <TableCell className="px-5 py-3.5 text-text-secondary">
        {formatDate(schedule.effective_from)}
      </TableCell>
      <TableCell className="px-5 py-3.5 text-text-secondary">
        {schedule.effective_until ? formatDate(schedule.effective_until) : "—"}
      </TableCell>
      <TableCell className="px-5 py-3.5">
        <Badge variant={isActive ? "success" : "danger"} className="rounded-full px-2 py-0">
          <span className="text-[10px] leading-[14px] font-medium">
            {isActive ? "Active" : "Inactive"}
          </span>
        </Badge>
      </TableCell>
      <TableCell className="px-5 py-3.5">
        <Button
          size="icon-sm"
          variant="ghost"
          className="text-text-secondary hover:text-brand"
          render={<Link href={`/schedule/${schedule.id}`} />}
          nativeButton={false}
          aria-label={`View schedule for ${schedule.batches?.name ?? "batch"}`}
        >
          <Eye className="size-4" aria-hidden="true" />
        </Button>
      </TableCell>
    </TableRow>
  );
}
