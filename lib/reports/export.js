import "server-only";

import ExcelJS from "exceljs";
import { attendanceRatio } from "@/lib/reports/validation";

/**
 * Export utilities for Phase 17 Reports.
 *
 * One shared pipeline for all three reports, not three copies of CSV/XLSX
 * writing: each report builds a plain `ExportTable` — a title, a date-range
 * label, a summary block, and a header/rows table — and `toCsv`/`toXlsxBuffer`
 * turn that same shape into either file format. Only the three
 * `build*ExportTable` functions differ per report, because the columns
 * genuinely differ (a student's per-session status vs. a batch's per-session
 * counts vs. every batch's per-session counts) — that difference is real
 * content, not duplicated export logic.
 *
 * Every figure here comes from the SAME report objects the UI already reads
 * (`getStudentAttendanceReport`, `getBatchAttendanceReport`,
 * `getAttendanceSummaryReport` — `lib/reports/data.js`, backed by the
 * `report_session_facts` RPC). This module runs no query of its own and
 * reads no table directly: it only reformats what the data layer returns.
 * That means the export is automatically snapshot-first, completed-sessions-
 * only, and uses the same pooled ratio as the screen — there is nothing here
 * that could disagree with what an admin already sees before exporting.
 *
 * `report.sessions` is already the complete, unpaginated result for the
 * selected filters (none of the three Reports paginate — see each data
 * function's own docs), so exporting it is exporting the full filtered
 * dataset, not a visible page of it.
 *
 * @typedef {{
 *   title: string,
 *   dateRangeLabel: string,
 *   summaryRows: [string, string][],
 *   columns: string[],
 *   rows: (string|number)[][],
 *   filenameBase: string,
 * }} ExportTable
 */

// ---------------------------------------------------------------------------
// Shared formatting — the same rules every Reports UI component already
// applies, kept in sync deliberately rather than imported: these are
// EXPORT-FILE presentation choices (a plain string cell, not a styled
// screen element), the same category of divergence that already exists
// between the UI's own per-component `formatDate`/`formatPercent` copies.
// ---------------------------------------------------------------------------

function formatDateLabel(value) {
  if (!value) return "—";
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatTimeLabel(value) {
  if (!value) return "—";
  const [hours, minutes] = value.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${period}`;
}

/**
 * One decimal place, trailing ".0" trimmed (approved Reports precision —
 * wireframes p.35–37). `null` — nothing eligible to measure — becomes an
 * empty cell, never a fabricated "0%".
 */
function formatPercentLabel(ratio) {
  if (ratio === null || ratio === undefined) return "";
  return `${Number((ratio * 100).toFixed(1))}%`;
}

const STATUS_LABELS = { present: "Present", absent: "Absent", unmarked: "Unmarked" };

// ---------------------------------------------------------------------------
// Filenames
// ---------------------------------------------------------------------------

/**
 * A filesystem- and URL-safe fragment: alphanumerics and hyphens only, runs
 * of anything else collapsed to one hyphen, leading/trailing hyphens
 * trimmed. Applied to student/batch labels, which contain spaces and
 * parentheses (`"Priya Kumar"`, `"Hatha Yoga General (HYG)"`).
 */
function slugify(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

/**
 * `<report-type>_<entity->_<dateFrom>_to_<dateTo>.<ext>` — sensible on sight
 * in a downloads folder, and stable for the same filters (no timestamp),
 * matching how a re-generated report is the same report.
 *
 * @param {string} base - Already includes the report type and any entity slug.
 * @param {string} extension - "csv" or "xlsx", without the dot.
 * @returns {string}
 */
export function buildExportFilename(base, extension) {
  return `${base}.${extension}`;
}

// ---------------------------------------------------------------------------
// Per-report table builders
// ---------------------------------------------------------------------------

/**
 * Student Attendance export (wireframe p.35). One row per session the
 * student was eligible for or holds a mark for — the same rule
 * `getStudentAttendanceReport` already applies — with STATUS preserved as
 * present/absent/UNMARKED (never collapsed to absent; approved decision D2).
 *
 * @param {Awaited<ReturnType<typeof import("@/lib/reports/data").getStudentAttendanceReport>>} report
 * @param {string} studentLabel - e.g. "Priya Kumar (YC-000001)".
 * @returns {ExportTable}
 */
export function buildStudentAttendanceExportTable(report, studentLabel) {
  const { sessions, totals, dateFrom, dateTo } = report;
  const t = totals;

  return {
    title: `Student Attendance Report: ${studentLabel}`,
    dateRangeLabel: `${formatDateLabel(dateFrom)} - ${formatDateLabel(dateTo)}`,
    summaryRows: [
      ["Sessions", String(t.eligibleSessions)],
      ["Present", String(t.presentCount)],
      ["Absent", String(t.absentCount)],
      ["Unmarked", String(t.unmarkedCount)],
      ["Attendance", formatPercentLabel(t.ratio)],
    ],
    columns: ["Date", "Time", "Batch Name", "Batch Code", "Instructor", "Status"],
    rows: sessions.map((session) => [
      formatDateLabel(session.session_date),
      `${formatTimeLabel(session.start_time)} - ${formatTimeLabel(session.end_time)}`,
      session.batch?.name ?? "",
      session.batch?.code ?? "",
      session.instructor?.full_name ?? "",
      STATUS_LABELS[session.status] ?? "Unmarked",
    ]),
    filenameBase: `student-attendance_${slugify(studentLabel)}_${dateFrom}_to_${dateTo}`,
  };
}

/**
 * Batch Attendance export (wireframe p.36). One row per completed session
 * in the batch, with the same pooled totals (`computePooledTotals`) the
 * screen's KPI tiles use — total present / total eligible, never a mean of
 * the per-session percentages.
 *
 * @param {Awaited<ReturnType<typeof import("@/lib/reports/data").getBatchAttendanceReport>>} report
 * @param {string} batchLabel - e.g. "Hatha Yoga General (HYG)".
 * @returns {ExportTable}
 */
export function buildBatchAttendanceExportTable(report, batchLabel) {
  const { sessions, totals, dateFrom, dateTo } = report;
  const t = totals;

  return {
    title: `Batch Attendance Report: ${batchLabel}`,
    dateRangeLabel: `${formatDateLabel(dateFrom)} - ${formatDateLabel(dateTo)}`,
    summaryRows: [
      ["Sessions", String(t.sessionCount)],
      ["Eligible (total)", String(t.eligibleTotal)],
      ["Present (total)", String(t.presentTotal)],
      ["Absent (total)", String(t.absentTotal)],
      ["Unmarked (total)", String(t.unmarkedTotal)],
      ["Average Attendance", formatPercentLabel(t.ratio)],
    ],
    columns: ["Date", "Time", "Eligible", "Present", "Absent", "Unmarked", "Attendance (%)"],
    rows: sessions.map((session) => [
      formatDateLabel(session.session_date),
      `${formatTimeLabel(session.start_time)} - ${formatTimeLabel(session.end_time)}`,
      session.eligibleCount,
      session.presentCount,
      session.absentCount,
      session.unmarkedCount,
      formatPercentLabel(attendanceRatio(session.presentCount, session.eligibleCount)),
    ]),
    filenameBase: `batch-attendance_${slugify(batchLabel)}_${dateFrom}_to_${dateTo}`,
  };
}

/**
 * Attendance Summary export (wireframe p.37). One row per completed session
 * across every batch — the only report with no entity filter — carrying
 * Batch and Instructor per row since rows span more than one batch (the
 * same reason the screen's own table includes them, unlike Batch
 * Attendance's, which omits them as redundant within a single batch).
 *
 * @param {Awaited<ReturnType<typeof import("@/lib/reports/data").getAttendanceSummaryReport>>} report
 * @returns {ExportTable}
 */
export function buildAttendanceSummaryExportTable(report) {
  const { sessions, totals, dateFrom, dateTo } = report;
  const t = totals;

  return {
    title: "Attendance Summary Report",
    dateRangeLabel: `${formatDateLabel(dateFrom)} - ${formatDateLabel(dateTo)}`,
    summaryRows: [
      ["Total Sessions", String(t.sessionCount)],
      ["Total Eligible", String(t.eligibleTotal)],
      ["Total Present", String(t.presentTotal)],
      ["Total Absent", String(t.absentTotal)],
      ["Total Unmarked", String(t.unmarkedTotal)],
      ["Overall Attendance", formatPercentLabel(t.ratio)],
    ],
    columns: ["Date", "Time", "Batch Name", "Batch Code", "Instructor", "Eligible", "Present", "Absent", "Unmarked", "Attendance (%)"],
    rows: sessions.map((session) => [
      formatDateLabel(session.session_date),
      `${formatTimeLabel(session.start_time)} - ${formatTimeLabel(session.end_time)}`,
      session.batch?.name ?? "",
      session.batch?.code ?? "",
      session.instructor?.full_name ?? "",
      session.eligibleCount,
      session.presentCount,
      session.absentCount,
      session.unmarkedCount,
      formatPercentLabel(attendanceRatio(session.presentCount, session.eligibleCount)),
    ]),
    filenameBase: `attendance-summary_${dateFrom}_to_${dateTo}`,
  };
}

// ---------------------------------------------------------------------------
// Serializers — the genuinely shared part. Every report above funnels
// through exactly these two functions; neither knows which report produced
// its input.
// ---------------------------------------------------------------------------

/** Wraps a field in quotes and doubles internal quotes only when needed. */
function csvField(value) {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function csvRow(fields) {
  return fields.map(csvField).join(",");
}

/**
 * Serializes an `ExportTable` to CSV text: title, date range, a blank line,
 * the summary block, a blank line, then the header row and data rows.
 *
 * CRLF line endings, matching RFC 4180 and what Excel/Sheets expect when
 * opening a `.csv` directly. The caller is responsible for prefixing a
 * UTF-8 BOM on the wire if the transport needs one (a route Response, not
 * this pure string) — kept out of this function so it stays testable as
 * plain text.
 *
 * @param {ExportTable} table
 * @returns {string}
 */
export function toCsv(table) {
  const lines = [
    csvRow([table.title]),
    csvRow([table.dateRangeLabel]),
    "",
    ...table.summaryRows.map(([label, value]) => csvRow([label, value])),
    "",
    csvRow(table.columns),
    ...table.rows.map((row) => csvRow(row)),
  ];

  return lines.join("\r\n");
}

/**
 * Serializes an `ExportTable` to a real .xlsx workbook buffer via ExcelJS —
 * genuine OOXML, not CSV with an .xlsx extension. One worksheet: a bold
 * title, the date range, the summary block, then a bold header row (frozen
 * so it stays visible while scrolling) and the data rows. Column widths are
 * sized from the longer of the header or its data, with sensible bounds, so
 * numbers and dates are readable without the caller doing anything.
 *
 * @param {ExportTable} table
 * @returns {Promise<Buffer>}
 */
export async function toXlsxBuffer(table) {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Report", {
    views: [{ state: "frozen", ySplit: table.summaryRows.length + 4 }],
  });

  const titleRow = sheet.addRow([table.title]);
  titleRow.font = { bold: true, size: 13 };
  sheet.addRow([table.dateRangeLabel]);
  sheet.addRow([]);

  for (const [label, value] of table.summaryRows) {
    const row = sheet.addRow([label, value]);
    row.getCell(1).font = { bold: true };
  }
  sheet.addRow([]);

  const headerRow = sheet.addRow(table.columns);
  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F4" } };
  });

  for (const row of table.rows) {
    sheet.addRow(row);
  }

  table.columns.forEach((header, index) => {
    const longestData = table.rows.reduce((max, row) => {
      const cell = row[index];
      const length = cell === null || cell === undefined ? 0 : String(cell).length;
      return Math.max(max, length);
    }, 0);
    sheet.getColumn(index + 1).width = Math.min(40, Math.max(10, header.length, longestData) + 2);
  });

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
