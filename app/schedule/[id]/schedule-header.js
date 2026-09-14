import Link from "next/link";
import { ArrowLeft, ArrowRight, Calendar, Clock, Layers, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DAY_LABELS } from "@/lib/schedules/validation";
import DeactivateSchedule from "@/app/schedule/[id]/deactivate-schedule";

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

function formatTime(value) {
  if (!value) return "—";
  const [hours, minutes] = value.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${period}`;
}

/**
 * Schedule Details hero + KPI strip — visual sibling of BatchHeader's top
 * block. Folder tabs live in schedule-details-tabs.js (client) so they can
 * keep local-state switching while matching Batch Detail's tab chrome.
 */
export default function ScheduleHeader({ schedule }) {
  const isActive = schedule.status === "active";
  const batchName = schedule.batches?.name ?? "Schedule";
  const batchCode = schedule.batches?.code || "—";
  const dayLabel = DAY_LABELS[schedule.day_of_week] ?? schedule.day_of_week;
  const timeLabel = `${formatTime(schedule.start_time)} – ${formatTime(schedule.end_time)}`;
  const instructorName = schedule.instructors?.full_name ?? "—";

  return (
    <div className="mb-6 flex flex-col gap-4">
      <Link
        href="/schedule"
        className="text-body inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to Schedule
      </Link>

      <div className="overflow-hidden rounded-2xl border border-border/70 bg-gradient-to-br from-info/10 via-surface to-brand/10 shadow-xs">
        <section className="relative p-4 sm:p-5">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-8 -right-6 size-32 rounded-full border border-info/20"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-8 right-12 size-16 rounded-full border border-brand/20"
          />

          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3 sm:gap-4">
              <span className="flex size-16 shrink-0 items-center justify-center rounded-full border-2 border-info/40 bg-info/10 text-small font-semibold text-info sm:size-[4.25rem]">
                {batchCode}
              </span>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-page-title font-semibold break-words text-brand">{batchName}</h1>
                  <Badge variant={isActive ? "success" : "danger"} className="px-1.5 py-0">
                    <span className="text-[10px] leading-[14px] font-medium">
                      {isActive ? "Active" : "Inactive"}
                    </span>
                  </Badge>
                </div>
                <p className="text-small mt-1 text-text-secondary">
                  {dayLabel} · {timeLabel}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
              <DeactivateSchedule scheduleId={schedule.id} isActive={isActive} />
              <Button
                size="sm"
                variant="outline"
                className="border-brand/30 bg-surface/80 text-brand hover:bg-brand/5 hover:text-brand"
                render={<Link href={`/schedule/${schedule.id}/edit`} />}
                nativeButton={false}
              >
                Edit Schedule
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-2 gap-2 border-t border-border/50 bg-surface/50 px-3 py-2.5 sm:gap-2.5 sm:px-4 sm:py-3 lg:grid-cols-4">
          <MetricTile
            icon={UserRound}
            value={isActive ? "Active" : "Inactive"}
            label="Status"
            tone={isActive ? "success" : "warning"}
          />
          <MetricTile icon={Calendar} value={dayLabel} label="Day" tone="info" />
          <MetricTile icon={Clock} value={timeLabel} label="Time" tone="warning" />
          <MetricTile icon={Layers} value={instructorName} label="Instructor" tone="brand" />
        </div>
      </div>
    </div>
  );
}
