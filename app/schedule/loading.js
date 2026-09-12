import ListPageSkeleton from "@/components/layout/ListPageSkeleton";

/**
 * Schedule loading state (app/schedule/page.js).
 *
 * The page has two views — a weekly grid and an eight-column list — chosen
 * by a query param. This approximates the list view for both rather than
 * branching: `loading.js` cannot read search params, and a single calm
 * placeholder is better than guessing wrong half the time.
 */
export default function Loading() {
  return <ListPageSkeleton columns={8} filters={3} label="Loading schedule" />;
}
