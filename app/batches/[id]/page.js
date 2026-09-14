import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Calendar,
  Clock,
  FileText,
  Layers,
  Plus,
  Tag,
  UserRound,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getBatch } from "@/lib/batches/data";
import { listSchedulesForBatch } from "@/lib/schedules/data";
import { listEnrollmentsForBatch } from "@/lib/enrollments/data";
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

function getInitials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0].toUpperCase();

  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function Panel({ title, icon: Icon, action, children }) {
  return (
    <section className="rounded-card border border-border bg-surface p-4 shadow-xs sm:p-5">
      {(title || action) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title ? (
            <h2 className="flex items-center gap-2 text-body font-semibold text-text-primary">
              {Icon ? <Icon className="size-4 text-text-secondary" aria-hidden="true" /> : null}
              {title}
            </h2>
          ) : (
            <span />
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

function FieldRow({ icon: Icon, label, children }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <Icon className="size-3.5 shrink-0 text-text-secondary" aria-hidden="true" />
        <p className="text-small text-text-secondary">{label}</p>
      </div>
      <div className="mt-1">{children}</div>
    </div>
  );
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
 * The wireframe's Overview tab also shows a "Students" summary panel — real
 * as of Phase 15A, now that the Students tab itself is (see
 * app/batches/[id]/students/page.js), mirroring the Schedules panel's own
 * established shape: a count plus a "View Students" link, not the full list.
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

  const [schedules, enrollments] = await Promise.all([listSchedulesForBatch(id), listEnrollmentsForBatch(id)]);
  const activeSchedules = schedules.filter((schedule) => schedule.status === "active");
  const activeEnrollments = enrollments.filter((enrollment) => enrollment.status === "active");

  const rawParams = await searchParams;
  const message = SUCCESS_MESSAGES[rawParams?.success] ?? null;
  const isActive = batch.status === "active";

  return (
    <BatchHeader
      batch={batch}
      active="overview"
      metrics={{
        studentCount: activeEnrollments.length,
        scheduleCount: activeSchedules.length,
      }}
    >
      <div className="flex flex-col gap-4">
        {message ? (
          <div
            role="status"
            className="rounded-input border border-success/30 bg-success/5 px-3 py-2 text-body text-success"
          >
            {message}
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-4">
            <Panel title="Batch Information" icon={Layers}>
              <div className="overflow-hidden rounded-xl border border-warning/20 bg-warning/5">
                <div className="flex items-start gap-3 bg-warning/10 px-3.5 py-3.5">
                  <span
                    aria-hidden="true"
                    className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-warning/15 text-small font-semibold text-warning"
                  >
                    {batch.code || "—"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-body font-semibold text-text-primary">{batch.name}</p>
                      <Badge variant={isActive ? "success" : "danger"} className="px-1.5 py-0">
                        <span className="text-[10px] leading-[14px] font-medium">
                          {isActive ? "Active" : "Inactive"}
                        </span>
                      </Badge>
                    </div>
                    <p className="text-small mt-1 text-text-secondary">Code: {batch.code}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 border-t border-warning/15 px-3.5 py-3">
                  <FieldRow icon={Tag} label="Category">
                    <p className="truncate text-body font-semibold text-text-primary">
                      {batch.category || "—"}
                    </p>
                  </FieldRow>
                  <FieldRow icon={UserRound} label="Status">
                    <p className="truncate text-body font-semibold text-text-primary">
                      {isActive ? "Active" : "Inactive"}
                    </p>
                  </FieldRow>
                </div>

                <div className="border-t border-warning/15 px-3.5 py-2.5">
                  <div className="flex items-center gap-1.5 text-small text-text-secondary">
                    <FileText className="size-3.5 shrink-0" aria-hidden="true" />
                    Description
                  </div>
                  <p className="mt-1 text-body text-text-primary">{batch.description || "—"}</p>
                </div>
              </div>
            </Panel>

            <Panel
              title="Students"
              icon={Users}
              action={
                <Link
                  href={`/batches/${batch.id}/students`}
                  className="text-small font-medium text-brand hover:underline"
                >
                  View Students
                </Link>
              }
            >
              {activeEnrollments.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-background/40 px-4 py-8 text-center">
                  <span
                    aria-hidden="true"
                    className="flex size-10 items-center justify-center rounded-full bg-border/50 text-text-secondary"
                  >
                    <Users className="size-4" />
                  </span>
                  <p className="text-body font-medium text-text-primary">No students enrolled</p>
                  <p className="text-small max-w-sm text-text-secondary">
                    No students are enrolled in this batch yet.
                  </p>
                </div>
              ) : (
                <div className="overflow-hidden rounded-xl border border-info/15 bg-info/5">
                  <div className="bg-info/10 px-3.5 py-3.5">
                    <p className="text-body font-semibold text-text-primary">
                      {activeEnrollments.length} Active Enrollment
                      {activeEnrollments.length === 1 ? "" : "s"}
                    </p>
                    <p className="text-small mt-1 text-text-secondary">
                      Open the Students tab for the full roster and schedule assignments.
                    </p>
                  </div>
                </div>
              )}
            </Panel>
          </div>

          <div className="flex flex-col gap-4">
            <Panel
              title="Schedules"
              icon={Calendar}
              action={
                <Button
                  size="sm"
                  variant="outline"
                  render={<Link href={`/schedule/new?batch=${batch.id}`} />}
                  nativeButton={false}
                >
                  <Plus className="size-4" aria-hidden="true" />
                  Add Schedule
                </Button>
              }
            >
              {activeSchedules.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-background/40 px-4 py-8 text-center">
                  <span
                    aria-hidden="true"
                    className="flex size-10 items-center justify-center rounded-full bg-border/50 text-text-secondary"
                  >
                    <Calendar className="size-4" />
                  </span>
                  <p className="text-body font-medium text-text-primary">No active schedules</p>
                  <p className="text-small max-w-sm text-text-secondary">
                    Add one to define when this batch takes place.
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                  {activeSchedules.slice(0, 5).map((schedule) => {
                    const instructorName = schedule.instructors?.full_name ?? null;

                    return (
                      <li
                        key={schedule.id}
                        className="flex flex-col gap-2 bg-surface px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-body font-semibold text-text-primary">
                            {DAY_LABELS[schedule.day_of_week] ?? schedule.day_of_week}
                          </p>
                          <p className="text-small mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-text-secondary">
                            <span className="inline-flex items-center gap-1">
                              <Clock className="size-3.5 shrink-0" aria-hidden="true" />
                              {formatTime(schedule.start_time)} – {formatTime(schedule.end_time)}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="inline-flex min-w-0 items-center gap-1.5">
                              <span
                                aria-hidden="true"
                                className="flex size-5 shrink-0 items-center justify-center rounded-full bg-border/60 text-[10px] font-semibold leading-none text-text-secondary"
                              >
                                {instructorName ? getInitials(instructorName) : "?"}
                              </span>
                              <span className="truncate">{instructorName || "—"}</span>
                            </span>
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              <div className="mt-3 flex justify-end">
                <Link
                  href={`/batches/${batch.id}/schedules`}
                  className="text-small font-medium text-brand hover:underline"
                >
                  View Schedules
                </Link>
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </BatchHeader>
  );
}
