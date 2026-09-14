import HistoryList from "@/app/attendance-history/history-list";

/** @deprecated Prefer HistoryList — kept as thin instructor wrapper for imports. */
export default function InstructorHistoryList({ sessions, total, layout, searchParams }) {
  return (
    <HistoryList
      sessions={sessions}
      total={total}
      variant="instructor"
      layout={layout}
      searchParams={searchParams}
    />
  );
}
