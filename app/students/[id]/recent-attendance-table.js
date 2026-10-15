import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { InstructorCell } from "@/components/ui/session-cells";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateWithWeekday } from "@/lib/format";
import { EXPIRY_FLAG_LABEL } from "@/lib/class-count-attendance/expiry-core";
import { ATTENDANCE_TYPE_LABELS, CLASS_COUNT_STATUS_LABELS } from "@/lib/class-count-attendance/attendance-rows";

const SESSION_STATUS = {
  present: { label: "Present", variant: "success" },
  absent: { label: "Absent", variant: "danger" },
};

/**
 * Student Details "Recent Attendance": the merged, newest-first list built by `combineRecentAttendance`
 * (`lib/class-count-attendance/attendance-rows.js`). Each row says what kind of record it is - Session or Class count.
 *
 * A session row is as it always was (batch, Present / Absent, instructor). A class-count row has no batch, instructor or
 * present / absent: its membership code is shown instead, with Recorded or Reversed - a reversed record stays visible but is
 * muted and is not a class used - and, only on a non-reversed record after the membership's current expiry, the informational
 * flag "Attendance after current expiry". The membership is the link to Membership Details, where the full history lives.
 */
export default function RecentAttendanceTable({ items }) {
  return (
    <Table aria-label="Recent attendance">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Date</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Batch / membership</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="hidden sm:table-cell">Instructor</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) =>
          item.type === "session" ? <SessionRow key={item.key} session={item.session} /> : <ClassCountRow key={item.key} record={item.record} />
        )}
      </TableBody>
    </Table>
  );
}

function DateCell({ date }) {
  return <TableCell className="whitespace-nowrap font-medium text-text-primary">{formatDateWithWeekday(date)}</TableCell>;
}

function SessionRow({ session }) {
  const status = SESSION_STATUS[session.status];
  return (
    <TableRow>
      <DateCell date={session.session_date} />
      <TableCell>
        <Badge variant="outline">{ATTENDANCE_TYPE_LABELS.session}</Badge>
      </TableCell>
      <TableCell className="text-text-primary">
        {session.batch?.name ?? "—"}
        {session.batch?.code ? <span className="text-text-secondary"> · {session.batch.code}</span> : null}
      </TableCell>
      <TableCell>
        <Badge variant={status.variant}>{status.label}</Badge>
      </TableCell>
      <TableCell className="hidden sm:table-cell">
        <InstructorCell name={session.instructor?.full_name} photoUrl={session.instructor?.photo_url} />
      </TableCell>
    </TableRow>
  );
}

function ClassCountRow({ record }) {
  const reversed = record.status === "reversed";
  return (
    <TableRow className={reversed ? "text-text-secondary" : undefined}>
      <DateCell date={record.attendedOn} />
      <TableCell>
        <Badge variant="info">{ATTENDANCE_TYPE_LABELS.class_count}</Badge>
      </TableCell>
      <TableCell className="text-text-primary">
        {record.membershipId ? (
          <Link href={`/memberships/${record.membershipId}`} className="text-brand hover:underline">
            {record.membershipCode ?? "Membership"}
          </Link>
        ) : (
          (record.membershipCode ?? "—")
        )}
      </TableCell>
      <TableCell>
        <div className="flex flex-col items-start gap-1">
          {reversed ? <Badge variant="warning">{CLASS_COUNT_STATUS_LABELS.reversed}</Badge> : <Badge variant="success">{CLASS_COUNT_STATUS_LABELS.recorded}</Badge>}
          {record.afterExpiry ? <Badge variant="info">{EXPIRY_FLAG_LABEL}</Badge> : null}
        </div>
      </TableCell>
      <TableCell className="hidden text-text-secondary sm:table-cell">—</TableCell>
    </TableRow>
  );
}
