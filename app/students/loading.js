import ListPageSkeleton from "@/components/layout/ListPageSkeleton";

/**
 * Students list loading state (app/students/page.js: header with an
 * "Add Student" action, Search / Batch / Status filters, a six-column
 * table, and server-side pagination).
 */
export default function Loading() {
  return <ListPageSkeleton columns={6} filters={3} label="Loading students" />;
}
