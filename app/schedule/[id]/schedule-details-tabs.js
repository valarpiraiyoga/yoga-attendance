"use client";

import { useState } from "react";
import {
  Calendar,
  Clock,
  Layers,
  RefreshCw,
  UserRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import DataTableShell from "@/components/ui/data-table-shell";
import { DAY_LABELS, timeToMinutes } from "@/lib/schedules/validation";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "recurring-pattern", label: "Recurring Pattern" },
  { key: "upcoming-sessions", label: "Upcoming Sessions" },
];

function formatTime(value) {
  if (!value) return "—";
  const [hours, minutes] = value.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${period}`;
}

function formatDate(value) {
  if (!value) return "—";
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatDuration(startTime, endTime) {
  if (!startTime || !endTime) return "—";
  const minutes = timeToMinutes(endTime) - timeToMinutes(startTime);
  if (!Number.isFinite(minutes) || minutes <= 0) return "—";
  if (minutes === 1) return "1 minute";
  return `${minutes} minutes`;
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
 * Schedule Details' three tabs (approved wireframe: Overview / Recurring
 * Pattern / Upcoming Sessions — both Overview and Recurring Pattern are
 * kept even though they repeat several fields, per the approved Phase 13
 * decision). All three tabs share one already-fetched `schedule` and
 * `upcomingSessions` projection, so this toggles visibility client-side
 * with local state rather than three separate routes — unlike Batch
 * Details, no tab here is permanently disabled, so there is no case for
 * real navigation between them.
 *
 * Folder-tab chrome matches Batch Detail exactly (`folder-tabs-track` /
 * `folder-tab-active`); only the control element is a button instead of a
 * Link because these tabs stay URL-local.
 *
 * Upcoming Sessions has no Session Status or Action column: each row is a
 * computed projection, not a real class_sessions row (04-development-plan.md's
 * Phase 13 definition — no persistence, nothing to link a status or a
 * details page to). That is a deliberate, documented reduction from the
 * wireframe's session-list columns, not an oversight.
 */
export default function ScheduleDetailsTabs({ schedule, upcomingSessions }) {
  const [activeTab, setActiveTab] = useState("overview");
  const isActive = schedule.status === "active";
  const dayLabel = DAY_LABELS[schedule.day_of_week] ?? schedule.day_of_week;
  const batchName = schedule.batches?.name ?? "—";
  const batchCode = schedule.batches?.code ?? null;
  const instructorName = schedule.instructors?.full_name ?? "—";
  const durationLabel = formatDuration(schedule.start_time, schedule.end_time);

  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-surface shadow-xs">
      <nav aria-label="Schedule sections" className="folder-tabs-track px-3 pt-1.5">
        <ul className="flex flex-wrap items-end gap-0.5">
          {TABS.map((tab) => {
            const isTabActive = activeTab === tab.key;
            return (
              <li key={tab.key}>
                <button
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
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
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="bg-surface px-4 pt-4 pb-4 sm:px-5 sm:pb-5">
        {activeTab === "overview" ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="flex flex-col gap-4">
              <Panel title="Schedule Information" icon={Calendar}>
                <div className="overflow-hidden rounded-xl border border-info/20 bg-info/5">
                  <div className="flex items-start gap-3 bg-info/10 px-3.5 py-3.5">
                    <span
                      aria-hidden="true"
                      className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-info/15 text-small font-semibold text-info"
                    >
                      {batchCode || "—"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-body font-semibold text-text-primary">{batchName}</p>
                        <Badge variant={isActive ? "success" : "danger"} className="px-1.5 py-0">
                          <span className="text-[10px] leading-[14px] font-medium">
                            {isActive ? "Active" : "Inactive"}
                          </span>
                        </Badge>
                      </div>
                      <p className="text-small mt-1 text-text-secondary">
                        {batchCode ? `Code: ${batchCode}` : "Batch"}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 border-t border-info/15 px-3.5 py-3">
                    <FieldRow icon={Calendar} label="Day">
                      <p className="truncate text-body font-semibold text-text-primary">{dayLabel}</p>
                    </FieldRow>
                    <FieldRow icon={Clock} label="Time">
                      <p className="truncate text-body font-semibold text-text-primary">
                        {formatTime(schedule.start_time)} – {formatTime(schedule.end_time)}
                      </p>
                    </FieldRow>
                    <FieldRow icon={UserRound} label="Instructor">
                      <p className="truncate text-body font-semibold text-text-primary">{instructorName}</p>
                    </FieldRow>
                    <FieldRow icon={Layers} label="Status">
                      <p className="truncate text-body font-semibold text-text-primary">
                        {isActive ? "Active" : "Inactive"}
                      </p>
                    </FieldRow>
                  </div>

                  <div className="grid grid-cols-2 gap-3 border-t border-info/15 px-3.5 py-3">
                    <FieldRow icon={Calendar} label="Effective From">
                      <p className="truncate text-body font-semibold text-text-primary">
                        {formatDate(schedule.effective_from)}
                      </p>
                    </FieldRow>
                    <FieldRow icon={Calendar} label="Effective Until">
                      <p className="truncate text-body font-semibold text-text-primary">
                        {schedule.effective_until ? formatDate(schedule.effective_until) : "Open-ended"}
                      </p>
                    </FieldRow>
                  </div>
                </div>
              </Panel>
            </div>

            <div className="flex flex-col gap-4">
              <Panel
                title="Recurring Pattern"
                icon={RefreshCw}
                action={
                  <button
                    type="button"
                    onClick={() => setActiveTab("recurring-pattern")}
                    className="text-small font-medium text-brand hover:underline"
                  >
                    View Recurring Pattern
                  </button>
                }
              >
                <div className="overflow-hidden rounded-xl border border-brand/15 bg-brand/5">
                  <div className="bg-brand/10 px-3.5 py-3.5">
                    <p className="text-body font-semibold text-text-primary">Weekly</p>
                    <p className="text-small mt-1 text-text-secondary">
                      Every {dayLabel}, {formatTime(schedule.start_time)} –{" "}
                      {formatTime(schedule.end_time)}
                    </p>
                    <p className="text-small mt-1 text-text-secondary">Duration: {durationLabel}</p>
                  </div>
                </div>
              </Panel>

              <Panel
                title="Upcoming Sessions"
                icon={Calendar}
                action={
                  upcomingSessions.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setActiveTab("upcoming-sessions")}
                      className="text-small font-medium text-brand hover:underline"
                    >
                      View All Sessions
                    </button>
                  ) : null
                }
              >
                {upcomingSessions.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-background/40 px-4 py-8 text-center">
                    <span
                      aria-hidden="true"
                      className="flex size-10 items-center justify-center rounded-full bg-border/50 text-text-secondary"
                    >
                      <Calendar className="size-4" />
                    </span>
                    <p className="text-body font-medium text-text-primary">No upcoming sessions</p>
                    <p className="text-small max-w-sm text-text-secondary">
                      This schedule is inactive or its effective period has ended.
                    </p>
                  </div>
                ) : (
                  <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                    {upcomingSessions.slice(0, 3).map((session) => (
                      <li key={session.date} className="bg-surface px-3.5 py-3">
                        <p className="text-body font-semibold text-text-primary">{formatDate(session.date)}</p>
                        <p className="text-small mt-1 text-text-secondary">
                          {formatTime(session.start_time)} – {formatTime(session.end_time)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>
          </div>
        ) : null}

        {activeTab === "recurring-pattern" ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Recurring Pattern" icon={RefreshCw}>
              <div className="overflow-hidden rounded-xl border border-brand/20 bg-brand/5">
                <div className="grid grid-cols-2 gap-3 px-3.5 py-3.5">
                  <FieldRow icon={Layers} label="Batch">
                    <p className="truncate text-body font-semibold text-text-primary">{batchName}</p>
                  </FieldRow>
                  <FieldRow icon={RefreshCw} label="Frequency">
                    <p className="truncate text-body font-semibold text-text-primary">Weekly</p>
                  </FieldRow>
                  <FieldRow icon={Calendar} label="Day">
                    <p className="truncate text-body font-semibold text-text-primary">{dayLabel}</p>
                  </FieldRow>
                  <FieldRow icon={Clock} label="Duration">
                    <p className="truncate text-body font-semibold text-text-primary">{durationLabel}</p>
                  </FieldRow>
                  <FieldRow icon={Clock} label="Start Time">
                    <p className="truncate text-body font-semibold text-text-primary">
                      {formatTime(schedule.start_time)}
                    </p>
                  </FieldRow>
                  <FieldRow icon={Clock} label="End Time">
                    <p className="truncate text-body font-semibold text-text-primary">
                      {formatTime(schedule.end_time)}
                    </p>
                  </FieldRow>
                  <FieldRow icon={UserRound} label="Instructor">
                    <p className="truncate text-body font-semibold text-text-primary">{instructorName}</p>
                  </FieldRow>
                  <FieldRow icon={Layers} label="Status">
                    <Badge variant={isActive ? "success" : "danger"} className="rounded-full px-2 py-0">
                      <span className="text-[10px] leading-[14px] font-medium">
                        {isActive ? "Active" : "Inactive"}
                      </span>
                    </Badge>
                  </FieldRow>
                </div>
              </div>
            </Panel>

            <Panel title="Effective Period" icon={Calendar}>
              <div className="overflow-hidden rounded-xl border border-info/20 bg-info/5">
                <div className="grid grid-cols-2 gap-3 border-b border-info/15 px-3.5 py-3.5">
                  <FieldRow icon={Calendar} label="Effective From">
                    <p className="truncate text-body font-semibold text-text-primary">
                      {formatDate(schedule.effective_from)}
                    </p>
                  </FieldRow>
                  <FieldRow icon={Calendar} label="Effective Until">
                    <p className="truncate text-body font-semibold text-text-primary">
                      {schedule.effective_until ? formatDate(schedule.effective_until) : "Open-ended"}
                    </p>
                  </FieldRow>
                </div>
                <div className="space-y-2 px-3.5 py-3.5">
                  <p className="text-small text-text-secondary">
                    This recurring schedule applies to future sessions within the effective period.
                  </p>
                  <p className="text-small text-text-secondary">
                    This recurring pattern determines the batch&rsquo;s class sessions once Attendance is
                    available. Changes to it affect future sessions only — past sessions and attendance
                    remain unchanged.
                  </p>
                </div>
              </div>
            </Panel>
          </div>
        ) : null}

        {activeTab === "upcoming-sessions" ? (
          <Panel title="Upcoming Sessions" icon={Calendar}>
            <p className="text-small mb-4 text-text-secondary">
              Future class sessions computed from this recurring schedule.
            </p>

            {upcomingSessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-background/40 px-4 py-10 text-center">
                <span
                  aria-hidden="true"
                  className="flex size-10 items-center justify-center rounded-full bg-border/50 text-text-secondary"
                >
                  <Calendar className="size-4" />
                </span>
                <p className="text-body font-medium text-text-primary">No upcoming sessions</p>
                <p className="text-small max-w-sm text-text-secondary">
                  This schedule is inactive or its effective period has ended.
                </p>
              </div>
            ) : (
              <>
                <DataTableShell tone="info">
                  <Table aria-label="Upcoming sessions">
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Date</TableHead>
                        <TableHead>Time</TableHead>
                        <TableHead>Batch</TableHead>
                        <TableHead>Instructor</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {upcomingSessions.map((session) => (
                        <TableRow key={session.date}>
                          <TableCell className="font-medium text-text-primary">
                            {formatDate(session.date)}
                          </TableCell>
                          <TableCell className="text-text-secondary">
                            {formatTime(session.start_time)} – {formatTime(session.end_time)}
                          </TableCell>
                          <TableCell className="text-text-secondary">{batchName}</TableCell>
                          <TableCell>
                            <span className="inline-flex min-w-0 items-center gap-2">
                              <span
                                aria-hidden="true"
                                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand/10 text-[10px] font-semibold leading-none text-brand"
                              >
                                {schedule.instructors?.full_name
                                  ? getInitials(schedule.instructors.full_name)
                                  : "?"}
                              </span>
                              <span className="truncate text-text-secondary">{instructorName}</span>
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </DataTableShell>
                <p className="text-small mt-3 text-text-secondary">
                  Showing {upcomingSessions.length} upcoming session
                  {upcomingSessions.length === 1 ? "" : "s"}.
                </p>
              </>
            )}
          </Panel>
        ) : null}
      </div>
    </div>
  );
}
