import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { DAY_LABELS } from "@/lib/schedules/validation";

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

/**
 * The Schedule table for the List View (one of the Schedule area's two
 * approved views — see app/schedule/weekly-schedule.js for the other). A
 * plain Server Component, mirroring app/batches/batch-list.js and
 * app/memberships/membership-list.js: no quick actions here, only "View" —
 * Edit and Deactivate both live on Schedule Details.
 */
export default function ScheduleList({ schedules }) {
  return (
    <div className="mt-6 overflow-hidden rounded-card border border-border bg-surface">
      <Table aria-label="Schedules">
        <TableHeader>
          <TableRow>
            <TableHead>Batch</TableHead>
            <TableHead>Day</TableHead>
            <TableHead>Time</TableHead>
            <TableHead>Instructor</TableHead>
            <TableHead>Effective From</TableHead>
            <TableHead>Effective Until</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {schedules.map((schedule) => (
            <TableRow key={schedule.id}>
              <TableCell>
                {schedule.batches ? (
                  <>
                    <p className="font-medium text-text-primary">{schedule.batches.name}</p>
                    <p className="text-small text-text-secondary">{schedule.batches.code}</p>
                  </>
                ) : (
                  <span className="text-text-secondary">—</span>
                )}
              </TableCell>
              <TableCell className="text-text-secondary">{DAY_LABELS[schedule.day_of_week] ?? schedule.day_of_week}</TableCell>
              <TableCell className="text-text-secondary">
                {formatTime(schedule.start_time)} – {formatTime(schedule.end_time)}
              </TableCell>
              <TableCell className="text-text-secondary">{schedule.instructors?.full_name ?? "—"}</TableCell>
              <TableCell className="text-text-secondary">{formatDate(schedule.effective_from)}</TableCell>
              <TableCell className="text-text-secondary">
                {schedule.effective_until ? formatDate(schedule.effective_until) : "—"}
              </TableCell>
              <TableCell>
                <Badge variant={schedule.status === "active" ? "success" : "danger"}>
                  {schedule.status === "active" ? "Active" : "Inactive"}
                </Badge>
              </TableCell>
              <TableCell>
                <Link
                  href={`/schedule/${schedule.id}`}
                  className="font-medium text-brand hover:underline"
                >
                  View
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
