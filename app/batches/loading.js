import ListPageSkeleton from "@/components/layout/ListPageSkeleton";

/**
 * Batches list loading state (app/batches/page.js: header with an
 * "Add Batch" action, Search / Status filters, a six-column table, and
 * server-side pagination).
 */
export default function Loading() {
  return <ListPageSkeleton columns={6} filters={2} label="Loading batches" />;
}
