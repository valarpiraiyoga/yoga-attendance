import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getBatch } from "@/lib/batches/data";

const SUCCESS_MESSAGES = {
  created: "Batch created successfully.",
  updated: "Batch updated successfully.",
};

/**
 * Batch Details (wireframe p17-19): Overview / Students / Schedules tabs.
 *
 * Only Overview is implemented here. Students and Schedules render as
 * visible-but-disabled tabs, exactly mirroring how app/settings/layout.js
 * treats Center Profile and Roles & Permissions.
 *
 * The wireframe's Overview tab also shows two structural panels — a
 * "Students" summary and a "Schedules" panel with its own mini table and
 * "Add Schedule" action — populated with data from Phase 11 (Students) and
 * Phase 13 (Schedule), neither of which exists yet. Rather than fabricate
 * counts/rows or omit these approved panels outright, both keep their
 * approved position and heading and state plainly that the data isn't
 * available yet; their action buttons/links are omitted rather than left
 * pointing at routes that don't exist.
 */
export default async function BatchDetailsPage({ params, searchParams }) {
  // Authorization boundary — see app/batches/layout.js for why this must be
  // repeated here rather than relying on the layout alone.
  await requireRole(ROLES.ADMIN);

  const { id } = await params;
  const batch = await getBatch(id);

  if (!batch) {
    notFound();
  }

  const rawParams = await searchParams;
  const message = SUCCESS_MESSAGES[rawParams?.success] ?? null;

  return (
    <div>
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

      {message ? (
        <div
          role="status"
          className="mt-4 rounded-input border border-success/30 bg-success/5 px-3 py-2 text-body text-success"
        >
          {message}
        </div>
      ) : null}

      <nav aria-label="Batch sections" className="mt-6 mb-6 border-b border-border">
        <ul className="flex gap-6">
          <li>
            <span
              aria-current="page"
              className="inline-flex border-b-2 border-brand px-0.5 pb-3 text-body font-semibold text-text-primary"
            >
              Overview
            </span>
          </li>
          <li>
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="inline-flex cursor-not-allowed border-b-2 border-transparent px-0.5 pb-3 text-body text-text-secondary/70"
            >
              Students
            </button>
          </li>
          <li>
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="inline-flex cursor-not-allowed border-b-2 border-transparent px-0.5 pb-3 text-body text-text-secondary/70"
            >
              Schedules
            </button>
          </li>
        </ul>
      </nav>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <div className="rounded-card border border-border bg-surface p-6 shadow-xs">
            <h2 className="text-section-title border-b border-border pb-4 font-semibold text-text-primary">
              Batch Information
            </h2>

            <dl className="mt-5 flex flex-col gap-5">
              <div>
                <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">
                  Batch Name
                </dt>
                <dd className="text-body mt-1 text-text-primary">{batch.name}</dd>
              </div>
              <div>
                <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">
                  Short Code
                </dt>
                <dd className="text-body mt-1 text-text-primary">{batch.code}</dd>
              </div>
              <div>
                <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">
                  Category
                </dt>
                <dd className="text-body mt-1 text-text-primary">{batch.category || "—"}</dd>
              </div>
              <div>
                <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">
                  Description
                </dt>
                <dd className="text-body mt-1 text-text-primary">{batch.description || "—"}</dd>
              </div>
              <div>
                <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">
                  Status
                </dt>
                <dd className="text-body mt-1 text-text-primary">
                  {batch.status === "active" ? "Active" : "Inactive"}
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-card border border-border bg-surface p-6 shadow-xs">
            <h2 className="text-section-title font-semibold text-text-primary">Students</h2>
            <p className="text-body mt-2 text-text-secondary">
              Not available yet — student enrollment is part of a later phase.
            </p>
          </div>
        </div>

        <div className="rounded-card border border-border bg-surface p-6 shadow-xs">
          <h2 className="text-section-title font-semibold text-text-primary">Schedules</h2>
          <p className="text-body mt-2 text-text-secondary">
            Not available yet — scheduling is part of a later phase.
          </p>
        </div>
      </div>
    </div>
  );
}
