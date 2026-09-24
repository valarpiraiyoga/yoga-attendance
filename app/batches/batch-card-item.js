"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarDays, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/ui/avatar";
import EntityCard from "@/components/ui/entity-card";
import { BATCH_STATUS } from "@/lib/status";
import { summarizeCurrentSchedules } from "@/lib/batches/summary";
import { cn } from "@/lib/utils";
import BatchCardMenu from "@/app/batches/batch-card-menu";
import BatchInstructorSummary from "@/app/batches/batch-instructor-summary";

/**
 * Batch list card (finalized reference): identity (larger initials tile, the
 * name primary, the code beneath it secondary, the status badge stacked under
 * View + menu), then a compact schedule summary (Days + Time/count under one
 * calendar icon), then
 * one row pairing Instructor (avatar, name, "Instructor" label — or
 * overlapping avatars + count when several — `BatchInstructorSummary`) with
 * a quiet Students figure. All three derive from the batch's current
 * schedules (`summarizeCurrentSchedules`, lib/batches/summary.js —
 * unmodified) and its active enrollment count; nothing here recomputes
 * either. Card actions follow the finalized pattern shared with Students and
 * Memberships: eye icon (View) + overflow menu.
 *
 * The schedule/instructor/students block renders through `children` rather
 * than `EntityCard`'s `meta` prop: `meta` only accepts a Lucide icon
 * *component* for each row (it renders it as `<Icon />`), which can't
 * express the Instructor row's avatar(s) — composing it here keeps
 * `EntityCard` itself unchanged while still using its header/status/actions
 * exactly as every other list card in this app does.
 *
 * `h-auto` (with CardGrid's `items-start` override, batch-list.js) keeps a
 * batch with a short schedule summary from stretching to match a taller
 * sibling card in the same grid row.
 */
export default function BatchCardItem({ batch }) {
  const [menuOpen, setMenuOpen] = useState(false);

  const status = BATCH_STATUS[batch.displayStatus] ?? BATCH_STATUS.active;
  const summary = summarizeCurrentSchedules(batch.currentSchedules);

  return (
    <EntityCard
      className={cn("h-auto", menuOpen && "border-brand/40 bg-brand/5")}
      iconClassName="text-brand"
      avatar={<Avatar name={batch.name} shape="square" size="lg" bordered />}
      title={batch.name}
      subtitle={batch.code}
      status={<Badge variant={status.variant}>{status.label}</Badge>}
      statusPlacement="actions"
      actions={
        <div className="flex items-center">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-brand hover:bg-brand/10 hover:text-brand"
            aria-label={`View batch ${batch.name}`}
            render={<Link href={`/batches/${batch.id}`} />}
            nativeButton={false}
          >
            <Eye className="size-4" aria-hidden="true" />
          </Button>
          <BatchCardMenu batchId={batch.id} batchName={batch.name} onOpenChange={setMenuOpen} />
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <span
          className="inline-flex min-w-0 items-start gap-2 text-small text-text-secondary"
          title={summary.detail || summary.timeSummary}
        >
          <CalendarDays className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
          <span className="min-w-0">
            <p className="truncate text-body font-semibold text-text-primary">{summary.days}</p>
            <p className="truncate">{summary.timeSummary}</p>
          </span>
        </span>

        <div className="flex items-center justify-between gap-3">
          <BatchInstructorSummary schedules={batch.currentSchedules} size="md" showLabel className="min-w-0" />
          <div className="shrink-0 rounded-lg border border-border bg-background/60 px-4 py-2 text-center">
            <p className="text-section-title font-semibold text-text-primary">{batch.studentCount}</p>
            <p className="text-small text-text-secondary">{batch.studentCount === 1 ? "Student" : "Students"}</p>
          </div>
        </div>
      </div>
    </EntityCard>
  );
}
