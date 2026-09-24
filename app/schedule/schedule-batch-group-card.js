"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarDays, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import BatchAvatar from "@/components/ui/batch-avatar";
import { ENTITY_STATUS } from "@/lib/status";
import { summarizeCurrentSchedules } from "@/lib/batches/summary";
import { cn } from "@/lib/utils";
import BatchCardMenu from "@/app/batches/batch-card-menu";
import BatchInstructorSummary from "@/app/batches/batch-instructor-summary";

/**
 * Schedule List Cards view: one compact card per batch. The header no longer
 * fits `EntityCard`'s title/subtitle/status slots — this card needs three
 * stacked lines on the left (name, schedule count, code — both name and
 * count in brand color) and a two-tier right column (View + menu above the
 * status badge, not beside it) — so it replicates `EntityCard`'s own shell
 * styling directly (`rounded-card border border-border bg-surface p-4
 * shadow-sm`) rather than forcing that shape through slots it wasn't built
 * for. A Days/Time summary line, and one row pairing Instructor
 * (`BatchInstructorSummary`, shared unchanged with the Batches card) with a
 * Students figure, are otherwise unchanged.
 *
 * `schedules` is this batch's full set for this group, already Monday →
 * Sunday / start-time ordered (`groupSchedulesByBatch`,
 * lib/schedules/validation.js); `summarizeCurrentSchedules`
 * (lib/batches/summary.js, unmodified) is reused as a generic "summarize
 * this list of schedule rows" formatter here, not for its "current" framing
 * — the Schedule List's own Status filter already decides which schedules
 * are in this set, so nothing here re-filters by effective date.
 *
 * Per-schedule actions (View, Edit, Delete) no longer appear on this card:
 * the compact summary has no row to hang them on, matching the reference
 * layout. Table View (unchanged) still lists every schedule with its own
 * View + overflow menu for that granularity.
 *
 * `studentCount` comes from `batch.studentCount` (lib/schedules/data.js's
 * `listSchedules`, active enrollments — same definition Batch Details uses).
 */
export default function ScheduleBatchGroupCard({ batch, batchId, schedules }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const batchName = batch?.name ?? "Unknown batch";
  const status = ENTITY_STATUS[batch?.status] ?? ENTITY_STATUS.inactive;
  const summary = summarizeCurrentSchedules(schedules);
  const studentCount = batch?.studentCount ?? 0;
  const count = schedules.length;

  return (
    <div
      className={cn(
        "flex h-auto flex-col gap-3 rounded-card border border-border bg-surface p-4 shadow-sm",
        menuOpen && "border-brand/40 bg-brand/5"
      )}
    >
      <div className="flex items-start gap-2.5">
        <BatchAvatar batch={{ ...batch, name: batchName }} />
        <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-body font-semibold text-brand">{batchName}</p>
            <p className="truncate text-small font-semibold text-brand">
              {count} {count === 1 ? "schedule" : "schedules"}
            </p>
            <p className="truncate text-small text-text-secondary">
              {batch?.code ? `Code: ${batch.code}` : "No batch"}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <div className="flex items-center">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-brand hover:bg-brand/10 hover:text-brand"
                aria-label={`View batch ${batchName}`}
                render={<Link href={`/batches/${batchId}`} />}
                nativeButton={false}
              >
                <Eye className="size-4" aria-hidden="true" />
              </Button>
              <BatchCardMenu batchId={batchId} batchName={batchName} onOpenChange={setMenuOpen} />
            </div>
            <Badge variant={status.variant}>{status.label}</Badge>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-3">
        <span
          className="inline-flex min-w-0 items-start gap-1.5 text-small text-text-secondary"
          title={summary.detail || summary.time}
        >
          <CalendarDays className="mt-0.5 size-3.5 shrink-0 text-text-secondary" aria-hidden="true" />
          <span className="min-w-0">
            <p className="truncate font-semibold text-text-primary">{summary.days}</p>
            {/* Just the time range — the schedule count already sits in the
                header now, so it is not restated here. */}
            <p className="truncate">{summary.time}</p>
          </span>
        </span>

        <div className="flex items-center justify-between gap-3">
          <BatchInstructorSummary schedules={schedules} size="md" showLabel className="min-w-0" />
          <div className="shrink-0 rounded-lg border border-border bg-background/60 px-4 py-2 text-center">
            <p className="text-section-title font-semibold text-text-primary">{studentCount}</p>
            <p className="text-small text-text-secondary">{studentCount === 1 ? "Student" : "Students"}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
