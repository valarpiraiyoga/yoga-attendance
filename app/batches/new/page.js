import { requireRole, ROLES } from "@/lib/auth/dal";
import { createBatch } from "@/lib/batches/actions";
import BatchForm from "@/app/batches/batch-form";
import PageHeader from "@/components/layout/PageHeader";

export default async function NewBatchPage() {
  // Authorization boundary — see app/batches/layout.js for why this must be
  // repeated here rather than relying on the layout alone. createBatch also
  // calls requireRole itself before writing anything.
  await requireRole(ROLES.ADMIN);

  return (
    <>
      <PageHeader
        compact
        back={{ href: "/batches", label: "Back to Batches" }}
        title="Add Batch"
        description="Create a new batch. You can add schedules for it later."
      />
      <div className="mx-auto w-full max-w-2xl">
        <div className="rounded-card border border-border bg-surface p-6 shadow-xs">
          <BatchForm action={createBatch} submitLabel="Create Batch" pendingLabel="Creating…" />
        </div>
      </div>
    </>
  );
}
