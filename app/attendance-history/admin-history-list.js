import HistoryList from "@/app/attendance-history/history-list";

/** @deprecated Prefer HistoryList — kept as thin admin wrapper for imports. */
export default function AdminHistoryList({ sessions, total, layout, searchParams }) {
  return (
    <HistoryList
      sessions={sessions}
      total={total}
      variant="admin"
      layout={layout}
      searchParams={searchParams}
    />
  );
}
