import Link from "next/link";
import { ArrowRight, CalendarCheck, ClipboardCheck, Layers, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import FieldRow from "@/components/layout/FieldRow";
import { Panel, PanelHeader } from "@/components/layout/Panel";
import { formatDateWithWeekday, formatTimeRange } from "@/lib/format";
import { DISPLAY_STATUS_LABELS, DISPLAY_STATUS_BADGE_VARIANTS } from "@/lib/class-sessions/validation";

function FieldValue({ children, className }) {
  return <p className={className ?? "text-body font-medium break-words text-text-primary"}>{children}</p>;
}

/**
 * Session Details → Overview (02-ux.md: the session's own Information panel
 * plus the Attendance Summary). Same panels and fields as before, in the
 * finalized `Panel` / `PanelHeader` / `FieldRow` pattern (the session note is
 * shown once, in the shared header); the summary numbers
 * come from `getAttendanceSummary` and the link opens the existing
 * Attendance tab.
 */
export default function SessionOverview({ session, displayStatus, scheduleId, date, attendanceSummary }) {
  const batchName = session.batches?.name ?? "—";
  const batchCode = session.batches?.code ?? null;
  const summary = attendanceSummary ?? {};

  return (
    <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
      <Panel className="min-w-0">
        <PanelHeader icon={CalendarCheck} title="Session Information" className="mb-4 min-h-8" />
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          <FieldRow icon={Layers} label="Batch">
            <FieldValue>{batchName}</FieldValue>
            {batchCode ? <p className="text-small text-text-secondary">Code: {batchCode}</p> : null}
          </FieldRow>
          <FieldRow icon={Layers} label="Status">
            <Badge variant={DISPLAY_STATUS_BADGE_VARIANTS[displayStatus]}>{DISPLAY_STATUS_LABELS[displayStatus]}</Badge>
          </FieldRow>
          <FieldRow icon={CalendarCheck} label="Date">
            <FieldValue>{formatDateWithWeekday(session.session_date)}</FieldValue>
          </FieldRow>
          <FieldRow icon={CalendarCheck} label="Time">
            <FieldValue>{formatTimeRange(session.start_time, session.end_time)}</FieldValue>
          </FieldRow>
          <FieldRow icon={Users} label="Instructor">
            <FieldValue>{session.instructors?.full_name ?? "—"}</FieldValue>
          </FieldRow>
        </div>
      </Panel>

      <Panel className="min-w-0">
        <PanelHeader
          icon={ClipboardCheck}
          title="Attendance Summary"
          description="Open the Attendance tab to take or review marks for this session."
          className="mb-4 min-h-8 flex-col items-start sm:flex-row sm:items-center"
          action={
            <Button
              size="sm"
              variant="ghost"
              className="text-brand hover:bg-brand/10 hover:text-brand"
              render={<Link href={`/attendance/${scheduleId}/${date}?tab=attendance`} />}
              nativeButton={false}
            >
              Open Attendance
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          }
        />
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
          <FieldRow icon={Users} label="Eligible">
            <FieldValue>{summary.eligibleCount ?? 0}</FieldValue>
          </FieldRow>
          <FieldRow icon={Users} label="Present">
            <FieldValue className="text-body font-medium text-success">{summary.presentCount ?? 0}</FieldValue>
          </FieldRow>
          <FieldRow icon={Users} label="Absent">
            <FieldValue className="text-body font-medium text-danger">{summary.absentCount ?? 0}</FieldValue>
          </FieldRow>
          <FieldRow icon={Users} label="Unmarked">
            <FieldValue>{summary.unmarkedCount ?? 0}</FieldValue>
          </FieldRow>
          <FieldRow icon={ClipboardCheck} label="Attendance">
            <FieldValue>{summary.percentage ?? 0}%</FieldValue>
          </FieldRow>
        </div>
      </Panel>
    </div>
  );
}
