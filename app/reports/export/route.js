import "server-only";

import { requireRole, ROLES } from "@/lib/auth/dal";
import { listStudentOptions } from "@/lib/students/data";
import { listBatchOptions } from "@/lib/batches/data";
import {
  getStudentAttendanceReport,
  getBatchAttendanceReport,
  getAttendanceSummaryReport,
} from "@/lib/reports/data";
import { validateReportDateRange } from "@/lib/reports/validation";
import {
  buildStudentAttendanceExportTable,
  buildBatchAttendanceExportTable,
  buildAttendanceSummaryExportTable,
  buildExportFilename,
  toCsv,
  toXlsxBuffer,
} from "@/lib/reports/export";

const REPORT_TYPES = new Set(["student", "batch", "summary"]);
const FORMATS = new Set(["csv", "xlsx"]);

/**
 * GET /reports/export?type=student|batch|summary&format=csv|xlsx&from=&to=[&student=|&batch=]
 *
 * ONE shared export endpoint for all three Reports, rather than six
 * (3 report types x 2 formats): the query string names which report and
 * which format, and everything else — reading the report, building the
 * table, serializing it — is the same shared pipeline
 * (`lib/reports/export.js`) regardless of which report was asked for.
 *
 * ROUTE HANDLERS ARE NOT COVERED BY A PAGE LAYOUT'S AUTH CHECK.
 * `app/reports/layout.js`'s `requireRole(ROLES.ADMIN)` only runs for page
 * *rendering* under that segment; a colocated `route.js` is a distinct
 * request target that Next.js does not run the layout for. This handler
 * therefore asserts `requireRole(ROLES.ADMIN)` itself, first, exactly as
 * every page under this layout already does independently — Reports stays
 * Admin-only for exports too, not only for the screens.
 *
 * Every report is re-fetched here from the SAME data-layer functions the
 * screens call (`getStudentAttendanceReport`, `getBatchAttendanceReport`,
 * `getAttendanceSummaryReport`) using the SAME filters the request carries
 * — there is no second query path and no cached/stale copy of what the
 * admin was just looking at. Historical eligibility is therefore
 * necessarily snapshot-first here too: it is the identical call the page
 * made moments earlier. `report.sessions` is the complete, unpaginated
 * result for those filters (Reports do not paginate), so the export always
 * covers the full filtered dataset, never only a visible page of it.
 */
export async function GET(request) {
  await requireRole(ROLES.ADMIN);

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const format = searchParams.get("format");
  const dateFrom = searchParams.get("from") ?? "";
  const dateTo = searchParams.get("to") ?? "";

  if (!REPORT_TYPES.has(type) || !FORMATS.has(format)) {
    return new Response("Unknown export request.", { status: 400 });
  }

  const range = validateReportDateRange(dateFrom, dateTo);
  if (!range.success) {
    return new Response(range.error, { status: 400 });
  }

  let table;

  if (type === "student") {
    const studentId = searchParams.get("student") ?? "";
    if (!studentId) return new Response("Select a student.", { status: 400 });

    const [report, studentOptions] = await Promise.all([
      getStudentAttendanceReport({ studentId, dateFrom: range.data.dateFrom, dateTo: range.data.dateTo }),
      listStudentOptions(),
    ]);
    const student = studentOptions.find((option) => option.id === studentId);
    if (!student) return new Response("That student could not be found.", { status: 404 });

    table = buildStudentAttendanceExportTable(report, `${student.full_name} (${student.student_code})`);
  } else if (type === "batch") {
    const batchId = searchParams.get("batch") ?? "";
    if (!batchId) return new Response("Select a batch.", { status: 400 });

    const [report, batchOptions] = await Promise.all([
      getBatchAttendanceReport({ batchId, dateFrom: range.data.dateFrom, dateTo: range.data.dateTo }),
      listBatchOptions(),
    ]);
    const batch = batchOptions.find((option) => option.id === batchId);
    if (!batch) return new Response("That batch could not be found.", { status: 404 });

    table = buildBatchAttendanceExportTable(report, `${batch.name} (${batch.code})`);
  } else {
    const report = await getAttendanceSummaryReport({ dateFrom: range.data.dateFrom, dateTo: range.data.dateTo });
    table = buildAttendanceSummaryExportTable(report);
  }

  const filename = buildExportFilename(table.filenameBase, format);

  if (format === "csv") {
    // A leading UTF-8 BOM so Excel opens the file with the right encoding
    // instead of guessing — the one place this route touches encoding at
    // all; `toCsv` itself stays a plain, testable string builder.
    const body = String.fromCharCode(0xfeff) + toCsv(table);
    return new Response(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  const buffer = await toXlsxBuffer(table);
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
