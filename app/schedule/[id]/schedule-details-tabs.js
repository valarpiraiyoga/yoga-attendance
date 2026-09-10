"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { DAY_LABELS } from "@/lib/schedules/validation";

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
 * Upcoming Sessions has no Session Status or Action column: each row is a
 * computed projection, not a real class_sessions row (04-development-plan.md's
 * Phase 13 definition — no persistence, nothing to link a status or a
 * details page to). That is a deliberate, documented reduction from the
 * wireframe's session-list columns, not an oversight.
 */
export default function ScheduleDetailsTabs({ schedule, upcomingSessions }) {
  const [activeTab, setActiveTab] = useState("overview");

  return (
    <div>
      <nav aria-label="Schedule sections" className="mb-6 border-b border-border">
        <ul className="flex gap-6">
          {TABS.map((tab) => (
            <li key={tab.key}>
              <button
                type="button"
                onClick={() => setActiveTab(tab.key)}
                aria-current={activeTab === tab.key ? "page" : undefined}
                className={
                  activeTab === tab.key
                    ? "inline-flex border-b-2 border-brand px-0.5 pb-3 text-body font-semibold text-text-primary"
                    : "inline-flex border-b-2 border-transparent px-0.5 pb-3 text-body text-text-secondary hover:text-text-primary"
                }
              >
                {tab.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {activeTab === "overview" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="flex flex-col gap-6">
            <div className="rounded-card border border-border bg-surface p-6 shadow-xs">
              <h2 className="text-section-title font-semibold text-text-primary">Schedule Information</h2>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4">
                <div>
                  <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">Batch</dt>
                  <dd className="text-body text-text-primary">{schedule.batches?.name ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">Instructor</dt>
                  <dd className="text-body text-text-primary">{schedule.instructors?.full_name ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">Day</dt>
                  <dd className="text-body text-text-primary">{DAY_LABELS[schedule.day_of_week] ?? schedule.day_of_week}</dd>
                </div>
                <div>
                  <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">Time</dt>
                  <dd className="text-body text-text-primary">
                    {formatTime(schedule.start_time)} – {formatTime(schedule.end_time)}
                  </dd>
                </div>
                <div>
                  <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">
                    Effective From
                  </dt>
                  <dd className="text-body text-text-primary">{formatDate(schedule.effective_from)}</dd>
                </div>
                <div>
                  <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">
                    Effective Until
                  </dt>
                  <dd className="text-body text-text-primary">
                    {schedule.effective_until ? formatDate(schedule.effective_until) : "Open-ended"}
                  </dd>
                </div>
              </dl>
            </div>
          </div>

          <div className="flex flex-col gap-6">
            <div className="rounded-card border border-border bg-surface p-6 shadow-xs">
              <h2 className="text-section-title font-semibold text-text-primary">Recurring Pattern</h2>
              <p className="text-body mt-2 text-text-primary">Weekly</p>
              <p className="text-body text-text-secondary">
                Every {DAY_LABELS[schedule.day_of_week] ?? schedule.day_of_week}, {formatTime(schedule.start_time)} –{" "}
                {formatTime(schedule.end_time)}
              </p>
              <p className="text-small mt-1 text-text-secondary">Duration: 60 minutes</p>
              <button
                type="button"
                onClick={() => setActiveTab("recurring-pattern")}
                className="text-body mt-3 inline-block font-medium text-brand hover:underline"
              >
                View Recurring Pattern
              </button>
            </div>

            <div className="rounded-card border border-border bg-surface p-6 shadow-xs">
              <h2 className="text-section-title font-semibold text-text-primary">Upcoming Sessions</h2>
              {upcomingSessions.length === 0 ? (
                <p className="text-body mt-2 text-text-secondary">
                  No upcoming sessions — this schedule is inactive or its effective period has ended.
                </p>
              ) : (
                <ul className="mt-3 flex flex-col gap-3">
                  {upcomingSessions.slice(0, 3).map((session) => (
                    <li key={session.date} className="text-body text-text-primary">
                      {formatDate(session.date)}
                      <span className="block text-small text-text-secondary">
                        {formatTime(session.start_time)} – {formatTime(session.end_time)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {upcomingSessions.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setActiveTab("upcoming-sessions")}
                  className="text-body mt-3 inline-block font-medium text-brand hover:underline"
                >
                  View All Sessions
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "recurring-pattern" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-card border border-border bg-surface p-6 shadow-xs">
            <h2 className="text-section-title font-semibold text-text-primary">Recurring Pattern</h2>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4">
              <div>
                <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">Batch</dt>
                <dd className="text-body text-text-primary">{schedule.batches?.name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">Frequency</dt>
                <dd className="text-body text-text-primary">Weekly</dd>
              </div>
              <div>
                <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">Day</dt>
                <dd className="text-body text-text-primary">{DAY_LABELS[schedule.day_of_week] ?? schedule.day_of_week}</dd>
              </div>
              <div>
                <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">Duration</dt>
                <dd className="text-body text-text-primary">60 minutes</dd>
              </div>
              <div>
                <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">Start Time</dt>
                <dd className="text-body text-text-primary">{formatTime(schedule.start_time)}</dd>
              </div>
              <div>
                <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">End Time</dt>
                <dd className="text-body text-text-primary">{formatTime(schedule.end_time)}</dd>
              </div>
              <div>
                <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">Instructor</dt>
                <dd className="text-body text-text-primary">{schedule.instructors?.full_name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">Status</dt>
                <dd className="text-body text-text-primary">
                  <Badge variant={schedule.status === "active" ? "success" : "danger"}>
                    {schedule.status === "active" ? "Active" : "Inactive"}
                  </Badge>
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-card border border-border bg-surface p-6 shadow-xs">
            <h2 className="text-section-title font-semibold text-text-primary">Effective Period</h2>
            <dl className="mt-4 flex flex-col gap-4">
              <div>
                <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">
                  Effective From
                </dt>
                <dd className="text-body text-text-primary">{formatDate(schedule.effective_from)}</dd>
              </div>
              <div>
                <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">
                  Effective Until
                </dt>
                <dd className="text-body text-text-primary">
                  {schedule.effective_until ? formatDate(schedule.effective_until) : "Open-ended"}
                </dd>
              </div>
            </dl>
            <p className="text-body mt-4 text-text-secondary">
              This recurring schedule applies to future sessions within the effective period.
            </p>
            <p className="text-body mt-4 text-text-secondary">
              This recurring pattern determines the batch&rsquo;s class sessions once Attendance is
              available (a later phase). Changes to it affect future sessions only — past sessions and
              attendance remain unchanged.
            </p>
          </div>
        </div>
      ) : null}

      {activeTab === "upcoming-sessions" ? (
        <div className="rounded-card border border-border bg-surface p-6 shadow-xs">
          <h2 className="text-section-title font-semibold text-text-primary">Upcoming Sessions</h2>
          <p className="text-body mt-1 text-text-secondary">
            Future class sessions computed from this recurring schedule.
          </p>

          {upcomingSessions.length === 0 ? (
            <p className="text-body mt-4 text-text-secondary">
              No upcoming sessions — this schedule is inactive or its effective period has ended.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-border text-small font-medium tracking-wide text-text-secondary uppercase">
                    <th className="py-2 pr-4">Date</th>
                    <th className="py-2 pr-4">Time</th>
                    <th className="py-2 pr-4">Batch</th>
                    <th className="py-2">Instructor</th>
                  </tr>
                </thead>
                <tbody>
                  {upcomingSessions.map((session) => (
                    <tr key={session.date} className="border-b border-border last:border-0">
                      <td className="py-2 pr-4 text-body text-text-primary">{formatDate(session.date)}</td>
                      <td className="py-2 pr-4 text-body text-text-secondary">
                        {formatTime(session.start_time)} – {formatTime(session.end_time)}
                      </td>
                      <td className="py-2 pr-4 text-body text-text-secondary">{schedule.batches?.name ?? "—"}</td>
                      <td className="py-2 text-body text-text-secondary">{schedule.instructors?.full_name ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-body mt-3 text-text-secondary">
                Showing {upcomingSessions.length} upcoming session{upcomingSessions.length === 1 ? "" : "s"}.
              </p>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
