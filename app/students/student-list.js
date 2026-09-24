import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Panel } from "@/components/layout/Panel";
import { CardGrid, ResultsHeader } from "@/components/layout/list-page";
import SortSelect from "@/components/ui/sort-select";
import { DEFAULT_STUDENT_SORT } from "@/lib/students/data";
import StudentCardItem from "@/app/students/student-card-item";
import StudentTableRow from "@/app/students/student-table-row";

// 3 columns at the widest — CardGrid's own default goes to 4 at `xl`, wider
// than these compact cards need (docs/ui-reference/02/students.png: 3 at
// desktop, 2 at narrower desktop/tablet, 1 on mobile — the `sm`/`lg` steps
// CardGrid already provides).
function StudentCards({ students }) {
  return (
    <CardGrid ariaLabel="Students" className="xl:grid-cols-3">
      {students.map((student) => (
        <StudentCardItem key={student.id} student={student} />
      ))}
    </CardGrid>
  );
}

function StudentTable({ students }) {
  return (
    <Panel className="overflow-hidden p-0 sm:p-0">
      <Table aria-label="Students">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Student</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Batch</TableHead>
            <TableHead>Membership</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {students.map((student) => (
            <StudentTableRow key={student.id} student={student} />
          ))}
        </TableBody>
      </Table>
    </Panel>
  );
}

/**
 * Student results — Cards / Table view is a page-level `view` param
 * decided by `StudentFilters`' `ViewSwitcher`, not client state here.
 */
export default function StudentList({ students, view = "cards", total, sort, sortOptions }) {
  return (
    <div className="mt-6">
      <ResultsHeader
        count={total}
        label={total === 1 ? "Student" : "Students"}
        viewLabel={view === "table" ? "Table view" : "Card list view"}
        aside={
          <SortSelect
            id="student-sort"
            options={sortOptions}
            value={sort}
            defaultValue={DEFAULT_STUDENT_SORT}
          />
        }
      />

      {view === "table" ? <StudentTable students={students} /> : <StudentCards students={students} />}
    </div>
  );
}
