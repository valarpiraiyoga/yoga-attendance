import ListPageSkeleton from "@/components/layout/ListPageSkeleton";

/**
 * Memberships list loading state (app/memberships/page.js: header with an
 * "Add Membership" action, filters, a nine-column table, and server-side
 * pagination).
 */
export default function Loading() {
  return <ListPageSkeleton columns={9} filters={3} label="Loading memberships" />;
}
