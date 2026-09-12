import ListPageSkeleton from "@/components/layout/ListPageSkeleton";

/**
 * Attendance History loading state (app/attendance-history/page.js: filters,
 * a nine-column table for an admin, and server-side pagination).
 *
 * No header action — Attendance History is read-only, so its PageHeader
 * carries no primary button (unlike Students or Batches).
 *
 * Serves both roles. The instructor list is narrower, but a placeholder that
 * is slightly wide for one role is a better trade than reading the session
 * here purely to size a skeleton.
 */
export default function Loading() {
  return (
    <ListPageSkeleton columns={9} filters={4} withAction={false} label="Loading attendance history" />
  );
}
