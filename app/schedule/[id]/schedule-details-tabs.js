"use client";

import { useState } from "react";
import { ArrowRight, Calendar, CalendarDays, Clock, Layers, RefreshCw, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/ui/avatar";
import EmptyState from "@/components/ui/empty-state";
import Tabs from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import FieldRow from "@/components/layout/FieldRow";
import { Panel, PanelHeader } from "@/components/layout/Panel";
import { formatDate, formatDateWithWeekday, formatDuration, formatTime, formatTimeRange } from "@/lib/format";
import { ENTITY_STATUS } from "@/lib/status";
import { DAY_LABELS } from "@/lib/schedules/validation";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "recurring-pattern", label: "Recurring Pattern" },
  { key: "upcoming-sessions", label: "Upcoming Sessions" },
];

// Same heading treatment as Batch Details' overview panels.
const PANEL_HEADER_CLASS = "mb-4 min-h-8 flex-col items-start sm:flex-row sm:items-center";
const PANEL_LINK_CLASS = "text-brand hover:bg-brand/10 hover:text-brand";
const NO_UPCOMING_DESCRIPTION = "This schedule is inactive or its effective period has ended.";

function FieldValue({ children }) {
  return <p className="text-body font-medium break-words text-text-primary">{children}</p>;
}

/** Date + time rows of the read-only upcoming-sessions projection. */
function UpcomingTable({ sessions, batchName, instructorName, detailed = false }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <Table aria-label="Upcoming sessions">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Date</TableHead>
            <TableHead>Time</TableHead>
            {detailed ? <TableHead>Batch</TableHead> : null}
            {detailed ? <TableHead>Instructor</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.map((session) => (
            <TableRow key={session.date}>
              <TableCell className="font-medium whitespace-nowrap text-text-primary">
                {formatDateWithWeekday(session.date)}
              </TableCell>
              <TableCell className="whitespace-nowrap text-text-secondary">
                {formatTimeRange(session.start_time, session.end_time)}
              </TableCell>
              {detailed ? <TableCell className="whitespace-nowrap text-text-secondary">{batchName}</TableCell> : null}
              {detailed ? (
                <TableCell>
                  <span className="inline-flex items-center gap-2 whitespace-nowrap">
                    <Avatar name={instructorName === "—" ? "" : instructorName} size="sm" />
                    <span className="text-text-secondary">{instructorName}</span>
                  </span>
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
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
 * Details, whose tabs are routes, none of these has its own data or page.
 *
 * The tabs are the canonical underline `Tabs`, and the panels are the same
 * `Panel` / `PanelHeader` / `FieldRow` Batch Details uses.
 *
 * Upcoming Sessions has no Session Status or Action column: each row is a
 * computed projection, not a real class_sessions row (04-development-plan.md's
 * Phase 13 definition — no persistence, nothing to link a status or a
 * details page to), so there is no Eye + ⋮ action to offer. That is a
 * deliberate, documented reduction from the wireframe's session-list
 * columns, not an oversight.
 */
export default function ScheduleDetailsTabs({ schedule, upcomingSessions }) {
  const [activeTab, setActiveTab] = useState("overview");
  const status = ENTITY_STATUS[schedule.status] ?? ENTITY_STATUS.inactive;
  const dayLabel = DAY_LABELS[schedule.day_of_week] ?? schedule.day_of_week;
  const timeLabel = formatTimeRange(schedule.start_time, schedule.end_time);
  const batchName = schedule.batches?.name ?? "—";
  const batchCode = schedule.batches?.code ?? null;
  const instructorName = schedule.instructors?.full_name ?? "—";
  const durationLabel = formatDuration(schedule.start_time, schedule.end_time);
  const effectiveUntil = schedule.effective_until ? formatDate(schedule.effective_until) : "Open-ended";

  return (
    <Tabs items={TABS} active={activeTab} onChange={setActiveTab} ariaLabel="Schedule sections">
      <div className="mt-6">
        {activeTab === "overview" ? (
          <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
            <div className="flex min-w-0 flex-col gap-6">
              <Panel>
                <PanelHeader icon={Calendar} title="Schedule Information" className="mb-4 min-h-8" />
                <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                  <FieldRow icon={Layers} label="Batch">
                    <FieldValue>{batchName}</FieldValue>
                    {batchCode ? <p className="text-small text-text-secondary">Code: {batchCode}</p> : null}
                  </FieldRow>
                  <FieldRow icon={Layers} label="Status">
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </FieldRow>
                  <FieldRow icon={CalendarDays} label="Day">
                    <FieldValue>{dayLabel}</FieldValue>
                  </FieldRow>
                  <FieldRow icon={Clock} label="Time">
                    <FieldValue>{timeLabel}</FieldValue>
                  </FieldRow>
                  <FieldRow icon={UserRound} label="Instructor">
                    <FieldValue>{instructorName}</FieldValue>
                  </FieldRow>
                  <FieldRow icon={Calendar} label="Effective From">
                    <FieldValue>{formatDate(schedule.effective_from)}</FieldValue>
                  </FieldRow>
                  <FieldRow icon={Calendar} label="Effective Until">
                    <FieldValue>{effectiveUntil}</FieldValue>
                  </FieldRow>
                </div>
              </Panel>
            </div>

            <div className="flex min-w-0 flex-col gap-6">
              <Panel>
                <PanelHeader
                  icon={RefreshCw}
                  title="Recurring Pattern"
                  className={PANEL_HEADER_CLASS}
                  action={
                    <Button size="sm" variant="ghost" className={PANEL_LINK_CLASS} onClick={() => setActiveTab("recurring-pattern")}>
                      View Recurring Pattern
                      <ArrowRight className="size-4" aria-hidden="true" />
                    </Button>
                  }
                />
                <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                  <FieldRow icon={RefreshCw} label="Frequency">
                    <FieldValue>Weekly</FieldValue>
                  </FieldRow>
                  <FieldRow icon={Clock} label="Duration">
                    <FieldValue>{durationLabel}</FieldValue>
                  </FieldRow>
                  <FieldRow icon={CalendarDays} label="Occurs" className="sm:col-span-2">
                    <FieldValue>
                      Every {dayLabel}, {timeLabel}
                    </FieldValue>
                  </FieldRow>
                </div>
              </Panel>

              <Panel>
                <PanelHeader
                  icon={Calendar}
                  title="Upcoming Sessions"
                  className={PANEL_HEADER_CLASS}
                  action={
                    upcomingSessions.length > 0 ? (
                      <Button size="sm" variant="ghost" className={PANEL_LINK_CLASS} onClick={() => setActiveTab("upcoming-sessions")}>
                        View All Sessions
                        <ArrowRight className="size-4" aria-hidden="true" />
                      </Button>
                    ) : null
                  }
                />
                {upcomingSessions.length === 0 ? (
                  <EmptyState size="sm" title="No upcoming sessions" description={NO_UPCOMING_DESCRIPTION} />
                ) : (
                  <UpcomingTable sessions={upcomingSessions.slice(0, 3)} />
                )}
              </Panel>
            </div>
          </div>
        ) : null}

        {activeTab === "recurring-pattern" ? (
          <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
            <Panel className="min-w-0">
              <PanelHeader icon={RefreshCw} title="Recurring Pattern" className="mb-4 min-h-8" />
              <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                <FieldRow icon={Layers} label="Batch">
                  <FieldValue>{batchName}</FieldValue>
                </FieldRow>
                <FieldRow icon={RefreshCw} label="Frequency">
                  <FieldValue>Weekly</FieldValue>
                </FieldRow>
                <FieldRow icon={CalendarDays} label="Day">
                  <FieldValue>{dayLabel}</FieldValue>
                </FieldRow>
                <FieldRow icon={Clock} label="Duration">
                  <FieldValue>{durationLabel}</FieldValue>
                </FieldRow>
                <FieldRow icon={Clock} label="Start Time">
                  <FieldValue>{formatTime(schedule.start_time)}</FieldValue>
                </FieldRow>
                <FieldRow icon={Clock} label="End Time">
                  <FieldValue>{formatTime(schedule.end_time)}</FieldValue>
                </FieldRow>
                <FieldRow icon={UserRound} label="Instructor">
                  <FieldValue>{instructorName}</FieldValue>
                </FieldRow>
                <FieldRow icon={Layers} label="Status">
                  <Badge variant={status.variant}>{status.label}</Badge>
                </FieldRow>
              </div>
            </Panel>

            <Panel className="min-w-0">
              <PanelHeader icon={Calendar} title="Effective Period" className="mb-4 min-h-8" />
              <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                <FieldRow icon={Calendar} label="Effective From">
                  <FieldValue>{formatDate(schedule.effective_from)}</FieldValue>
                </FieldRow>
                <FieldRow icon={Calendar} label="Effective Until">
                  <FieldValue>{effectiveUntil}</FieldValue>
                </FieldRow>
              </div>
              <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
                <p className="text-small text-text-secondary">
                  This recurring schedule applies to future sessions within the effective period.
                </p>
                <p className="text-small text-text-secondary">
                  This recurring pattern determines the batch&rsquo;s class sessions once Attendance is
                  available. Changes to it affect future sessions only — past sessions and attendance
                  remain unchanged.
                </p>
              </div>
            </Panel>
          </div>
        ) : null}

        {activeTab === "upcoming-sessions" ? (
          <Panel>
            <PanelHeader
              icon={Calendar}
              title="Upcoming Sessions"
              description="Future class sessions computed from this recurring schedule."
              className="mb-4 min-h-8"
            />
            {upcomingSessions.length === 0 ? (
              <EmptyState size="sm" title="No upcoming sessions" description={NO_UPCOMING_DESCRIPTION} />
            ) : (
              <>
                <UpcomingTable sessions={upcomingSessions} batchName={batchName} instructorName={instructorName} detailed />
                <p className="text-small mt-3 text-text-secondary">
                  Showing {upcomingSessions.length} upcoming session
                  {upcomingSessions.length === 1 ? "" : "s"}.
                </p>
              </>
            )}
          </Panel>
        ) : null}
      </div>
    </Tabs>
  );
}
