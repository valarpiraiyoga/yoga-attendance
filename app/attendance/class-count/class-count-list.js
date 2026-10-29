import Link from "next/link";
import { CalendarDays, FileText } from "lucide-react";
import AnimatedBorder from "@/components/ui/animated-border";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/ui/avatar";
import Progress from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { NO_EXPIRY_LABEL } from "@/lib/memberships/period";
import { remainingText } from "@/lib/class-count-attendance/record-core";
import RecordClassButton from "@/app/attendance/class-count/record-class-button";

// The same table look as the Students and Memberships lists: each membership is its own rounded row card on the page background
// (`border-separate` with a gap between rows), under a pale, rounded header strip; the row's surface and border live on its cells.
// Columns respond to the table's own width (container queries), not the viewport: Student, Classes and Action always; Membership
// (its code with the expiry beneath it) from 36rem.
const MID_ONLY = "hidden @[36rem]:table-cell";
const HEAD = "h-10 border-y border-border/60 bg-brand/5 px-3 text-small tracking-normal first:rounded-l-lg first:border-l last:rounded-r-lg last:border-r";
const CELL = "border-y border-border bg-surface px-3 py-3 first:rounded-l-card first:border-l last:rounded-r-card last:border-r";
// The body rows' hover border is the shared animated one (`.card-border-animated-row`, drawn by `AnimatedBorder` in the first cell), as in the
// Students, Memberships and Batches tables. The header row and the empty states do not have it.
const ROW = "card-border-animated-row border-0 [--card-border-inset:0px] [--card-border-radius:var(--radius-card)] hover:bg-transparent";

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
  const renew = mode === "renew";

  return (
    <div className="@container">
      <Table aria-label={ariaLabel} className="border-separate border-spacing-y-2">
        <TableHeader>
          <TableRow className="border-0 hover:bg-transparent">
            <TableHead className={HEAD}>Student</TableHead>
            <TableHead className={cn(HEAD, MID_ONLY)}>Membership</TableHead>
            <TableHead className={HEAD}>Classes</TableHead>
            <TableHead className={cn(HEAD, "w-px text-right whitespace-nowrap")}>Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.membershipId} className={ROW}>
              <TableCell className={CELL}>
                {/* The row's hover border: drawn from the first cell, sized to the whole row (see `.card-border-animated-row`). */}
                <AnimatedBorder />
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={row.fullName} src={row.photoUrl} size="lg" />
                  <div className="min-w-0">
                    <p className="truncate text-body font-semibold text-text-primary">{row.fullName}</p>
                    <p className="truncate text-small text-text-secondary">{row.studentCode}</p>
                  </div>
                </div>
              </TableCell>
              <TableCell className={cn(CELL, MID_ONLY)}>
                <div className="flex items-center gap-3">
                  <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
                    <FileText className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-body font-semibold whitespace-nowrap text-text-primary">{row.membershipCode}</p>
                    <p className="text-small flex items-center gap-1.5 whitespace-nowrap text-text-secondary">
                      <CalendarDays className="size-3.5 shrink-0" aria-hidden="true" />
                      {row.endDate ? `Expires ${formatDate(row.endDate)}` : NO_EXPIRY_LABEL}
                    </p>
                  </div>
                </div>
              </TableCell>
              <TableCell className={CELL}>
                <div className="flex max-w-60 min-w-36 flex-col gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <Badge variant={renew ? "warning" : "default"}>{remainingText(row.remaining)}</Badge>
                    <span className="text-small whitespace-nowrap text-text-secondary tabular-nums">
                      {row.used} of {row.total} used
                    </span>
                  </div>
                  <Progress
                    value={row.total > 0 ? (row.used / row.total) * 100 : 0}
                    tone={renew ? "warning" : "success"}
                    label="Classes used"
                    className="h-1.5"
                  />
                </div>
              </TableCell>
              <TableCell className={cn(CELL, "w-px whitespace-nowrap")}>
                <div className="flex justify-end">
                  {mode === "renew" ? (
                    <Button
                      variant="secondary"
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
