"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarDays, Clock, Eye, UserRound, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/ui/avatar";
import EntityCard from "@/components/ui/entity-card";
import { BATCH_STATUS } from "@/lib/status";
import { formatStudentCount, summarizeCurrentSchedules } from "@/lib/batches/summary";
import { cn } from "@/lib/utils";
import BatchCardMenu from "@/app/batches/batch-card-menu";

/**
 * Batch list card (`08 Batches card view.png`): identity (avatar, name,
 * code, status), then Time / Days / Instructor / Students. Time, Days and
 * Instructor summarise the batch's current schedules; Students is its active
 * enrollments. Card actions follow the finalized pattern shared with
 * Students and Memberships: eye icon (View) + overflow menu. Composed from
 * `EntityCard`; only the menu-open tint is local state.
 */
export default function BatchCardItem({ batch }) {
  const [menuOpen, setMenuOpen] = useState(false);

  const status = BATCH_STATUS[batch.displayStatus] ?? BATCH_STATUS.active;
  const summary = summarizeCurrentSchedules(batch.currentSchedules);
  const students = formatStudentCount(batch.studentCount);

  return (
    <EntityCard
      className={cn(menuOpen && "border-brand/40 bg-brand/5")}
      iconClassName="text-brand"
      avatar={<Avatar name={batch.name} shape="square" bordered />}
      title={batch.name}
      subtitle={batch.code}
      status={<Badge variant={status.variant}>{status.label}</Badge>}
      actions={
        <>
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
        </>
      }
      meta={[
        { icon: Clock, label: summary.time, title: summary.time },
        { icon: CalendarDays, label: summary.days, title: summary.days },
        { icon: UserRound, label: summary.instructor, title: summary.instructor },
        { icon: Users, label: students, title: students },
      ]}
    />
  );
}
