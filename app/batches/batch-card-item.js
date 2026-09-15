import Link from "next/link";
import { CalendarClock, CalendarDays, Eye, Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * Batch card list item — name/status + code/category/schedules compact card.
 * View (eye) is the only list action (status changes go through Edit Batch).
 */
export default function BatchCardItem({ batch }) {
  const isActive = batch.status === "active";
  const scheduleCount = batch.scheduleCount ?? 0;

  return (
    <article className="flex h-full flex-col gap-3 rounded-2xl border border-border/70 bg-surface p-4 shadow-sm">
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand/15 text-small font-semibold text-brand"
        >
          {batch.code || "—"}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-1.5">
            <div className="min-w-0 flex-1">
              <h3
                className="truncate text-body font-semibold leading-snug text-text-primary"
                title={batch.name}
              >
                {batch.name}
              </h3>
              <Badge
                variant={isActive ? "success" : "danger"}
                className="mt-1 rounded-full px-2 py-0"
              >
                <span className="text-[10px] leading-[14px] font-medium">
                  {isActive ? "Active" : "Inactive"}
                </span>
              </Badge>
            </div>

            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="shrink-0 text-brand hover:bg-brand/10 hover:text-brand"
              aria-label={`View batch ${batch.name}`}
              render={<Link href={`/batches/${batch.id}`} />}
              nativeButton={false}
            >
              <Eye className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 text-small text-text-secondary">
        <span className="inline-flex min-w-0 items-center gap-2" title={`Code: ${batch.code || "—"}`}>
          <Layers className="size-3.5 shrink-0 text-text-secondary" aria-hidden="true" />
          <span className="min-w-0 truncate">
            Code: <span className="font-semibold text-text-primary">{batch.code || "—"}</span>
          </span>
        </span>

        <span
          className="inline-flex min-w-0 items-center gap-2"
          title={`Category : ${batch.category || "—"}`}
        >
          <CalendarDays className="size-3.5 shrink-0 text-text-secondary" aria-hidden="true" />
          <span className="min-w-0 truncate">Category : {batch.category || "—"}</span>
        </span>

        <span
          className="inline-flex min-w-0 items-center gap-2"
          title={`# of Weekly Schedules: ${scheduleCount}`}
        >
          <CalendarClock className="size-3.5 shrink-0 text-text-secondary" aria-hidden="true" />
          <span className="min-w-0 truncate">
            # of Weekly Schedules:{" "}
            <span className="font-semibold text-text-primary">{scheduleCount}</span>
          </span>
        </span>
      </div>
    </article>
  );
}
