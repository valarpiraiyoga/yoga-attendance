import ListPageSkeleton from "@/components/layout/ListPageSkeleton";

/**
 * Attendance loading state (app/attendance/page.js: Today's Sessions and
 * All Sessions, with a view toggle and filters).
 *
 * This is the page the performance audit flagged hardest — each row costs
 * its own eligibility + marks lookup, so it is also the page where a shell
 * on screen matters most. The boundary shows the structure immediately
 * while those reads complete; it does not change how they are fetched.
 */
export default function Loading() {
  return <ListPageSkeleton columns={8} filters={3} label="Loading attendance" />;
}
