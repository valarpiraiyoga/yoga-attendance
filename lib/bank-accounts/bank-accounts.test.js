// Run with `npm test` (Node's built-in test runner).
//
// Bank Accounts settings (Invoice / Receipt): validation and masking, the functions that take a
// Supabase client (tested with a recording fake), and — for what cannot be rendered under
// node:test — the page, actions and component pinned from source, the project's way.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateBankAccountInput, maskAccountNumber } from "./validation.js";
import {
  BANK_ACCOUNT_COLUMNS,
  createBankAccountFor,
  fetchBankAccounts,
  setBankAccountActiveFor,
  updateBankAccountFor,
} from "./accounts-core.js";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const COMPONENT = "../../app/settings/invoice-receipt/bank-accounts.js";
const PAGE = "../../app/settings/invoice-receipt/page.js";
const FORM = "../../app/settings/invoice-receipt/invoice-receipt-form.js";

const VALID = {
  bank_name: "HDFC Bank",
  account_name: "Sri Yoga Center",
  account_number: "50100123456789",
  ifsc_code: "HDFC0001234",
  branch: "Chennai",
};

/** A recording fake Supabase client: every call lands in `calls`; `result` is what each ends with. */
function fakeSupabase({ result = { data: [], error: null } } = {}) {
  const calls = [];
  const chain = (name, args) => {
    calls.push({ name, args });
    const next = {
      select: (...a) => chain("select", a),
      order: (...a) => chain("order", a),
      eq: (...a) => chain("eq", a),
      then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    };
    return next;
  };
  return {
    calls,
    from: (table) => {
      calls.push({ name: "from", args: [table] });
      return {
        select: (...a) => chain("select", a),
        insert: (...a) => chain("insert", a),
        update: (...a) => chain("update", a),
        delete: (...a) => chain("delete", a),
      };
    },
    rpc: (fn, args) => {
      calls.push({ name: "rpc", args: [fn, args] });
      return Promise.resolve(result);
    },
  };
}

// ---- validation ------------------------------------------------------------------------------------

test("the four details are required; the branch is optional", () => {
  const empty = validateBankAccountInput({});
  assert.equal(empty.success, false);
  assert.deepEqual(Object.keys(empty.errors).sort(), ["account_name", "account_number", "bank_name", "ifsc_code"]);
  assert.equal(empty.errors.bank_name, "Bank name is required.");

  const blanks = validateBankAccountInput({ ...VALID, bank_name: "   ", ifsc_code: "" });
  assert.deepEqual(Object.keys(blanks.errors).sort(), ["bank_name", "ifsc_code"]);
});

test("a branch left empty is stored as NULL; the other values are trimmed", () => {
  const result = validateBankAccountInput({ ...VALID, bank_name: "  HDFC Bank ", branch: "   " });
  assert.equal(result.success, true);
  assert.equal(result.data.branch, null);
  assert.equal(result.data.bank_name, "HDFC Bank");
  assert.equal(validateBankAccountInput({ ...VALID, branch: undefined }).data.branch, null);
  assert.equal(validateBankAccountInput(VALID).data.branch, "Chennai");
});

test("the database's limits are checked for a clear message", () => {
  const long = validateBankAccountInput({
    bank_name: "x".repeat(101),
    account_name: "x".repeat(101),
    account_number: "1".repeat(35),
    ifsc_code: "x".repeat(21),
    branch: "x".repeat(101),
  });
  assert.deepEqual(Object.keys(long.errors).sort(), ["account_name", "account_number", "bank_name", "branch", "ifsc_code"]);
  const edge = validateBankAccountInput({
    bank_name: "x".repeat(100), account_name: "x".repeat(100), account_number: "1".repeat(34), ifsc_code: "x".repeat(20), branch: "x".repeat(100),
  });
  assert.equal(edge.success, true);
});

test("validation does not add rules beyond the approved ones: any text shape is accepted", () => {
  assert.equal(validateBankAccountInput({ ...VALID, account_number: "AB-12 34", ifsc_code: "hdfc0001234" }).success, true);
});

// ---- the account number in the list ------------------------------------------------------------------

test("the list masks the account number, keeping the last four characters", () => {
  assert.equal(maskAccountNumber("50100123456789"), "••••••••6789");
  assert.equal(maskAccountNumber("123456"), "••3456");
  assert.equal(maskAccountNumber("1234"), "1234");
  assert.equal(maskAccountNumber(null), "");
  assert.ok(!maskAccountNumber("50100123456789").includes("5010012345"));
});

// ---- reading ---------------------------------------------------------------------------------------

test("the accounts are read explicitly, the active one first", async () => {
  const rows = [{ id: "a", is_active: true }, { id: "b", is_active: false }];
  const supabase = fakeSupabase({ result: { data: rows, error: null } });
  assert.deepEqual(await fetchBankAccounts(supabase), rows);
  assert.deepEqual(supabase.calls[0], { name: "from", args: ["bank_accounts"] });
  assert.deepEqual(supabase.calls[1].args, [BANK_ACCOUNT_COLUMNS]);
  assert.deepEqual(supabase.calls[2].args, ["is_active", { ascending: false }]);
});

test("an empty list is an empty array, not an error; a failed read is null", async () => {
  assert.deepEqual(await fetchBankAccounts(fakeSupabase({ result: { data: [], error: null } })), []);
  const original = console.error;
  console.error = () => {};
  try {
    assert.equal(await fetchBankAccounts(fakeSupabase({ result: { data: null, error: { code: "500", message: "boom" } } })), null);
  } finally {
    console.error = original;
  }
});

// ---- add ---------------------------------------------------------------------------------------------

test("an invalid account is refused before anything is sent", async () => {
  const supabase = fakeSupabase();
  const result = await createBankAccountFor(supabase, { ...VALID, bank_name: "" });
  assert.equal(result.error, "Check the highlighted fields.");
  assert.equal(result.fieldErrors.bank_name, "Bank name is required.");
  assert.equal(supabase.calls.length, 0);
});

test("adding inserts exactly the five details — never is_active", async () => {
  const supabase = fakeSupabase({ result: { data: null, error: null } });
  assert.deepEqual(await createBankAccountFor(supabase, VALID), { success: true });
  const insert = supabase.calls.find((c) => c.name === "insert");
  assert.deepEqual(Object.keys(insert.args[0]).sort(), ["account_name", "account_number", "bank_name", "branch", "ifsc_code"]);
  assert.ok(!("is_active" in insert.args[0]));
});

test("adding without a branch sends a NULL branch", async () => {
  const supabase = fakeSupabase({ result: { data: null, error: null } });
  await createBankAccountFor(supabase, { ...VALID, branch: "" });
  assert.equal(supabase.calls.find((c) => c.name === "insert").args[0].branch, null);
});

// ---- edit --------------------------------------------------------------------------------------------

test("editing updates the five details of that account — never is_active, so an active account stays active", async () => {
  const supabase = fakeSupabase({ result: { data: [{ id: "a" }], error: null } });
  assert.deepEqual(await updateBankAccountFor(supabase, "a", { ...VALID, bank_name: "ICICI Bank" }), { success: true });
  const update = supabase.calls.find((c) => c.name === "update");
  assert.equal(update.args[0].bank_name, "ICICI Bank");
  assert.ok(!("is_active" in update.args[0]));
  assert.deepEqual(supabase.calls.find((c) => c.name === "eq").args, ["id", "a"]);
});

test("editing an account that is gone says so", async () => {
  const result = await updateBankAccountFor(fakeSupabase({ result: { data: [], error: null } }), "gone", VALID);
  assert.equal(result.code, "P0002");
  assert.match(result.error, /no longer exists/);
});

test("a database failure is mapped, never shown raw", async () => {
  const original = console.error;
  console.error = () => {};
  try {
    const supabase = fakeSupabase({ result: { data: null, error: { code: "23514", message: 'new row violates check constraint "bank_accounts_bank_name_valid"' } } });
    const result = await createBankAccountFor(supabase, VALID);
    assert.equal(result.error, "Could not save the bank account. Try again.");
    const denied = await createBankAccountFor(fakeSupabase({ result: { data: null, error: { code: "42501", message: "permission denied" } } }), VALID);
    assert.equal(denied.error, "You do not have permission to manage bank accounts.");
  } finally {
    console.error = original;
  }
});

// ---- activate / deactivate ---------------------------------------------------------------------------

test("Activate calls activate_bank_account with the account id — and nothing else", async () => {
  const supabase = fakeSupabase({ result: { data: null, error: null } });
  assert.deepEqual(await setBankAccountActiveFor(supabase, "acc-1", true), { success: true });
  assert.deepEqual(supabase.calls, [{ name: "rpc", args: ["activate_bank_account", { p_id: "acc-1" }] }]);
});

test("Deactivate calls deactivate_bank_account with the account id — and nothing else", async () => {
  const supabase = fakeSupabase({ result: { data: null, error: null } });
  assert.deepEqual(await setBankAccountActiveFor(supabase, "acc-1", false), { success: true });
  assert.deepEqual(supabase.calls, [{ name: "rpc", args: ["deactivate_bank_account", { p_id: "acc-1" }] }]);
});

test("a refused or missing account is reported in plain words", async () => {
  const original = console.error;
  console.error = () => {};
  try {
    const missing = await setBankAccountActiveFor(fakeSupabase({ result: { error: { code: "P0002", message: "Bank account not found." } } }), "x", true);
    assert.match(missing.error, /no longer exists/);
    const denied = await setBankAccountActiveFor(fakeSupabase({ result: { error: { code: "42501", message: "Not authorized." } } }), "x", false);
    assert.equal(denied.error, "You do not have permission to manage bank accounts.");
    const odd = await setBankAccountActiveFor(fakeSupabase({ result: { error: { code: "XX000", message: "internal detail" } } }), "x", true);
    assert.equal(odd.error, "Could not update the bank account. Try again.");
  } finally {
    console.error = original;
  }
});

test("activation logic is not duplicated in JavaScript: no is_active write, no loop over accounts", () => {
  for (const path of ["./accounts-core.js", "./actions.js", COMPONENT]) {
    const text = code(path);
    assert.doesNotMatch(text, /is_active\s*[:=]\s*(true|false)/, path);
    assert.doesNotMatch(text, /\.update\(\s*\{\s*is_active/, path);
  }
  assert.doesNotMatch(code("./accounts-core.js"), /\.delete\(/);
});

// ---- no delete ---------------------------------------------------------------------------------------

test("there is no Delete: no action, no delete call, no Delete control", () => {
  assert.doesNotMatch(code("./actions.js"), /deleteBankAccount|removeBankAccount/i);
  assert.deepEqual([...code("./actions.js").matchAll(/export async function (\w+)/g)].map((m) => m[1]), [
    "addBankAccount", "editBankAccount", "activateBankAccount", "deactivateBankAccount",
  ]);
  assert.doesNotMatch(code("./accounts-core.js"), /\.delete\(|\bdelete\b/i);
  assert.doesNotMatch(code(COMPONENT), /delete|remove|trash/i);
});

// ---- the list ------------------------------------------------------------------------------------------

test("each account shows bank, account name, masked number, IFSC, branch when stored, and Active / Inactive", () => {
  const component = code(COMPONENT);
  for (const part of ["account.bank_name", "account.account_name", "maskAccountNumber(account.account_number)", "account.ifsc_code"]) {
    assert.ok(component.includes(part), part);
  }
  assert.match(component, /account\.branch \? <Detail label="Branch">/);
  assert.match(component, /active \? "Active" : "Inactive"/);
  assert.doesNotMatch(component, /\{account\.account_number\}/, "the list never prints the full number");
});

test("an active account has Edit and Deactivate; an inactive one has Edit and Activate", () => {
  const component = code(COMPONENT);
  assert.match(component, />\s*Edit\s*</);
  assert.match(component, /active \? "Deactivate" : "Activate"/);
  assert.match(component, /onStatusChange\(active \? "deactivate" : "activate", account\)/);
});

test("the active account is visually distinct from an inactive one", () => {
  const component = code(COMPONENT);
  assert.match(component, /active\s*\?\s*"rounded-card border border-brand\/40 bg-brand\/5 p-4"\s*:\s*"rounded-card border border-border bg-surface p-4"/);
  assert.match(component, /variant=\{active \? "success" : "neutral"\}/);
});

test("with no accounts the section says so and still offers Add Bank Account", () => {
  const component = code(COMPONENT);
  assert.match(component, /accounts\.length === 0/);
  assert.match(component, /No bank accounts yet/);
  assert.match(component, /Add Bank Account/);
});

test("the section's wording and the two confirmations", () => {
  const component = code(COMPONENT);
  assert.match(component, /title="Bank Accounts"/);
  assert.match(component, /Manage bank accounts used on new invoices\. Changes apply to invoices issued from now on\./);
  assert.match(component, /Activate this bank account\?/);
  assert.match(component, /The currently active bank account will become inactive\./);
  assert.match(component, /Deactivate this bank account\?/);
  assert.match(component, /New invoices will not include bank details until another account is activated\./);
});

test("the Add / Edit form has the five approved fields and no others", () => {
  const component = code(COMPONENT);
  for (const label of ["Bank Name", "Account Name", "Account Number", "IFSC Code", "Branch"]) {
    assert.ok(component.includes(`label="${label}"`), label);
  }
  assert.equal((component.match(/<FormField/g) ?? []).length, 5);
  assert.equal((component.match(/required/g) ?? []).length, 4, "Branch alone is optional");
  assert.doesNotMatch(component, /upi|qr|swift|micr/i);
  // Editing passes the account's id and keeps whatever is_active it has: the form carries no such field.
  assert.match(component, /editBankAccount\(editor\.account\.id, form\)/);
  assert.doesNotMatch(component, /form\.is_active/);
});

// ---- Admin only ------------------------------------------------------------------------------------------

test("every action and every read requires the Admin role first", () => {
  assert.match(code("./actions.js"), /async function run\(operation\) \{\s*await requireRole\(ROLES\.ADMIN\);/);
  for (const name of ["addBankAccount", "editBankAccount", "activateBankAccount", "deactivateBankAccount"]) {
    assert.match(code("./actions.js"), new RegExp(`export async function ${name}\\([^)]*\\) \\{\\s*return run\\(`), name);
  }
  assert.match(code("./data.js"), /export async function getBankAccounts\(\) \{\s*await requireRole\(ROLES\.ADMIN\);/);
  assert.match(code("./data.js"), /^import "server-only";/m);
  assert.match(code(PAGE), /await requireRole\(ROLES\.ADMIN\);/);
});

test("the authenticated session client is used — never a service role", () => {
  for (const path of ["./actions.js", "./data.js", "./accounts-core.js", COMPONENT, PAGE]) {
    assert.doesNotMatch(code(path), /service_role|SERVICE_ROLE|createAdminClient|supabase\/admin/i, path);
  }
  assert.match(code("./actions.js"), /createClient\(\)/);
});

test("only the settings page renders the section, below the form and outside it", () => {
  const page = code(PAGE);
  assert.match(page, /<BankAccounts accounts=\{bankAccounts\} \/>/);
  assert.ok(page.indexOf("<InvoiceReceiptForm") < page.indexOf("<BankAccounts"));
  assert.doesNotMatch(code(FORM), /bank/i, "the settings form itself is untouched");
});

// ---- the rest of Settings and the invoice stay as they were ----------------------------------------------

test("the existing settings sections and their save are unchanged", () => {
  const form = code(FORM);
  for (const heading of ["Document Content", "Signature", "Save Changes", "Set starting invoice number"]) {
    assert.ok(form.includes(heading), heading);
  }
  const page = code(PAGE);
  assert.match(page, /updateInvoiceSettings/);
  assert.match(page, /title="Invoice \/ Receipt"/);
  assert.match(page, /Configure the document issued for paid memberships\. Changes apply to invoices issued from now on\./);
});

test("the invoice is untouched: Bank Accounts code is not imported by any invoice code", () => {
  for (const path of ["../invoices/invoice-core.js", "../invoices/invoice-document.js", "../invoices/document-data.js", "../invoices/actions.js", "../../app/memberships/[id]/invoice/invoice-document.js", "../../app/memberships/[id]/invoice/page.js"]) {
    assert.doesNotMatch(code(path), /bank-accounts|bank_accounts/, path);
  }
});
