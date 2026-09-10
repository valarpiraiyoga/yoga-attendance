import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getBatch } from "@/lib/batches/data";
import { listSchedulesForBatch } from "@/lib/schedules/data";
import { DAY_LABELS } from "@/lib/schedules/validation";
import BatchHeader from "@/app/batches/[id]/batch-header";

const SUCCESS_MESSAGES = {
  created: "Batch created successfully.",
  updated: "Batch updated successfully.",
};

function formatTime(value) {
  if (!value) return "—";
  const [hours, minutes] = value.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${period}`;
}

/**
 * Batch Details (wireframe p17-19): Overview / Students / Schedules tabs.
 *
 * Overview and Schedules are both implemented (Phase 11 Students, Phase 13
 * Schedule). Students still renders as a visible-but-disabled tab — that
 * placeholder predates Phase 13 and is out of this phase's scope
 * (04-development-plan.md §7 Open Items), exactly mirroring how
 * app/settings/layout.js treats its own inert tabs.
 *
 * The wireframe's Overview tab also shows a "Students" summary panel,
 * still populated with data from Phase 11 (Students), which does not exist
 * on this page. Rather than fabricate a count or omit the approved panel
 * outright, it keeps its approved position and heading and states plainly
 * that the data isn't available yet — the same treatment this page
 * previously gave both panels before Schedules had real data.
 */
export default async function BatchDetailsPage({ params, searchParams }) {
  // Authorization boundary — see app/batches/layout.js for why this must be
  // repeated here rather than relying on the layout alone.
  await requireRole(ROLES.ADMIN);

  const { id } = await params;
  const batch = await getBatch(id);

  if (!batch) {
    notFound();
  }

  const schedules = await listSchedulesForBatch(id);
  const activeSchedules = schedules.filter((schedule) => schedule.status === "active");

  const rawParams = await searchParams;
  const message = SUCCESS_MESSAGES[rawParams?.success] ?? null;

  return (
    <div>
      <BatchHeader batch={batch} active="overview" />

      {message ? (
        <div
          role="status"
          className="mb-6 rounded-input border border-success/30 bg-success/5 px-3 py-2 text-body text-success"
        >
          {message}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <div className="rounded-card border border-border bg-surface p-6 shadow-xs">
            <h2 className="text-section-title border-b border-border pb-4 font-semibold text-text-primary">
              Batch Information
            </h2>

            <dl className="mt-5 flex flex-col gap-5">
              <div>
                <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">
                  Batch Name
                </dt>
                <dd className="text-body mt-1 text-text-primary">{batch.name}</dd>
              </div>
              <div>
                <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">
                  Short Code
                </dt>
                <dd className="text-body mt-1 text-text-primary">{batch.code}</dd>
              </div>
              <div>
                <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">
                  Category
                </dt>
                <dd className="text-body mt-1 text-text-primary">{batch.category || "—"}</dd>
              </div>
              <div>
                <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">
                  Description
                </dt>
                <dd className="text-body mt-1 text-text-primary">{batch.description || "—"}</dd>
              </div>
              <div>
                <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">
                  Status
                </dt>
                <dd className="text-body mt-1 text-text-primary">
                  {batch.status === "active" ? "Active" : "Inactive"}
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-card border border-border bg-surface p-6 shadow-xs">
            <h2 className="text-section-title font-semibold text-text-primary">Students</h2>
            <p className="text-body mt-2 text-text-secondary">
              Not available yet — student enrollment is part of a later phase.
            </p>
          </div>
        </div>

        <div className="rounded-card border border-border bg-surface p-6 shadow-xs">
          <div className="flex items-center justify-between">
            <h2 className="text-section-title font-semibold text-text-primary">Schedules</h2>
            <Button
              size="sm"
              render={<Link href={`/schedule/new?batch=${batch.id}`} />}
              nativeButton={false}
            >
              <Plus className="size-4" aria-hidden="true" />
              Add Schedule
            </Button>
          </div>

          {activeSchedules.length === 0 ? (
            <p className="text-body mt-4 text-text-secondary">
              No active schedules yet. Add one to define when this batch takes place.
            </p>
          ) : (
            <>
              <p className="text-small mt-2 text-text-secondary">
                {activeSchedules.length} Active Schedule{activeSchedules.length === 1 ? "" : "s"}
              </p>
              <ul className="mt-3 flex flex-col gap-3">
                {activeSchedules.slice(0, 5).map((schedule) => (
                  <li key={schedule.id} className="flex flex-wrap items-baseline justify-between gap-2 text-body">
                    <span className="text-text-primary">{DAY_LABELS[schedule.day_of_week] ?? schedule.day_of_week}</span>
                    <span className="text-text-secondary">
                      {formatTime(schedule.start_time)} – {formatTime(schedule.end_time)}
                    </span>
                    <span className="text-text-secondary">{schedule.instructors?.full_name ?? "—"}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          <Link
            href={`/batches/${batch.id}/schedules`}
            className="text-body mt-4 inline-block font-medium text-brand hover:underline"
          >
            View Schedules
          </Link>
        </div>
      </div>
    </div>
  );
}
