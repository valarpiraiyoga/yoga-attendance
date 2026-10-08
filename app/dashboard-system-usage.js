import { Suspense } from "react";
import { Database } from "lucide-react";
import Progress from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { getSystemUsage } from "@/lib/system-usage/data";
import { buildSystemUsage } from "@/lib/system-usage/usage";
import { cn } from "@/lib/utils";

// The same frame as the other Dashboard side panels (see dashboard-side-panels.js).
const PANEL = "rounded-card border border-border bg-surface p-4 shadow-xs";

// Status -> the existing semantic tokens (success / warning / danger), for the bar and the message.
const TONE = {
  normal: { bar: "success", badge: "bg-success/10 text-success", text: "text-text-secondary" },
  warning: { bar: "warning", badge: "bg-warning/10 text-warning", text: "text-text-secondary" },
  critical: { bar: "danger", badge: "bg-danger/10 text-danger", text: "text-danger" },
  limit: { bar: "danger", badge: "bg-danger/10 text-danger", text: "text-danger" },
};

function Heading({ children }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <h2 id="system-usage-heading" className="flex items-center gap-2 text-body font-semibold text-text-primary">
        <Database className="size-4 text-text-secondary" aria-hidden="true" />
        System Usage
      </h2>
      {children}
    </div>
  );
}

function SystemUsageSkeleton() {
  return (
    <section className={PANEL} aria-busy="true" aria-label="Loading system usage">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="mt-4 h-10 w-full" />
      <Skeleton className="mt-3 h-10 w-full" />
    </section>
  );
}

/**
 * The Free plan usage of the database and of file storage, each against its limit, with one
 * overall status. Server component; Admin only (the Dashboard renders it only for an Admin, and
 * the data function and the database function both check the role again). When the numbers cannot
 * be read it says so and shows no figures.
 */
async function SystemUsageContent() {
  const raw = await getSystemUsage();

  if (!raw) {
    return (
      <section className={PANEL} aria-labelledby="system-usage-heading">
        <Heading />
        <p className="text-small mt-3 text-text-secondary">Usage is unavailable right now.</p>
      </section>
    );
  }

  const usage = buildSystemUsage(raw);
  const tone = TONE[usage.status];

  return (
    <section className={PANEL} aria-labelledby="system-usage-heading">
      <Heading>
        <span className="text-small shrink-0 rounded-full bg-neutral/10 px-2 py-0.5 font-medium text-text-secondary">Free Plan</span>
      </Heading>

      <div className="mt-3 flex flex-col gap-4">
        {usage.items.map((item) => (
          <div key={item.key}>
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-small font-medium text-text-primary">{item.label}</p>
              <p className="text-small tabular-nums text-text-primary">
                {item.usedText} / {item.limitText}
              </p>
            </div>
            <Progress value={item.percent} tone={TONE[item.status].bar} label={`${item.label} used`} className="mt-1.5" />
            <p className="text-small mt-1 tabular-nums text-text-secondary">
              {item.percentText} used · {item.remainingText} remaining
            </p>
          </div>
        ))}
      </div>

      <p className={cn("text-small mt-4 flex items-center gap-2", tone.text)} role="status">
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 font-medium", tone.badge)}>{usage.statusLabel}</span>
        {usage.message}
      </p>
    </section>
  );
}

export default function DashboardSystemUsage() {
  return (
    <Suspense fallback={<SystemUsageSkeleton />}>
      <SystemUsageContent />
    </Suspense>
  );
}
