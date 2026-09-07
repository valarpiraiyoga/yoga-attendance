import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getBatch } from "@/lib/batches/data";
import { updateBatch } from "@/lib/batches/actions";
import BatchForm from "@/app/batches/batch-form";

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
    <div className="mx-auto max-w-2xl">
      <Link
        href={`/batches/${id}`}
        className="text-body inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to {batch.name}
      </Link>

      <h1 className="text-page-title mt-3 font-semibold text-text-primary">Edit Batch</h1>
      <p className="text-body mt-1 text-text-secondary">
        Update {batch.name}&rsquo;s details.
      </p>

      <div className="mt-6 rounded-card border border-border bg-surface p-6 shadow-xs">
        <BatchForm
          action={updateBatchById}
          batch={batch}
          submitLabel="Save Changes"
          pendingLabel="Saving…"
        />
      </div>
    </div>
  );
}
