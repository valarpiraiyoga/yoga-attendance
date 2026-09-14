import Link from "next/link";
import { ArrowLeft, ArrowRight, Calendar, Layers, Tag, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

function MetricTile({ icon: Icon, value, label, tone }) {
  const tones = {
    warning: "border-warning/20 bg-warning/10 text-warning",
    info: "border-info/20 bg-info/10 text-info",
    success: "border-success/20 bg-success/10 text-success",
    brand: "border-brand/20 bg-brand/10 text-brand",
  };

  return (
    <div className={`flex min-w-0 items-center gap-2.5 rounded-xl border px-3 py-2.5 ${tones[tone] ?? tones.brand}`}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface/80 shadow-xs">
        <Icon className="size-3.5" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-[10px] leading-[14px] font-medium tracking-wide text-text-secondary uppercase">
          {label}
        </p>
        <p className="truncate text-body font-semibold tracking-tight text-text-primary">{value}</p>
      </div>
    </div>
  );
}

/**
 * Batch Details' shared header + tab nav (wireframe p17-19: Overview /
 * Students / Schedules). Visual language aligned with Student / Membership
 * detail heroes; optional `metrics` drives the KPI strip when provided.
 * Tab page content is passed as `children` so it sits inside the folder-tab box.
 */
export default function BatchHeader({ batch, active, metrics = null, children }) {
  const isActive = batch.status === "active";

  return (
    <div className="mb-6 flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <Link
          href="/batches"
          className="text-body inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to Batches
        </Link>

        <div className="overflow-hidden rounded-2xl border border-border/70 bg-gradient-to-br from-warning/10 via-surface to-brand/10 shadow-xs">
          <section className="relative p-4 sm:p-5">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -top-8 -right-6 size-32 rounded-full border border-warning/20"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute top-8 right-12 size-16 rounded-full border border-brand/20"
            />

            <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                <span className="flex size-16 shrink-0 items-center justify-center rounded-full border-2 border-warning/40 bg-warning/10 text-small font-semibold text-warning sm:size-[4.25rem]">
                  {batch.code || "—"}
                </span>

                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-page-title font-semibold break-words text-brand">{batch.name}</h1>
                    <Badge variant={isActive ? "success" : "danger"} className="px-1.5 py-0">
                      <span className="text-[10px] leading-[14px] font-medium">
                        {isActive ? "Active" : "Inactive"}
                      </span>
                    </Badge>
                  </div>
                  <p className="text-small mt-1 text-text-secondary">Code: {batch.code}</p>
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  className="border-brand/30 bg-surface/80 text-brand hover:bg-brand/5 hover:text-brand"
                  render={<Link href={`/batches/${batch.id}/edit`} />}
                  nativeButton={false}
                >
                  Edit Batch
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </Button>
              </div>
            </div>
          </section>

          {metrics ? (
            <div className="grid grid-cols-2 gap-2 border-t border-border/50 bg-surface/50 px-3 py-2.5 sm:gap-2.5 sm:px-4 sm:py-3 lg:grid-cols-4">
              <MetricTile
                icon={UserRound}
                value={isActive ? "Active" : "Inactive"}
                label="Status"
                tone={isActive ? "success" : "warning"}
              />
              <MetricTile
                icon={Layers}
                value={metrics.studentCount}
                label="Students"
                tone="info"
              />
              <MetricTile
                icon={Calendar}
                value={metrics.scheduleCount}
                label="Schedules"
                tone="warning"
              />
              <MetricTile
                icon={Tag}
                value={batch.category || "—"}
                label="Category"
                tone="brand"
              />
            </div>
          ) : null}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border/70 bg-surface shadow-xs">
        <nav aria-label="Batch sections" className="folder-tabs-track px-3 pt-1.5">
          <ul className="flex items-end gap-0.5">
            {[
              { key: "overview", href: `/batches/${batch.id}`, label: "Overview" },
              { key: "students", href: `/batches/${batch.id}/students`, label: "Students" },
              { key: "schedules", href: `/batches/${batch.id}/schedules`, label: "Schedules" },
            ].map((tab) => {
              const isTabActive = active === tab.key;
              return (
                <li key={tab.key}>
                  <Link
                    href={tab.href}
                    aria-current={isTabActive ? "page" : undefined}
                    className={
                      isTabActive
                        ? "folder-tab-active inline-flex px-4 pt-2.5 pb-2.5 text-body font-semibold text-text-primary sm:px-5"
                        : "inline-flex px-4 pt-2.5 pb-2.5 text-body text-text-secondary transition-colors hover:text-text-primary sm:px-5"
                    }
                  >
                    <span className="relative inline-flex flex-col items-center gap-1.5">
                      {tab.label}
                      {isTabActive ? (
                        <span
                          aria-hidden="true"
                          className="h-0.5 w-full rounded-full bg-text-primary"
                        />
                      ) : (
                        <span aria-hidden="true" className="h-0.5 w-full" />
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="bg-surface px-4 pt-4 pb-4 sm:px-5 sm:pb-5">{children}</div>
      </div>
    </div>
  );
}
