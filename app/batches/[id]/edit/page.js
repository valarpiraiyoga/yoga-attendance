import { notFound } from "next/navigation";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getBatch } from "@/lib/batches/data";
import { updateBatch } from "@/lib/batches/actions";
import BatchForm from "@/app/batches/batch-form";
import PageHeader from "@/components/layout/PageHeader";

export default async function EditBatchPage({ params }) {
  // Authorization boundary — see app/batches/layout.js for why this must be
  // repeated here rather than relying on the layout alone. updateBatch also
  // calls requireRole itself before writing anything.
  await requireRole(ROLES.ADMIN);

  const { id } = await params;
  const batch = await getBatch(id);

  if (!batch) {
    notFound();
  }

  const updateBatchById = updateBatch.bind(null, id);

  return (
    <>
      <PageHeader
        compact
        back={{ href: `/batches/${id}`, label: `Back to ${batch.name}` }}
        title="Edit Batch"
        description={<>Update {batch.name}&rsquo;s details.</>}
      />
      <div className="mx-auto w-full max-w-2xl">
        <div className="rounded-card border border-border bg-surface p-6 shadow-xs">
          <BatchForm
            action={updateBatchById}
            batch={batch}
            submitLabel="Save Changes"
            pendingLabel="Saving…"
          />
        </div>
      </div>
    </>
  );
}
