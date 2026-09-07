import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { createBatch } from "@/lib/batches/actions";
import BatchForm from "@/app/batches/batch-form";

export default async function NewBatchPage() {
  // Authorization boundary — see app/batches/layout.js for why this must be
  // repeated here rather than relying on the layout alone. createBatch also
  // calls requireRole itself before writing anything.
  await requireRole(ROLES.ADMIN);

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/batches"
        className="text-body inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to Batches
      </Link>

      <h1 className="text-page-title mt-3 font-semibold text-text-primary">Add Batch</h1>
      <p className="text-body mt-1 text-text-secondary">
        Create a new batch. You can add schedules for it later.
      </p>

      <div className="mt-6 rounded-card border border-border bg-surface p-6 shadow-xs">
        <BatchForm action={createBatch} submitLabel="Create Batch" pendingLabel="Creating…" />
      </div>
    </div>
  );
}
