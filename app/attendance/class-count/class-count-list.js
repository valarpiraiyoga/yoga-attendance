import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/ui/avatar";
import Progress from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { NO_EXPIRY_LABEL } from "@/lib/memberships/period";
import { remainingText } from "@/lib/class-count-attendance/record-core";
import RecordClassButton from "@/app/attendance/class-count/record-class-button";

const HEAD = "h-10 px-3 text-small tracking-normal";

/**
 * One list of the Class Count Attendance tab. `mode="record"`: class-count memberships a class can be recorded for -
 * each row has its classes used and left, its expiry, and **Record class**. `mode="renew"`: memberships with no classes
 * remaining - each row says so and offers **Renew** (Flow 09), which opens the renewal form of that membership.
 * `today` is the centre's today, for the Record class dialog's date.
 *
 * Rows are `{ membershipId, membershipCode, studentId, fullName, studentCode, photoUrl, startDate, endDate, total, used,
 * remaining }` (lib/class-count-attendance/rows.js); `endDate` is null for a membership with no expiry.
 */
export default function ClassCountList({ rows, mode, ariaLabel, today }) {
  return (
    <div className="overflow-hidden rounded-card border border-border bg-surface shadow-xs">
      <Table aria-label={ariaLabel}>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={HEAD}>Student</TableHead>
            <TableHead className={`${HEAD} hidden sm:table-cell`}>Membership</TableHead>
            <TableHead className={HEAD}>Classes</TableHead>
            <TableHead className={`${HEAD} hidden md:table-cell`}>Expiry</TableHead>
            <TableHead className={`${HEAD} text-right`}>Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.membershipId}>
              <TableCell className="px-3 py-3">
                <div className="flex items-center gap-3">
                  <Avatar name={row.fullName} src={row.photoUrl} size="md" />
                  <div className="min-w-0">
                    <p className="truncate text-body font-medium text-text-primary">{row.fullName}</p>
                    <p className="truncate text-small text-text-secondary">{row.studentCode}</p>
                  </div>
                </div>
              </TableCell>
              <TableCell className="hidden px-3 py-3 whitespace-nowrap text-text-secondary sm:table-cell">{row.membershipCode}</TableCell>
              <TableCell className="px-3 py-3">
                <div className="flex min-w-32 flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <Badge variant={mode === "renew" ? "warning" : "neutral"}>{remainingText(row.remaining)}</Badge>
                  </div>
                  <p className="text-small text-text-secondary tabular-nums">
                    {row.used} of {row.total} used
                  </p>
                  <Progress value={row.total > 0 ? (row.used / row.total) * 100 : 0} tone="brand" label="Classes used" className="h-1.5" />
                </div>
              </TableCell>
              <TableCell className="hidden px-3 py-3 whitespace-nowrap text-text-secondary md:table-cell">
                {row.endDate ? `Expires ${formatDate(row.endDate)}` : NO_EXPIRY_LABEL}
              </TableCell>
              <TableCell className="px-3 py-3">
                <div className="flex justify-end">
                  {mode === "renew" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      render={<Link href={`/memberships/${row.membershipId}/renew`} />}
                      nativeButton={false}
                      aria-label={`Renew the membership of ${row.fullName}`}
                    >
                      Renew
                    </Button>
                  ) : (
                    <RecordClassButton
                      today={today}
                      student={{ fullName: row.fullName, studentCode: row.studentCode, photoUrl: row.photoUrl }}
                      membership={{
                        membershipId: row.membershipId,
                        code: row.membershipCode,
                        startDate: row.startDate,
                        endDate: row.endDate,
                        remaining: row.remaining,
                      }}
                    />
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
