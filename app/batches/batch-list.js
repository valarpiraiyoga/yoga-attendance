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

/**
 * The Batch table (wireframe p16). A plain Server Component — unlike
 * app/settings/instructors/instructor-list.js, there is no quick
 * Activate/Deactivate action here: no product/UX document or wireframe
 * describes one for Batches (01-product.md §6 states only the capability,
 * "Admin can create, edit, activate, and deactivate batches", with no
 * inline-list mechanism; the wireframe's ACTION column shows only "View").
 * Status changes go through Edit Batch → Status, matching wireframe p17.
 *
 * The table itself is wrapped in its own bordered card here: Instructors'
 * table sits inside the Settings tab panel's own outer card, but Batches has
 * no such enclosing card — wireframe p16 shows the filter bar and the table
 * as two separate bordered boxes directly on the page.
 */
export default function BatchList({ batches }) {
  return (
    <div className="mt-6 overflow-hidden rounded-card border border-border bg-surface">
      <Table aria-label="Batches">
        <TableHeader>
          <TableRow>
            <TableHead>Batch</TableHead>
            <TableHead>Code</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {batches.map((batch) => (
            <TableRow key={batch.id}>
              <TableCell className="font-medium text-text-primary">{batch.name}</TableCell>
              <TableCell className="text-text-secondary">{batch.code}</TableCell>
              <TableCell>{batch.category || "—"}</TableCell>
              <TableCell className="max-w-xs truncate">{batch.description || "—"}</TableCell>
              <TableCell>
                <Badge variant={batch.status === "active" ? "success" : "danger"}>
                  {batch.status === "active" ? "Active" : "Inactive"}
                </Badge>
              </TableCell>
              <TableCell>
                <Link
                  href={`/batches/${batch.id}`}
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
