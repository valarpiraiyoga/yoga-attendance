import { CardGrid, ResultsHeader } from "@/components/layout/list-page";
import SortSelect from "@/components/ui/sort-select";
import { DEFAULT_STUDENT_SORT } from "@/lib/students/data";
import { cn } from "@/lib/utils";
import StudentCardItem from "@/app/students/student-card-item";
import StudentTable from "@/app/students/student-table";

/**
 * Student results: the summary row ("N Students", with "Sort by" on its right
 * — below the toolbar, the finalized pattern) over either the card grid or the
 * table. `view` is `"cards"`, `"table"`, or `""` (no explicit choice in the
 * URL, the page-level `view` param decided by `StudentFilters`'
 * `ViewSwitcher`): then both are rendered and CSS shows Cards below `lg` and
 * Table from `lg` up — the same finalized default rule as Attendance, Schedule
 * and Batches.
 *
 * Cards: 3 columns at the widest — CardGrid's own default goes to 4 at `xl`,
 * wider than these compact cards need (docs/ui-reference/02/students.png: 3 at
 * desktop, 2 at narrower desktop/tablet, 1 on mobile).
 */
export default function StudentList({ students, view = "", total, sort, sortOptions }) {
  return (
    <div className="mt-5">
      <ResultsHeader
        count={total}
        label={total === 1 ? "Student" : "Students"}
        className="mb-3 flex-row items-center justify-between"
        aside={
          <SortSelect
            id="student-sort"
            options={sortOptions}
            value={sort}
            defaultValue={DEFAULT_STUDENT_SORT}
            compactOnMobile
          />
        }
      />

      {view !== "table" ? (
        <CardGrid ariaLabel="Students" className={cn("xl:grid-cols-3", view === "" && "lg:hidden")}>
          {students.map((student) => (
            <StudentCardItem key={student.id} student={student} />
          ))}
        </CardGrid>
      ) : null}

      {view !== "cards" ? (
        <div className={cn(view === "" && "hidden lg:block")}>
          <StudentTable students={students} />
        </div>
      ) : null}
    </div>
  );
}
