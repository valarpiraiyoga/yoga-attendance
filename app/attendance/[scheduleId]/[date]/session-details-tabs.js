import Link from "next/link";
import {
  Calendar,
  ClipboardCheck,
  Clock,
  FileText,
  Layers,
  UserRound,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DISPLAY_STATUS_LABELS, DISPLAY_STATUS_BADGE_VARIANTS } from "@/lib/class-sessions/validation";
import EligibleStudentsList from "@/app/attendance/[scheduleId]/[date]/eligible-students-list";
import AttendancePanel from "@/app/attendance/[scheduleId]/[date]/attendance-panel";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "eligible", label: "Eligible Students" },
  { key: "attendance", label: "Attendance" },
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
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function Panel({ title, icon: Icon, children }) {
  return (
    <section className="rounded-card border border-border bg-surface p-4 shadow-xs sm:p-5">
      {title ? (
        <h2 className="mb-3 flex items-center gap-2 text-body font-semibold text-text-primary">
          {Icon ? <Icon className="size-4 text-text-secondary" aria-hidden="true" /> : null}
          {title}
        </h2>
      ) : null}
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

function SummaryTile({ label, value, tone }) {
  const tones = {
    brand: "border-brand/20 bg-brand/10",
    success: "border-success/20 bg-success/10",
    danger: "border-danger/20 bg-danger/10",
    warning: "border-warning/20 bg-warning/10",
    info: "border-info/20 bg-info/10",
  };

  return (
    <div className={`rounded-xl border px-3 py-2.5 ${tones[tone] ?? tones.brand}`}>
      <p className="text-[10px] leading-[14px] font-medium tracking-wide text-text-secondary uppercase">
        {label}
      </p>
      <p className="mt-0.5 text-body font-semibold tracking-tight text-text-primary">{value}</p>
    </div>
  );
}

/**
 * Session Details tabs — folder-tab chrome matches Batch/Schedule Detail.
 * Overview / Eligible / Attendance labels and `?tab=` routing unchanged.
 */
export default function SessionDetailsTabs({
  session,
  displayStatus,
  scheduleId,
  date,
  activeTab,
  eligibleStudents,
  initialAttendanceMarks,
  attendanceSummary,
}) {
  const batchName = session.batches?.name ?? "—";
  const batchCode = session.batches?.code ?? null;

  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-surface shadow-xs">
      <nav aria-label="Session sections" className="folder-tabs-track px-3 pt-1.5">
        <ul className="flex flex-wrap items-end gap-0.5">
          {TABS.map((tab) => {
            const isTabActive = activeTab === tab.key;
            const href =
              tab.key === "overview"
                ? `/attendance/${scheduleId}/${date}`
                : `/attendance/${scheduleId}/${date}?tab=${tab.key}`;

            return (
              <li key={tab.key}>
                <Link
                  href={href}
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
                      <span aria-hidden="true" className="h-0.5 w-full rounded-full bg-text-primary" />
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

      <div className="bg-surface px-4 pt-4 pb-4 sm:px-5 sm:pb-5">
        {activeTab === "overview" ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Session Information" icon={Calendar}>
              <div className="overflow-hidden rounded-xl border border-brand/20 bg-brand/5">
                <div className="flex items-start gap-3 bg-brand/10 px-3.5 py-3.5">
                  <span
                    aria-hidden="true"
                    className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand/15 text-small font-semibold text-brand"
                  >
                    {batchCode || "—"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-body font-semibold text-text-primary">{batchName}</p>
                      <Badge
                        variant={DISPLAY_STATUS_BADGE_VARIANTS[displayStatus]}
                        className="px-1.5 py-0"
                      >
                        <span className="text-[10px] leading-[14px] font-medium">
                          {DISPLAY_STATUS_LABELS[displayStatus]}
                        </span>
                      </Badge>
                    </div>
                    <p className="text-small mt-1 text-text-secondary">
                      {batchCode ? `Code: ${batchCode}` : "Batch"}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 border-t border-brand/15 px-3.5 py-3">
                  <FieldRow icon={UserRound} label="Instructor">
                    <p className="truncate text-body font-semibold text-text-primary">
                      {session.instructors?.full_name ?? "—"}
                    </p>
                  </FieldRow>
                  <FieldRow icon={Calendar} label="Date">
                    <p className="truncate text-body font-semibold text-text-primary">
                      {formatDate(session.session_date)}
                    </p>
                  </FieldRow>
                  <FieldRow icon={Clock} label="Time">
                    <p className="truncate text-body font-semibold text-text-primary">
                      {formatTime(session.start_time)} – {formatTime(session.end_time)}
                    </p>
                  </FieldRow>
                  <FieldRow icon={Layers} label="Status">
                    <p className="truncate text-body font-semibold text-text-primary">
                      {DISPLAY_STATUS_LABELS[displayStatus]}
                    </p>
                  </FieldRow>
                </div>

                {session.note ? (
                  <div className="border-t border-brand/15 px-3.5 py-2.5">
                    <div className="flex items-center gap-1.5 text-small text-text-secondary">
                      <FileText className="size-3.5 shrink-0" aria-hidden="true" />
                      Note
                    </div>
                    <p className="mt-1 text-body text-text-primary">{session.note}</p>
                  </div>
                ) : null}
              </div>
            </Panel>

            <Panel title="Attendance Summary" icon={ClipboardCheck}>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <SummaryTile
                  label="Eligible"
                  value={attendanceSummary?.eligibleCount ?? 0}
                  tone="info"
                />
                <SummaryTile
                  label="Present"
                  value={attendanceSummary?.presentCount ?? 0}
                  tone="success"
                />
                <SummaryTile
                  label="Absent"
                  value={attendanceSummary?.absentCount ?? 0}
                  tone="danger"
                />
                <SummaryTile
                  label="Unmarked"
                  value={attendanceSummary?.unmarkedCount ?? 0}
                  tone="warning"
                />
                <SummaryTile
                  label="Attendance"
                  value={`${attendanceSummary?.percentage ?? 0}%`}
                  tone="brand"
                />
              </div>
              <p className="text-small mt-3 text-text-secondary">
                Open the Attendance tab to take or review marks for this session.
              </p>
            </Panel>
          </div>
        ) : null}

        {activeTab === "eligible" ? (
          <Panel title="Eligible Students" icon={Users}>
            <EligibleStudentsList students={eligibleStudents} batch={session.batches} />
          </Panel>
        ) : null}

        {activeTab === "attendance" ? (
          <AttendancePanel
            session={session}
            scheduleId={scheduleId}
            date={date}
            eligibleStudents={eligibleStudents}
            initialMarks={initialAttendanceMarks}
          />
        ) : null}
      </div>
    </div>
  );
}
