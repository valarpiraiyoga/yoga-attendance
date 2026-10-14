import { ClipboardCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import EmptyState from "@/components/ui/empty-state";
import { Panel, PanelHeader } from "@/components/layout/Panel";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { classCountText } from "@/lib/memberships/class-count";
import ReverseClassDialog from "@/app/memberships/[id]/reverse-class-dialog";
import { EXPIRY_FLAG_LABEL, attendedAfterExpiry } from "@/lib/class-count-attendance/expiry-core";

/** `12 Oct 2026, 4:05 pm` in the centre's time zone. */
function formatStamp(value, timeZone) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  }).format(new Date(value));
}

/**
 * Class Attendance (Membership Details, class-count memberships only - 02-ux.md "Class Attendance panel"): every record of
 * the membership with its date, who recorded it and when, and its status - Recorded, or Reversed with when, by whom and
 * why. Each Recorded row has Reverse; nothing is edited or deleted. `classCount` is the NET count (a reversed record does
 * not take a class).
 *
 * A record that was not reversed and whose attendance date is after the membership's CURRENT expiry (`endDate`) carries the
 * informational flag "Attendance after current expiry": an expiry edit shortened it, or it was recorded before. The record is
 * kept, not reversed, and still counts; there is nothing to acknowledge.
 *
 * @param {{ classCount: { total: number, used: number, remaining: number }, records: object[], timeZone: string,
 *   endDate: string|null, student: object|null, membership: { code: string, planLabel: string, period: string } }} props
 *   `records` are from `listClassCountHistory`.
 */
export default function ClassAttendancePanel({ classCount, records, timeZone, endDate = null, student, membership }) {
  return (
    <Panel>
      <PanelHeader
        icon={ClipboardCheck}
        title="Class Attendance"
        description={`${classCount.used} used · ${classCountText(classCount)}`}
        className="mb-4 min-h-8"
      />
      {records.length === 0 ? (
        <EmptyState size="sm" title="No classes recorded yet." description="Classes recorded for this membership appear here." />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <Table aria-label="Class attendance">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="whitespace-nowrap">Attendance date</TableHead>
                <TableHead className="whitespace-nowrap">Recorded</TableHead>
                <TableHead className="whitespace-nowrap">Status</TableHead>
                <TableHead className="whitespace-nowrap">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((record) => (
                <TableRow key={record.id}>
                  <TableCell className="whitespace-nowrap font-medium text-text-primary">{formatDate(record.attendedOn)}</TableCell>
                  <TableCell className="text-text-secondary">
                    <span className="block">{formatStamp(record.recordedAt, timeZone)}</span>
                    <span className="block text-small">{record.recordedBy ? `by ${record.recordedBy}` : "by —"}</span>
                  </TableCell>
                  <TableCell>
                    {record.reversal ? (
                      <div className="flex flex-col gap-1">
                        <Badge variant="warning">Reversed</Badge>
                        <span className="text-small text-text-secondary">
                          {formatStamp(record.reversal.reversedAt, timeZone)}
                          {record.reversal.reversedBy ? ` by ${record.reversal.reversedBy}` : ""}
                        </span>
                        <span className="max-w-xs text-small break-words whitespace-pre-line text-text-secondary">
                          Reason: {record.reversal.reason}
                        </span>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1">
                        <Badge variant="success">Recorded</Badge>
                        {attendedAfterExpiry(record, endDate) ? <Badge variant="info">{EXPIRY_FLAG_LABEL}</Badge> : null}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {record.reversal ? null : (
                      <ReverseClassDialog
                        remaining={classCount.remaining}
                        student={student}
                        membership={membership}
                        record={{
                          id: record.id,
                          dateLabel: formatDate(record.attendedOn),
                          recordedBy: record.recordedBy,
                          recordedAt: formatStamp(record.recordedAt, timeZone),
                        }}
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Panel>
  );
}
