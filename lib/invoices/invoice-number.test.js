// Run with `npm test` (Node's built-in test runner).
//
// V1 Invoice Number Prefix — Phase 4C, the application layer: the one formatter that
// builds an invoice's displayed number (prefix + number), the prefix arriving with the
// invoice data, and the rule that an issued invoice shows ITS OWN stored prefix — never
// the current Invoice / Receipt Settings value — also after its number is edited.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { formatInvoiceNumber, formatInvoiceNumberOf } from "./invoice-number.js";
import { INVOICE_COLUMNS, fetchInvoice, fetchInvoiceForMembership, updateInvoiceDetailsFor } from "./invoice-core.js";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const INVOICE_ID = "22222222-2222-4222-8222-222222222222";

/** A Supabase stand-in that records which table is read and every RPC. */
function fakeSupabase({ row = null, rpcResult = { data: null, error: null } } = {}) {
  const calls = { tables: [], rpcs: [] };
  return {
    calls,
    from(table) {
      calls.tables.push(table);
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => ({ data: row, error: null }),
      };
      return builder;
    },
    rpc: async (name, args) => {
      calls.rpcs.push({ name, args });
      return rpcResult;
    },
  };
}

// ---- the formatter ---------------------------------------------------------------------------

test("no prefix (NULL): the number reads exactly as it always has", () => {
  assert.equal(formatInvoiceNumber(786, null), "786");
  assert.equal(formatInvoiceNumber(786, undefined), "786");
  assert.equal(formatInvoiceNumber(786), "786");
  assert.notEqual(formatInvoiceNumber(786, null), "null786");
  assert.notEqual(formatInvoiceNumber(786, undefined), "undefined786");
});

test("an empty prefix is no prefix", () => {
  assert.equal(formatInvoiceNumber(786, ""), "786");
});

test("prefix INV-: INV-786", () => {
  assert.equal(formatInvoiceNumber(786, "INV-"), "INV-786");
  assert.equal(formatInvoiceNumber(788, "INV-"), "INV-788");
});

test("prefix YC-: YC-791", () => {
  assert.equal(formatInvoiceNumber(791, "YC-"), "YC-791");
});

test("a prefix with internal spaces is kept as it is", () => {
  assert.equal(formatInvoiceNumber(786, "Yoga Center-"), "Yoga Center-786");
  assert.equal(formatInvoiceNumber(5, "FY 26/"), "FY 26/5");
});

test("other approved prefixes", () => {
  for (const [prefix, expected] of [["INV/", "INV/786"], ["FY26-", "FY26-786"], ["Receipt-", "Receipt-786"]]) {
    assert.equal(formatInvoiceNumber(786, prefix), expected);
  }
});

test("the numeric number stays authoritative: shown as stored — no padding, no separators, no rounding", () => {
  assert.equal(formatInvoiceNumber(1, "INV-"), "INV-1");
  assert.equal(formatInvoiceNumber(1000000, "INV-"), "INV-1000000");
  assert.equal(formatInvoiceNumber(1000000, null), "1000000");
  // A bigint beyond Number's safe range keeps every digit when it arrives as a bigint or a string.
  assert.equal(formatInvoiceNumber(9007199254740993n, "INV-"), "INV-9007199254740993");
  assert.equal(formatInvoiceNumber("9007199254740993", null), "9007199254740993");
  // The prefix is never trimmed, so the stored label is what is shown.
  assert.equal(formatInvoiceNumber(7, "INV "), "INV 7");
});

test("a missing number is never shown as 'INV-undefined' or 'INV-null'", () => {
  assert.equal(formatInvoiceNumber(null, "INV-"), "");
  assert.equal(formatInvoiceNumber(undefined, "INV-"), "");
  assert.equal(formatInvoiceNumberOf(null), "");
  assert.equal(formatInvoiceNumberOf(undefined), "");
});

test("the formatter is pure: it does not change what it is given", () => {
  const invoice = Object.freeze({ invoice_number: 788, invoice_prefix: "INV-" });
  assert.equal(formatInvoiceNumberOf(invoice), "INV-788");
  assert.equal(invoice.invoice_number, 788);
  assert.equal(typeof invoice.invoice_number, "number");
  assert.equal(invoice.invoice_prefix, "INV-");
});

// ---- the prefix arrives with the invoice data ---------------------------------------------------------

test("the invoice read includes the prefix, and the number stays numeric", async () => {
  const columns = INVOICE_COLUMNS.split(", ");
  assert.ok(columns.includes("invoice_prefix"));
  assert.equal(columns.length, 34);
  assert.equal(columns.filter((c) => c === "invoice_number").length, 1);

  const row = { id: INVOICE_ID, invoice_number: 788, invoice_prefix: "INV-" };
  const byId = await fetchInvoice(fakeSupabase({ row }), INVOICE_ID);
  const byMembership = await fetchInvoiceForMembership(fakeSupabase({ row }), "m1");
  for (const invoice of [byId, byMembership]) {
    assert.equal(invoice.invoice_prefix, "INV-");
    assert.equal(typeof invoice.invoice_number, "number", "invoice_number is not turned into a string");
    assert.equal(invoice.invoice_number, 788);
  }
});

test("the prefix is nullable in the application data too", async () => {
  const invoice = await fetchInvoice(fakeSupabase({ row: { id: INVOICE_ID, invoice_number: 786, invoice_prefix: null } }), INVOICE_ID);
  assert.equal(invoice.invoice_prefix, null);
  assert.equal(formatInvoiceNumberOf(invoice), "786");
});

// ---- the historical snapshot -----------------------------------------------------------------------------

test("each invoice shows the prefix it was issued with: INV-788, INV-789, YC-790, then a numeric-only invoice", () => {
  const history = [
    { invoice_number: 786, invoice_prefix: null },
    { invoice_number: 787, invoice_prefix: null },
    { invoice_number: 788, invoice_prefix: "INV-" },
    { invoice_number: 789, invoice_prefix: "INV-" },
    { invoice_number: 790, invoice_prefix: "YC-" },
    { invoice_number: 791, invoice_prefix: null },
  ];
  assert.deepEqual(history.map(formatInvoiceNumberOf), ["786", "787", "INV-788", "INV-789", "YC-790", "791"]);
});

test("the current Invoice / Receipt Settings prefix never overrides an issued invoice's own prefix", async () => {
  const currentSettings = { invoice_prefix: "YC-" };
  const issued = { invoice_number: 788, invoice_prefix: "INV-" };

  // The formatter takes the invoice's own two values and nothing else: there is no settings input to leak in.
  assert.equal(formatInvoiceNumberOf.length, 1);
  assert.equal(formatInvoiceNumber.length, 2);
  assert.equal(formatInvoiceNumberOf({ ...issued, settings: currentSettings }), "INV-788");
  assert.equal(formatInvoiceNumber(issued.invoice_number, issued.invoice_prefix), "INV-788");

  // Reading an invoice touches only the invoices table — never invoice_settings.
  const supabase = fakeSupabase({ row: { id: INVOICE_ID, ...issued } });
  const invoice = await fetchInvoice(supabase, INVOICE_ID);
  assert.deepEqual(supabase.calls.tables, ["invoices"]);
  assert.equal(formatInvoiceNumberOf(invoice), "INV-788");

  // The next invoice issued under the new setting reads YC-789; the old one still reads INV-788.
  assert.equal(formatInvoiceNumber(789, currentSettings.invoice_prefix), "YC-789");
  assert.equal(formatInvoiceNumberOf(issued), "INV-788");
});

test("the invoice layer never reads the settings: the formatter has no imports at all", () => {
  const helper = code("./invoice-number.js");
  assert.doesNotMatch(helper, /^\s*import\b/m);
  assert.doesNotMatch(helper, /invoice_settings|invoice-settings|supabase|\.from\(|\.rpc\(|react|next\//i);
  for (const file of readdirSync(new URL(".", import.meta.url)).filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"))) {
    assert.doesNotMatch(code(`./${file}`), /invoice-settings|from\("invoice_settings"\)/, file);
  }
});

// ---- editing the number --------------------------------------------------------------------------------------

test("editing sends only the number and the date — never the prefix", async () => {
  const supabase = fakeSupabase();
  const result = await updateInvoiceDetailsFor(supabase, INVOICE_ID, { invoiceNumber: "800", invoiceDate: "2026-10-07" });

  assert.deepEqual(result, { success: true });
  assert.equal(supabase.calls.rpcs.length, 1);
  assert.equal(supabase.calls.rpcs[0].name, "update_invoice_details");
  assert.deepEqual(Object.keys(supabase.calls.rpcs[0].args).sort(), ["p_invoice_date", "p_invoice_id", "p_invoice_number"]);
  assert.equal(supabase.calls.rpcs[0].args.p_invoice_number, 800);
  assert.equal(JSON.stringify(supabase.calls.rpcs[0].args).includes("prefix"), false);
});

test("extra input such as a prefix passed to the edit is ignored, never forwarded", async () => {
  const supabase = fakeSupabase();
  await updateInvoiceDetailsFor(supabase, INVOICE_ID, {
    invoiceNumber: 800,
    invoiceDate: "2026-10-07",
    invoicePrefix: "YC-",
    invoice_prefix: "YC-",
  });
  assert.deepEqual(Object.keys(supabase.calls.rpcs[0].args).sort(), ["p_invoice_date", "p_invoice_id", "p_invoice_number"]);
});

test("INV-788 edited to number 800 reads INV-800: the number changes, the stored prefix does not", async () => {
  const before = { id: INVOICE_ID, invoice_number: 788, invoice_prefix: "INV-" };
  assert.equal(formatInvoiceNumberOf(before), "INV-788");

  // What the edit sends…
  const supabase = fakeSupabase();
  await updateInvoiceDetailsFor(supabase, INVOICE_ID, { invoiceNumber: 800, invoiceDate: "2026-10-07" });
  const { p_invoice_number } = supabase.calls.rpcs[0].args;

  // …and the row afterwards (the database changes the number and leaves every other column, the prefix included).
  const after = await fetchInvoice(fakeSupabase({ row: { ...before, invoice_number: p_invoice_number } }), INVOICE_ID);
  assert.equal(after.invoice_prefix, "INV-");
  assert.equal(after.invoice_number, 800);
  assert.equal(formatInvoiceNumberOf(after), "INV-800");

  // Even after the prefix setting later becomes YC-, it still reads INV-800.
  assert.equal(formatInvoiceNumberOf({ ...after }), "INV-800");
});

test("an invoice issued without a prefix keeps reading as its bare number after an edit", () => {
  assert.equal(formatInvoiceNumberOf({ invoice_number: 786, invoice_prefix: null }), "786");
  assert.equal(formatInvoiceNumberOf({ invoice_number: 800, invoice_prefix: null }), "800");
});

// ---- existing invoices ------------------------------------------------------------------------------------------

test("existing invoices without the prefix column value display exactly as before", () => {
  // A row from before 0027 (or any row where the value is NULL / absent) reads as the bare number.
  assert.equal(formatInvoiceNumberOf({ invoice_number: 786 }), "786");
  assert.equal(formatInvoiceNumberOf({ invoice_number: 787, invoice_prefix: null }), "787");
  assert.equal(formatInvoiceNumberOf({ invoice_number: 786, invoice_prefix: "" }), "786");
});

// ---- one place only --------------------------------------------------------------------------------------------

test("prefix + number is joined in one place only: the formatter", () => {
  const walk = (dir) =>
    readdirSync(new URL(dir, import.meta.url), { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? walk(`${dir}${entry.name}/`) : [`${dir}${entry.name}`]
    );
  const sources = [...walk("../../app/"), ...walk("../../lib/"), ...walk("../../components/")].filter(
    (f) => /\.(js|jsx)$/.test(f) && !/\.test\.js$/.test(f)
  );
  const joiners = sources.filter((file) => {
    const text = code(file);
    return /\$\{[^}]*invoice_?[pP]refix[^}]*\}|invoice_?[pP]refix\s*\+|\+\s*[\w.]*invoice_?[pP]refix/.test(text);
  });
  // No other file builds "prefix + number" from an invoice_prefix; the formatter does it once, from its own parameters.
  assert.deepEqual(joiners, []);
  assert.equal((code("./invoice-number.js").match(/\$\{prefix\}\$\{String\(invoiceNumber\)\}/g) ?? []).length, 1);
});

test("the formatter does no arithmetic and does not generate or change a number", () => {
  const helper = code("./invoice-number.js");
  assert.doesNotMatch(helper, /Number\(|parseInt|parseFloat|Math\.|toFixed|padStart|toLocaleString|[-*/]\s*1\b|\+\+|--/);
});

// ---- display integration (Phase 4D) ---------------------------------------------------------------------------

const PANEL = "../../app/memberships/[id]/invoice-panel.js";

function walkSources(dirs) {
  const walk = (dir) =>
    readdirSync(new URL(dir, import.meta.url), { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? walk(`${dir}${entry.name}/`) : [`${dir}${entry.name}`]
    );
  return dirs.flatMap(walk).filter((f) => /\.(js|jsx)$/.test(f));
}

test("the formatter is used by the membership invoice panel — the only place an invoice number is shown", () => {
  const users = walkSources(["../../app/", "../../components/"]).filter((file) => /invoice-number/.test(source(file)));
  assert.deepEqual(users, [PANEL]);

  const panel = code(PANEL);
  assert.match(panel, /import \{ formatInvoiceNumberOf \} from "@\/lib\/invoices\/invoice-number";/);
  assert.match(panel, /<Value>\{formatInvoiceNumberOf\(invoice\)\}<\/Value>/);
  assert.equal((panel.match(/formatInvoiceNumberOf\(/g) ?? []).length, 1);
});

test("no screen renders the bare invoice_number any more", () => {
  const offenders = walkSources(["../../app/", "../../components/"]).filter((file) => {
    const text = code(file);
    // Rendering a stored number directly: {invoice.invoice_number} or {something.invoice_number} in JSX.
    return /\{[\w.?]*\.invoice_number\}/.test(text);
  });
  assert.deepEqual(offenders, []);
});

test("the panel shows the invoice's OWN prefix: it reads only the invoice it is given, never the settings", () => {
  const panel = code(PANEL);
  assert.match(panel, /export default function InvoicePanel\(\{ membership, invoice, student, membershipSummary \}\)/);
  assert.doesNotMatch(panel, /invoice-settings|invoice_settings|getInvoiceSettings|invoice_prefix|invoicePrefix/);
  // The invoice comes from getInvoiceForMembership (the invoices table), which now carries invoice_prefix.
  assert.match(code("../../app/memberships/[id]/page.js"), /getInvoiceForMembership\(id\)/);
  assert.doesNotMatch(code("../../app/memberships/[id]/page.js"), /invoice-settings|getInvoiceSettings/);
});

test("what the panel will show, for each kind of invoice", () => {
  const settingsNow = { invoice_prefix: "YC-" }; // the current setting — must not matter to any of these
  const shown = [
    { invoice_number: 786, invoice_prefix: null }, // issued before / without a prefix
    { invoice_number: 788, invoice_prefix: "INV-" }, // issued while INV- was configured
    { invoice_number: 789, invoice_prefix: "YC-" }, // issued while YC- was configured
    { invoice_number: 790 }, // a row with no prefix value at all
  ].map((invoice) => formatInvoiceNumberOf({ ...invoice, settings: settingsNow }));
  assert.deepEqual(shown, ["786", "INV-788", "YC-789", "790"]);
  // No stray text for a missing prefix.
  for (const text of shown) assert.doesNotMatch(text, /null|undefined|\s/);
});

test("the display integration touched nothing else: the edit and the other panel fields are unchanged", () => {
  const panel = code(PANEL);
  assert.match(panel, /label="Document Title"/);
  assert.match(panel, /label="Invoice Date"[\s\S]*formatDate\(invoice\.invoice_date\)/);
  assert.match(panel, /label="Payment Date"[\s\S]*formatDate\(invoice\.payment_date\)/);
  // The invoice edit path still sends only the number and the date (nothing about the prefix).
  assert.deepEqual([...code("./invoice-core.js").matchAll(/p_invoice_\w+/g)].map((m) => m[0]).filter((v, i, a) => a.indexOf(v) === i).sort(), [
    "p_invoice_date",
    "p_invoice_id",
    "p_invoice_number",
  ]);
});
