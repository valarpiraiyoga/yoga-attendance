import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateWithWeekday } from "@/lib/format";
import { EXPIRY_FLAG_LABEL } from "@/lib/class-count-attendance/expiry-core";
import { ATTENDANCE_TYPE_LABELS, CLASS_COUNT_STATUS_LABELS } from "@/lib/class-count-attendance/attendance-rows";

/**
 * One date's class-count attendance records in Attendance History (Admin only - the page passes none to an Instructor). They are a
 * separate section under that date's sessions, labelled "Class count", never part of a session row, card, count or percentage:
 * a class-count record has no session, batch, instructor or Present / Absent mark.
 *
 * Each record shows the student, the membership (a link to Membership Details, where the full history and Reverse live), and its
 * status: Recorded, or Reversed with the reason - a reversed record stays visible, muted, and is not a class used. Only a
 * non-reversed record after the membership's current expiry carries "Attendance after current expiry".
 *
 * `mode`: "cards" for the Cards view, "table" for the Table view.
 */
export default function HistoryClassCountSection({ records, mode, date }) {
  const label = `Class count attendance for ${formatDateWithWeekday(date)}`;

  if (mode === "cards") {
    return (
      <section aria-label={label} className="flex flex-col gap-3">
        <h3 className="text-body font-semibold text-text-primary">{ATTENDANCE_TYPE_LABELS.class_count} attendance</h3>
        {records.map((record) => (
          <article key={record.id} className="rounded-card border border-border bg-surface p-4 shadow-xs">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className={`text-body font-semibold ${record.status === "reversed" ? "text-text-secondary" : "text-text-primary"}`}>
                  {record.studentName ?? "Student"}
                </p>
                <MembershipLink record={record} />
              </div>
              <StatusBadges record={record} />
            </div>
            <ReversalReason record={record} />
          </article>
        ))}
      </section>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-xs">
      <Table aria-label={label}>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-10 px-3 text-small tracking-normal">Type</TableHead>
            <TableHead className="h-10 px-2 text-small tracking-normal">Student</TableHead>
            <TableHead className="h-10 px-2 text-small tracking-normal">Membership</TableHead>
            <TableHead className="h-10 px-2 text-small tracking-normal">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((record) => (
            <TableRow key={record.id} className={record.status === "reversed" ? "text-text-secondary" : undefined}>
              <TableCell className="px-3 py-3">
                <Badge variant="info">{ATTENDANCE_TYPE_LABELS.class_count}</Badge>
              </TableCell>
              <TableCell className="px-2 py-3 font-medium text-text-primary">{record.studentName ?? "Student"}</TableCell>
              <TableCell className="px-2 py-3">
                <MembershipLink record={record} />
              </TableCell>
              <TableCell className="px-2 py-3">
                <div className="flex flex-col items-start gap-1">
                  <StatusBadges record={record} />
                  <ReversalReason record={record} />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function MembershipLink({ record }) {
  if (!record.membershipId) return <span className="text-small text-text-secondary">{record.membershipCode ?? "—"}</span>;
  return (
    <Link href={`/memberships/${record.membershipId}`} className="text-small text-brand hover:underline">
      {record.membershipCode ?? "Membership"}
    </Link>
  );
}

function StatusBadges({ record }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {record.status === "reversed" ? (
        <Badge variant="warning">{CLASS_COUNT_STATUS_LABELS.reversed}</Badge>
      ) : (
        <Badge variant="success">{CLASS_COUNT_STATUS_LABELS.recorded}</Badge>
      )}
      {record.afterExpiry ? <Badge variant="info">{EXPIRY_FLAG_LABEL}</Badge> : null}
    </div>
  );
}

function ReversalReason({ record }) {
  // The reason is Admin free text: the database returns it to an Admin only, so an Instructor's reversed record has none to show.
  if (!record.reversal?.reason) return null;
  return <p className="mt-1 max-w-xs text-small break-words whitespace-pre-line text-text-secondary">Reason: {record.reversal.reason}</p>;
}
