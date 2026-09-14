import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * Batch card — name/code/status first, then category and description.
 * View remains the only list action (status changes go through Edit Batch).
 */
export default function BatchCardItem({ batch }) {
  const isActive = batch.status === "active";

  return (
    <article className="flex h-full flex-col gap-3 rounded-2xl border border-border/70 bg-gradient-to-br from-warning/10 via-surface/80 to-brand/10 p-3.5 shadow-sm backdrop-blur-sm">
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-warning/15 text-small font-semibold text-warning"
        >
          {batch.code || "—"}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-body font-semibold leading-snug text-text-primary">{batch.name}</h3>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
            <p className="text-small truncate text-text-secondary">Code: {batch.code}</p>
            <Badge variant="outline" className="rounded-full border-border/70 bg-surface/60 px-2 py-0">
              <span className="text-[10px] leading-[14px] font-medium">{batch.category || "—"}</span>
            </Badge>
          </div>
        </div>
        <Badge variant={isActive ? "success" : "danger"} className="shrink-0 rounded-full px-2 py-0">
          <span className="text-[10px] leading-[14px] font-medium">{isActive ? "Active" : "Inactive"}</span>
        </Badge>
      </div>

      <div className="border-y border-border/50 py-2.5">
        <p className="text-small text-text-secondary">Description</p>
        <p className="text-small mt-0.5 line-clamp-2 leading-snug text-text-primary">
          {batch.description || "—"}
        </p>
      </div>

      <div className="mt-auto">
        <Button
          size="sm"
          variant="outline"
          className="h-9 w-full rounded-full border-border/80 bg-surface/70 text-small font-semibold text-text-primary shadow-xs hover:bg-surface hover:text-text-primary"
          render={<Link href={`/batches/${batch.id}`} />}
          nativeButton={false}
        >
          View Batch
        </Button>
      </div>
    </article>
  );
}
