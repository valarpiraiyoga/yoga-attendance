import { notFound } from "next/navigation";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { listBatchOptions, getBatch } from "@/lib/batches/data";
import { listInstructorOptions } from "@/lib/instructors/data";
import { createSchedule } from "@/lib/schedules/actions";
import ScheduleForm from "@/app/schedule/schedule-form";
import PageHeader from "@/components/layout/PageHeader";

/**
 * Add Schedule (02-ux.md Flow 03: "... Schedules → Add Schedule → Select
 * Day → Start Time → End Time automatically +1 hour → Edit End Time if
 * needed → Select Instructor → Effective From → Save → Schedule Active").
 * Saves directly — no Review/Confirm step, unlike Edit and Deactivate.
 *
 * One route serves both entry points, matching every other multi-entry-
 * point flow in this project (app/memberships/new/page.js): with `?batch=`,
 * the batch is fixed context (Batch Details' "+ Add Schedule"); without it,
 * a Batch Select renders (standalone Schedule list's "+ Add Schedule").
 */
export default async function NewSchedulePage({ searchParams }) {
  // Authorization boundary — see app/schedule/layout.js for why this must be
  // repeated here rather than relying on the layout alone. createSchedule
  // also calls requireRole itself before writing anything.
  await requireRole(ROLES.ADMIN);

  const rawParams = await searchParams;
  const batchId = typeof rawParams?.batch === "string" ? rawParams.batch : "";

  const [batch, batchOptions, instructorOptions] = await Promise.all([
    batchId ? getBatch(batchId) : Promise.resolve(null),
    batchId ? Promise.resolve([]) : listBatchOptions(),
    listInstructorOptions(),
  ]);

  if (batchId && !batch) {
    notFound();
  }

  const cancelHref = batch ? `/batches/${batch.id}/schedules` : "/schedule";

  return (
    <>
      <PageHeader
        compact
        back={{ href: cancelHref, label: batch ? "Back to Batch Schedules" : "Back to Schedule" }}
        title="Add Schedule"
        description={<>{batch ? `Add a recurring schedule for ${batch.name}.` : "Add a recurring weekly schedule."}</>}
      />
      <div className="mx-auto w-full max-w-3xl">
        <div className="rounded-card border border-border bg-surface p-6 shadow-xs">
          <ScheduleForm
            action={createSchedule}
            batch={batch ?? undefined}
            batchOptions={batchOptions}
            instructorOptions={instructorOptions}
            requireConfirmation={false}
            submitLabel="Save Schedule"
            pendingLabel="Saving…"
            cancelHref={cancelHref}
          />
        </div>
      </div>
    </>
  );
}
