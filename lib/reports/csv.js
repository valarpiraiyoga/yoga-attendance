/**
 * The CSV serializer of the report exports - the pure half of `lib/reports/export.js` (no imports, so `npm test` loads it). It lives apart
 * because `export.js` is server-only and pulls in ExcelJS; this is the part that must be tested for real, since it writes untrusted text
 * (batch, instructor and student names) into a file a spreadsheet will open.
 */

// CSV formula injection: a spreadsheet opening a CSV evaluates a text cell that starts with `=`, `+`, `-` or `@` as a formula, and a cell
// starting with a tab or carriage return can be used the same way. A name like `=HYPERLINK(...)` must therefore arrive as text. A leading
// space, control character or invisible character before the trigger does not make it safe (spreadsheets skip it), so the check looks
// past them: ASCII controls, DEL, no-break space, zero-width characters, the word joiner and the byte-order mark. Such a cell gets a
// leading apostrophe, the standard "this is text" marker, so it is shown as typed instead of being calculated.
const FORMULA_START = /^(?:[\t\r]|[\s\x00-\x1f\x7f\xa0\u{200b}-\u{200d}\u{2060}\u{feff}]*[=+\-@])/u;
// A plain number as text ("-3", "+1.5") can never be a formula, so it is left as it is.
const PLAIN_NUMBER = /^[+-]?\d+(?:\.\d+)?$/;

/** `text` made safe to open in a spreadsheet: formula-like text gets a leading apostrophe; anything else is returned as it is. */
export function neutralizeFormula(text) {
  return FORMULA_START.test(text) && !PLAIN_NUMBER.test(text) ? `'${text}` : text;
}

/**
 * Wraps a field in quotes and doubles internal quotes only when needed. Text that a spreadsheet would read as a formula is made plain
 * text first (`neutralizeFormula`); a real number (`typeof value === "number"`) is written as it is, never altered.
 */
export function csvField(value) {
  const raw = value === null || value === undefined ? "" : String(value);
  const text = typeof value === "string" ? neutralizeFormula(raw) : raw;
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function csvRow(fields) {
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
 * @param {{ title: string, dateRangeLabel: string, summaryRows: [string, string][], columns: string[], rows: (string|number)[][] }} table
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
