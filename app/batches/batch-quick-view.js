"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarDays, Layers, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import BatchAvatar from "@/components/ui/batch-avatar";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { BATCH_STATUS } from "@/lib/status";
import { summarizeCurrentSchedules } from "@/lib/batches/summary";
import BatchInstructorSummary from "@/app/batches/batch-instructor-summary";

function Fact({ icon: Icon, label, children }) {
  return (
    <div className="flex items-start gap-3 rounded-card border border-border bg-surface px-3 py-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-small text-text-secondary">{label}</p>
        <div className="text-body font-medium text-text-primary">{children}</div>
      </div>
    </div>
  );
}

/**
 * The batch's name as a link-styled button that opens a quick view in a right-hand panel (Batches list, table and cards): the batch's mark,
 * name, code, category and status, its instructor(s), days and time, schedule count and students - all from the row the list already loaded -
 * and a View Details button to Batch Details. Read-only; opening it changes and fetches nothing.
 *
 * @param {object} props
 * @param {object} props.batch - one entry of the Batches list (`displayStatus`, `currentSchedules`, `studentCount`, ...).
 */
export default function BatchQuickView({ batch }) {
  const [open, setOpen] = useState(false);
  const status = BATCH_STATUS[batch.displayStatus] ?? BATCH_STATUS.active;
  const summary = summarizeCurrentSchedules(batch.currentSchedules);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="rounded-sm text-left text-brand hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        {batch.name}
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
          <SheetHeader className="flex-row items-center gap-3 border-b border-border p-5 pr-14">
            <BatchAvatar batch={batch} size="lg" className="shrink-0" />
            <div className="min-w-0">
              <SheetTitle className="text-section-title font-semibold break-words text-text-primary">{batch.name}</SheetTitle>
              <SheetDescription className="text-small text-text-secondary">
                {[batch.code ? `Code: ${batch.code}` : null, batch.category].filter(Boolean).join(" · ") || "Batch"}
              </SheetDescription>
              <div className="mt-1.5">
                <Badge variant={status.variant}>{status.label}</Badge>
              </div>
            </div>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-5">
            <Fact icon={Users} label="Instructor">
              <BatchInstructorSummary schedules={batch.currentSchedules} size="md" showLabel className="min-w-0" />
            </Fact>
            <Fact icon={CalendarDays} label="Days & Time">
              {summary.hasSchedule ? (
                <>
                  <p>{summary.days}</p>
                  <p className="text-small font-normal text-text-secondary">{summary.time}</p>
                </>
              ) : (
                <p className="font-normal text-text-secondary">{summary.time}</p>
              )}
            </Fact>
            <div className="grid grid-cols-2 gap-3">
              <Fact icon={Layers} label="Schedules">
                {summary.count}
              </Fact>
              <Fact icon={Users} label="Students">
                {batch.studentCount}
              </Fact>
            </div>
          </div>

          <SheetFooter className="border-t border-border p-5">
            <Button render={<Link href={`/batches/${batch.id}`} />} nativeButton={false}>
              View Details
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
