// Run with `npm test` (Node's built-in test runner).
//
// CSV report exports and spreadsheet formula injection (audit finding F-04). A spreadsheet opening a CSV evaluates a text cell that begins
// with `=`, `+`, `-` or `@` as a formula, so a batch, instructor or student name typed as `=HYPERLINK(...)` must be written as plain text.
// The serializer (`lib/reports/csv.js`) is run for real; the wiring (the server-only `export.js` and the route) is checked as source.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { csvField, csvRow, neutralizeFormula, toCsv } from "./csv.js";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const char = (codePoint) => String.fromCodePoint(codePoint);

// ---- formula-like text is made plain text --------------------------------------------------------------------------------------------

test("a cell starting with =, +, - or @ gets a leading apostrophe", () => {
  assert.equal(csvField("=1+1"), "'=1+1");
  assert.equal(csvField("+1+1"), "'+1+1");
  assert.equal(csvField("-1+1"), "'-1+1");
  assert.equal(csvField("@SUM(A1:A9)"), "'@SUM(A1:A9)");
  assert.equal(csvField("=cmd|' /C calc'!A0"), "'=cmd|' /C calc'!A0");
});

test("a leading space, control character or invisible character does not hide the trigger", () => {
  for (const prefix of [" ", "   ", "\t ", "\u0001", char(0x7f), char(0xa0), char(0x200b), char(0x200c), char(0x200d), char(0x2060), char(0xfeff)]) {
    assert.equal(neutralizeFormula(`${prefix}=1+1`), `'${prefix}=1+1`, `U+${[...prefix].map((c) => c.codePointAt(0).toString(16)).join("+")} before =`);
  }
  assert.equal(neutralizeFormula(`${char(0xa0)}@x`), `'${char(0xa0)}@x`);
  assert.equal(neutralizeFormula(" -2+3"), "' -2+3");
});

test("a cell starting with a tab or a carriage return is neutralized too", () => {
  assert.equal(neutralizeFormula("\tabc"), "'\tabc");
  assert.equal(neutralizeFormula("\rabc"), "'\rabc");
  assert.equal(csvField("\rabc"), `"'\rabc"`, "and then quoted, because it holds a carriage return");
});

test("the formula is neutralized AND still correctly quoted when it holds commas, quotes or newlines", () => {
  assert.equal(csvField('=HYPERLINK("http://x.example","go")'), `"'=HYPERLINK(""http://x.example"",""go"")"`);
  assert.equal(csvField("=1+1,2"), `"'=1+1,2"`);
  assert.equal(csvField("@a\nb"), `"'@a\nb"`);
  assert.equal(csvField("\n=1+1"), `"'\n=1+1"`, "a line break before the trigger");
});

// ---- ordinary text and numbers are untouched -----------------------------------------------------------------------------------------

test("ordinary names, labels and placeholders are written exactly as before", () => {
  for (const text of ["Hatha Yoga", "Priya Menon", "YC-000007", "Aerial Yoga (Advanced)", "10:30 AM", "85%", "Present", "—", "", "O'Brien", "a=b", "x+y", "a@b.example", "well-being", "1 - 2", "3 + 4"]) {
    assert.equal(csvField(text), text, JSON.stringify(text));
  }
  assert.equal(csvField(null), "");
  assert.equal(csvField(undefined), "");
});

test("real numbers are never altered, even negative ones; plain numbers written as text stay as they are", () => {
  assert.equal(csvField(-5), "-5");
  assert.equal(csvField(0), "0");
  assert.equal(csvField(12.5), "12.5");
  assert.equal(csvField(-0.25), "-0.25");
  for (const text of ["-3", "+1.5", "0", "42", "-0.5"]) assert.equal(csvField(text), text, text);
  // ...but a number with anything after it is not "plain".
  assert.equal(csvField("-3+2"), "'-3+2");
  assert.equal(csvField("+1e5"), "'+1e5");
  assert.equal(csvField("-"), "'-", "a lone hyphen is treated as a possible formula start (the report placeholder is the em dash, not this)");
});

test("the standard CSV escaping is unchanged: commas, quotes and line breaks", () => {
  assert.equal(csvField("Smith, Jane"), `"Smith, Jane"`);
  assert.equal(csvField('Say "hi"'), `"Say ""hi"""`);
  assert.equal(csvField("two\nlines"), `"two\nlines"`);
  assert.equal(csvField("two\r\nlines"), `"two\r\nlines"`);
  assert.equal(csvRow(["a", "b,c", 3, "=x"]), `a,"b,c",3,'=x`);
});

// ---- the whole file -------------------------------------------------------------------------------------------------------------------

test("toCsv: every untrusted text position is neutralized - title, labels, summary, headers and rows - and numbers are left alone", () => {
  const csv = toCsv({
    title: '=HYPERLINK("http://x.example","Student")',
    dateRangeLabel: "Oct 1, 2026 to Oct 31, 2026",
    summaryRows: [
      ["+Sessions", "-3"],
      ["Present", "12"],
    ],
    columns: ["Date", "@Batch", "Count"],
    rows: [
      ["Oct 5, 2026", "=1+1", 7],
      ["Oct 6, 2026", "  -cmd", -2],
      ["Oct 7, 2026", "Hatha Yoga", 0],
    ],
    filenameBase: "x",
  });
  assert.deepEqual(csv.split("\r\n"), [
    `"'=HYPERLINK(""http://x.example"",""Student"")"`,
    `"Oct 1, 2026 to Oct 31, 2026"`,
    "",
    "'+Sessions,-3",
    "Present,12",
    "",
    "Date,'@Batch,Count",
    `"Oct 5, 2026",'=1+1,7`,
    `"Oct 6, 2026",'  -cmd,-2`,
    `"Oct 7, 2026",Hatha Yoga,0`,
  ]);
  // The structure is the same as before: CRLF line endings, a blank line before the summary and before the table.
  assert.equal(csv.split("\r\n").length, 10);
  assert.ok(!csv.includes("\n\n"));
});

test("a table with only ordinary values serializes exactly as it did before the fix", () => {
  const csv = toCsv({
    title: "Student Attendance: Priya Menon",
    dateRangeLabel: "Oct 1, 2026 to Oct 31, 2026",
    summaryRows: [["Sessions", "3"]],
    columns: ["Date", "Batch Name", "Status"],
    rows: [["Oct 5, 2026", "Hatha Yoga", "Present"]],
    filenameBase: "x",
  });
  assert.equal(csv, ["Student Attendance: Priya Menon", `"Oct 1, 2026 to Oct 31, 2026"`, "", "Sessions,3", "", "Date,Batch Name,Status", `"Oct 5, 2026",Hatha Yoga,Present`].join("\r\n"));
});

// ---- wiring and scope -------------------------------------------------------------------------------------------------------------------

test("the serializer module is pure, and export.js and the route use it without changing their interfaces", () => {
  const csv = read("lib/reports/csv.js");
  assert.doesNotMatch(csv, /^import\s/m, "no imports: it loads under plain Node");
  const exportModule = read("lib/reports/export.js");
  assert.match(exportModule, /import \{ toCsv \} from "@\/lib\/reports\/csv";/);
  assert.match(exportModule, /^export \{ toCsv \};$/m, "still exported from export.js");
  assert.doesNotMatch(exportModule, /function csvField|function csvRow/, "the serializer is not duplicated");
  const route = read("app/reports/export/route.js");
  assert.match(route, /toCsv,?/);
  assert.match(route, /from "@\/lib\/reports\/export"/);
});

test("the XLSX export is untouched: it writes values with ExcelJS and does not use the CSV neutralizer", () => {
  const exportModule = read("lib/reports/export.js");
  const xlsx = exportModule.slice(exportModule.indexOf("export async function toXlsxBuffer"));
  assert.match(xlsx, /sheet\.addRow\(row\);/);
  assert.match(xlsx, /sheet\.addRow\(table\.columns\);/);
  assert.doesNotMatch(xlsx, /neutralizeFormula|csvField|csvRow/);
});
