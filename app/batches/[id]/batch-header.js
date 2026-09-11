import Link from "next/link";
import { ArrowLeft, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * Batch Details' shared header + tab nav (wireframe p17-19: Overview /
 * Students / Schedules), extracted once Schedules gained a real second
 * route (Phase 13) alongside Overview — before that, everything lived in
 * one page and there was nothing to share. Students became a real route in
 * Phase 15A (01-product.md §4 "Schedule Assignment") — an admin editing a
 * student's schedule assignment needs to see, from the batch's own side,
 * who is enrolled and what they attend, not only from Student Details.
 *
 * A plain feature-local component, not a shared layout: unlike
 * app/settings/layout.js, Batch Details' header needs the fetched `batch`
 * itself (name, code, status), so each page fetches it and passes it down —
 * the same duplicated-fetch precedent as `requireRole` being repeated on
 * every page under a section rather than trusted to a layout alone.
 */
export default function BatchHeader({ batch, active }) {
  return (
    <>
      <Link
        href="/batches"
        className="text-body inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to Batches
      </Link>

      <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-page-title font-semibold text-text-primary">{batch.name}</h1>
          <Badge variant={batch.status === "active" ? "success" : "danger"}>
            {batch.status === "active" ? "Active" : "Inactive"}
          </Badge>
        </div>
        <Button render={<Link href={`/batches/${batch.id}/edit`} />} nativeButton={false}>
          <Pencil className="size-4" aria-hidden="true" />
          Edit Batch
        </Button>
      </div>
      <p className="text-body mt-1 text-text-secondary">Batch Code: {batch.code}</p>

      <nav aria-label="Batch sections" className="mt-6 mb-6 border-b border-border">
        <ul className="flex gap-6">
          <li>
            <Link
              href={`/batches/${batch.id}`}
              aria-current={active === "overview" ? "page" : undefined}
              className={
                active === "overview"
                  ? "inline-flex border-b-2 border-brand px-0.5 pb-3 text-body font-semibold text-text-primary"
                  : "inline-flex border-b-2 border-transparent px-0.5 pb-3 text-body text-text-secondary hover:text-text-primary"
              }
            >
              Overview
            </Link>
          </li>
          <li>
            <Link
              href={`/batches/${batch.id}/students`}
              aria-current={active === "students" ? "page" : undefined}
              className={
                active === "students"
                  ? "inline-flex border-b-2 border-brand px-0.5 pb-3 text-body font-semibold text-text-primary"
                  : "inline-flex border-b-2 border-transparent px-0.5 pb-3 text-body text-text-secondary hover:text-text-primary"
              }
            >
              Students
            </Link>
          </li>
          <li>
            <Link
              href={`/batches/${batch.id}/schedules`}
              aria-current={active === "schedules" ? "page" : undefined}
              className={
                active === "schedules"
                  ? "inline-flex border-b-2 border-brand px-0.5 pb-3 text-body font-semibold text-text-primary"
                  : "inline-flex border-b-2 border-transparent px-0.5 pb-3 text-body text-text-secondary hover:text-text-primary"
              }
            >
              Schedules
            </Link>
          </li>
        </ul>
      </nav>
    </>
  );
}
