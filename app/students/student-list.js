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

const MEMBERSHIP_SUMMARY_VARIANTS = { active: "success", expired: "neutral", none: "outline" };
const MEMBERSHIP_SUMMARY_LABELS = { active: "Active", expired: "Expired", none: "None" };

function getInitials(name) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/**
 * The Student table (wireframe p9). A plain Server Component, mirroring
 * app/batches/batch-list.js: no quick Activate/Deactivate action here
 * either, and for a stronger reason than Batches had — 02-ux.md Flow 11
 * explicitly routes deactivation through Student Details ("Students →
 * Select Student → Deactivate Student → Review → Confirm → Save"), not the
 * list. The list's only action is "View".
 *
 * MEMBERSHIP shows the coarse three-state summary (Active/Expired/None)
 * described in 02-ux.md's "Memberships list filters" note — a simpler
 * partition than Membership's own four-state status, matching
 * lib/students/data.js's `deriveStudentMembershipSummary`.
 */
export default function StudentList({ students }) {
  return (
    <div className="mt-6 overflow-hidden rounded-card border border-border bg-surface">
      <Table aria-label="Students">
        <TableHeader>
          <TableRow>
            <TableHead>Student</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Batches</TableHead>
            <TableHead>Membership</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {students.map((student) => (
            <TableRow key={student.id}>
              <TableCell>
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="flex size-8 shrink-0 items-center justify-center rounded-full bg-background text-small font-medium text-brand"
                  >
                    {getInitials(student.full_name)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-text-primary">{student.full_name}</p>
                    <p className="text-small text-text-secondary">{student.student_code}</p>
                  </div>
                </div>
              </TableCell>
              <TableCell>{student.phone}</TableCell>
              <TableCell>
                {student.batchCodes.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {student.batchCodes.map((code) => (
                      <Badge key={code} variant="outline">
                        {code}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <span className="text-text-secondary">—</span>
                )}
              </TableCell>
              <TableCell>
                <Badge variant={MEMBERSHIP_SUMMARY_VARIANTS[student.membershipSummary]}>
                  {MEMBERSHIP_SUMMARY_LABELS[student.membershipSummary]}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge variant={student.status === "active" ? "success" : "danger"}>
                  {student.status === "active" ? "Active" : "Inactive"}
                </Badge>
              </TableCell>
              <TableCell>
                <Link
                  href={`/students/${student.id}`}
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
