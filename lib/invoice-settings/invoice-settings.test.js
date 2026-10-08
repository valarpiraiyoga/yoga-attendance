// Run with `npm test` (Node's built-in test runner).
//
// V1 Invoice / Receipt — Phase 3: the Invoice / Receipt Settings tab. Validation
// (pure), the core and the signature helper (an injected fake Supabase client,
// as in lib/center-profile/center-settings.test.js), and the structure of the
// server-only wrappers and the screen (pinned from source, as the project does for
// code that cannot be imported under node:test).

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import {
  DOCUMENT_TITLES,
  MAX_INVOICE_PREFIX_LENGTH,
  MAX_SIGNATORY_DESIGNATION_LENGTH,
  MAX_SIGNATORY_NAME_LENGTH,
  MAX_TAX_NAME_LENGTH,
  MAX_TERMS_LENGTH,
  parseTaxEnabled,
  validateInvoiceSettingsInput,
} from "./validation.js";
import {
  INVOICE_SETTINGS_COLUMNS,
  WRITABLE_COLUMNS,
  buildSettingsUpdate,
  fetchHasIssuedInvoices,
  fetchInvoiceSettings,
  mapSettingsError,
  saveInvoiceSettings,
} from "./settings-core.js";
import {
  SIGNATURE_BUCKET,
  SIGNATURE_URL_TTL_SECONDS,
  createSignatureUrl,
  readSignatureFromForm,
  signaturePathFor,
  stageSignatureChange,
  uploadSignature,
} from "./signature.js";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
// Source with comments removed, so a pattern cannot match explanatory text.
const code = (path) =>
  source(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const GOOD = {
  document_title: "invoice",
  starting_invoice_number: "1224",
  tax_enabled: "0",
  tax_name: "",
  tax_rate: "",
  terms: "",
  signatory_name: "",
  signatory_designation: "",
};

const check = (overrides = {}, options) => validateInvoiceSettingsInput({ ...GOOD, ...overrides }, options);

async function quietly(fn) {
  const original = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.join(" "));
  try {
    return { result: await fn(), logged };
  } finally {
    console.error = original;
  }
}

function png(size = 100, name = "signature.png", type = "image/png") {
  return new File([new Uint8Array(size)], name, { type });
}

/** A Supabase stand-in: records every query, update, upload, signed URL and removal. */
function fakeSupabase({
  settings = { starting_invoice_number: null, document_title: "invoice" },
  invoiceCount = 0,
  readError = null,
  updateError = null,
  uploadError = null,
  signError = null,
} = {}) {
  const calls = { queries: [], updates: [], uploads: [], signed: [], removes: [] };
  return {
    calls,
    from(table) {
      const query = { table, select: null, options: null, filters: [] };
      calls.queries.push(query);
      const builder = {
        select(columns, options) {
          query.select = columns;
          query.options = options ?? null;
          return builder;
        },
        eq(column, value) {
          query.filters.push([column, value]);
          return builder;
        },
        maybeSingle: async () => ({ data: readError ? null : settings, error: readError }),
        // `await supabase.from("invoices").select("id", { count, head })`
        then: (resolve) => resolve(readError ? { count: null, error: readError } : { count: invoiceCount, error: null }),
        update(payload) {
          calls.updates.push({ table, payload });
          return { eq: async () => ({ error: updateError }) };
        },
      };
      return builder;
    },
    storage: {
      from(bucket) {
        return {
          upload: async (path, file, options) => {
            calls.uploads.push({ bucket, path, type: file.type, options });
            return { error: uploadError };
          },
          createSignedUrl: async (path, seconds) => {
            calls.signed.push({ bucket, path, seconds });
            return signError ? { data: null, error: signError } : { data: { signedUrl: `https://signed.example/${path}?t=1` }, error: null };
          },
          remove: async (paths) => {
            calls.removes.push({ bucket, paths });
            return { error: null };
          },
        };
      },
    },
  };
}

// ---- VALIDATION ---------------------------------------------------------------------------------

test("document title: Invoice and Receipt are accepted, anything else is rejected", () => {
  assert.deepEqual(DOCUMENT_TITLES, ["invoice", "receipt"]);
  assert.equal(check({ document_title: "invoice" }).data.document_title, "invoice");
  assert.equal(check({ document_title: " Receipt " }).data.document_title, "receipt");
  for (const bad of ["", "tax invoice", "bill", undefined, null]) {
    const result = check({ document_title: bad });
    assert.equal(result.success, false, String(bad));
    assert.equal(result.errors.document_title, "Choose Invoice or Receipt.");
  }
});

test("a blank starting number is allowed and means numbering is not configured", () => {
  for (const blank of ["", "   ", undefined, null]) {
    const result = check({ starting_invoice_number: blank });
    assert.equal(result.success, true);
    assert.equal(result.data.starting_invoice_number, null);
  }
});

test("a positive whole starting number is accepted as a number, with no prefix and no padding rule", () => {
  assert.equal(check({ starting_invoice_number: "1224" }).data.starting_invoice_number, 1224);
  assert.equal(check({ starting_invoice_number: " 1 " }).data.starting_invoice_number, 1);
  assert.equal(check({ starting_invoice_number: "00012" }).data.starting_invoice_number, 12);
});

test("an invalid starting number is rejected on its own field", () => {
  for (const bad of ["0", "-5", "12.5", "12a", "RCT-1", "1e3", "abc", "1,224"]) {
    const result = check({ starting_invoice_number: bad });
    assert.equal(result.success, false, bad);
    assert.equal(result.errors.starting_invoice_number, "Enter the starting number as a positive whole number.", bad);
  }
});

test("a starting number can have at most 15 digits", () => {
  assert.equal(check({ starting_invoice_number: "999999999999999" }).success, true);
  const tooLong = check({ starting_invoice_number: "1234567890123456" });
  assert.equal(tooLong.success, false);
  assert.match(tooLong.errors.starting_invoice_number, /at most 15 digits/);
});

test("when the starting number is locked it is ignored entirely — never changed, never cleared", () => {
  for (const submitted of ["9999", "", "garbage", undefined]) {
    const result = check({ starting_invoice_number: submitted }, { startingLocked: true });
    assert.equal(result.success, true, String(submitted));
    assert.equal(Object.hasOwn(result.data, "starting_invoice_number"), false);
  }
});

test("tax disabled: the tax name and rate are ignored (so the stored ones are left alone)", () => {
  const result = check({ tax_enabled: "0", tax_name: "", tax_rate: "garbage" });
  assert.equal(result.success, true);
  assert.equal(result.data.tax_enabled, false);
  assert.equal(Object.hasOwn(result.data, "tax_name"), false);
  assert.equal(Object.hasOwn(result.data, "tax_rate"), false);
});

test("tax enabled with a name and a valid rate is accepted", () => {
  const result = check({ tax_enabled: "1", tax_name: " GST ", tax_rate: "18" });
  assert.equal(result.success, true);
  assert.equal(result.data.tax_enabled, true);
  assert.equal(result.data.tax_name, "GST");
  assert.equal(result.data.tax_rate, 18);
  assert.equal(check({ tax_enabled: "1", tax_name: "VAT", tax_rate: "5.5" }).data.tax_rate, 5.5);
  assert.equal(check({ tax_enabled: "1", tax_name: "VAT", tax_rate: "99.99" }).data.tax_rate, 99.99);
});

test("the tax switch value is read from the submitted form", () => {
  for (const on of ["1", "true", "on", true]) assert.equal(parseTaxEnabled(on), true, String(on));
  for (const off of ["0", "", null, undefined, "false", false]) assert.equal(parseTaxEnabled(off), false, String(off));
});

test("tax enabled without a name or a rate is rejected", () => {
  const noName = check({ tax_enabled: "1", tax_name: "  ", tax_rate: "18" });
  assert.equal(noName.errors.tax_name, "Enter the tax name.");
  const noRate = check({ tax_enabled: "1", tax_name: "GST", tax_rate: "" });
  assert.equal(noRate.errors.tax_rate, "Enter the tax rate.");
  const neither = check({ tax_enabled: "1" });
  assert.ok(neither.errors.tax_name && neither.errors.tax_rate);
});

test("an invalid tax rate is rejected: must be above 0 and below 100", () => {
  for (const bad of ["0", "0.00", "100", "100.5", "250", "-1", "abc", "1,5", "5%"]) {
    const result = check({ tax_enabled: "1", tax_name: "GST", tax_rate: bad });
    assert.equal(result.success, false, bad);
    assert.ok(result.errors.tax_rate, bad);
  }
  assert.equal(check({ tax_enabled: "1", tax_name: "GST", tax_rate: "0" }).errors.tax_rate, "The tax rate must be above 0 and below 100.");
});

test("a tax rate can have at most 2 decimal places", () => {
  const result = check({ tax_enabled: "1", tax_name: "GST", tax_rate: "5.123" });
  assert.equal(result.success, false);
  assert.equal(result.errors.tax_rate, "The tax rate can have at most 2 decimal places.");
  assert.equal(check({ tax_enabled: "1", tax_name: "GST", tax_rate: "5.12" }).success, true);
});

test("terms: optional, at most 2000 characters", () => {
  assert.equal(MAX_TERMS_LENGTH, 2000);
  assert.equal(check({ terms: "" }).data.terms, null);
  assert.equal(check({ terms: " Pay in advance. " }).data.terms, "Pay in advance.");
  assert.equal(check({ terms: "x".repeat(2000) }).success, true);
  assert.equal(check({ terms: "x".repeat(2001) }).errors.terms, "Terms & Conditions must be 2000 characters or fewer.");
});

test("signatory name: optional, at most 100 characters", () => {
  assert.equal(MAX_SIGNATORY_NAME_LENGTH, 100);
  assert.equal(check({ signatory_name: "" }).data.signatory_name, null);
  assert.equal(check({ signatory_name: "A".repeat(100) }).success, true);
  assert.equal(check({ signatory_name: "A".repeat(101) }).errors.signatory_name, "Signatory name must be 100 characters or fewer.");
});

test("signatory designation: optional, at most 100 characters", () => {
  assert.equal(MAX_SIGNATORY_DESIGNATION_LENGTH, 100);
  assert.equal(check({ signatory_designation: " Director " }).data.signatory_designation, "Director");
  assert.equal(check({ signatory_designation: "D".repeat(101) }).errors.signatory_designation, "Signatory designation must be 100 characters or fewer.");
});

test("tax name: at most 30 characters", () => {
  assert.equal(MAX_TAX_NAME_LENGTH, 30);
  assert.equal(check({ tax_enabled: "1", tax_name: "T".repeat(30), tax_rate: "5" }).success, true);
  assert.equal(
    check({ tax_enabled: "1", tax_name: "T".repeat(31), tax_rate: "5" }).errors.tax_name,
    "Tax name must be 30 characters or fewer."
  );
});

test("every error is reported at once", () => {
  const result = check({ document_title: "x", starting_invoice_number: "0", tax_enabled: "1", terms: "x".repeat(2001) });
  assert.deepEqual(Object.keys(result.errors).sort(), ["document_title", "starting_invoice_number", "tax_name", "tax_rate", "terms"]);
});

// ---- CORE ----------------------------------------------------------------------------------------

test("settings read: one explicit-column query on invoice_settings by its singleton key", async () => {
  const supabase = fakeSupabase({ settings: { document_title: "receipt" } });
  assert.deepEqual(await fetchInvoiceSettings(supabase), { document_title: "receipt" });
  const [query] = supabase.calls.queries;
  assert.equal(query.table, "invoice_settings");
  assert.deepEqual(query.filters, [["singleton", true]]);
  assert.equal(query.select, INVOICE_SETTINGS_COLUMNS);
  assert.doesNotMatch(query.select, /next_invoice_number/, "the internal counter is not even read");
  assert.equal(await fetchInvoiceSettings(fakeSupabase({ settings: null })), null);
});

test("a failed settings read throws a plain message", async () => {
  const { logged } = await quietly(async () => {
    await assert.rejects(fetchInvoiceSettings(fakeSupabase({ readError: { code: "XX000", message: "boom" } })), /Could not load the invoice settings\./);
  });
  assert.equal(logged.length, 1);
});

test("whether an invoice exists is a head count on invoices", async () => {
  const none = fakeSupabase({ invoiceCount: 0 });
  assert.equal(await fetchHasIssuedInvoices(none), false);
  assert.deepEqual(none.calls.queries[0].options, { count: "exact", head: true });
  assert.equal(none.calls.queries[0].table, "invoices");
  assert.equal(await fetchHasIssuedInvoices(fakeSupabase({ invoiceCount: 3 })), true);
});

test("the update payload is whitelisted — and next_invoice_number is NEVER writable", () => {
  assert.equal(WRITABLE_COLUMNS.includes("next_invoice_number"), false);
  assert.equal(WRITABLE_COLUMNS.includes("singleton"), false);
  assert.equal(WRITABLE_COLUMNS.includes("updated_at"), false);

  const payload = buildSettingsUpdate(
    {
      document_title: "invoice",
      starting_invoice_number: 1224,
      invoice_prefix: "INV-",
      tax_enabled: true,
      tax_name: "GST",
      tax_rate: 18,
      terms: null,
      signatory_name: "A",
      signatory_designation: "B",
      // None of these may get through, however they arrive:
      next_invoice_number: 1,
      singleton: false,
      updated_at: "now",
      id: "x",
      total_amount: 5,
    },
    { signature_path: "signatures/a.png", next_invoice_number: 99 }
  );

  assert.deepEqual(Object.keys(payload).sort(), [...WRITABLE_COLUMNS].sort());
  assert.equal("next_invoice_number" in payload, false);
  assert.equal(payload.signature_path, "signatures/a.png");
});

test("keys that are absent are left out, not blanked: locked starting number, tax off, signature unchanged", () => {
  const validated = check({ tax_enabled: "0", starting_invoice_number: "5" }, { startingLocked: true });
  const payload = buildSettingsUpdate(validated.data, {});
  assert.equal("starting_invoice_number" in payload, false);
  assert.equal("tax_name" in payload, false);
  assert.equal("tax_rate" in payload, false);
  assert.equal("signature_path" in payload, false);
  assert.equal(payload.tax_enabled, false);
  assert.equal(payload.document_title, "invoice");
});

test("saving writes the validated fields to invoice_settings by singleton, and nothing else", async () => {
  const supabase = fakeSupabase({ invoiceCount: 0 });
  const result = await saveInvoiceSettings(supabase, {
    input: { ...GOOD, tax_enabled: "1", tax_name: "GST", tax_rate: "18", terms: "Pay in advance" },
  });

  assert.deepEqual(result, { success: true });
  assert.equal(supabase.calls.updates.length, 1);
  const [{ table, payload }] = supabase.calls.updates;
  assert.equal(table, "invoice_settings");
  assert.deepEqual(payload, {
    document_title: "invoice",
    starting_invoice_number: 1224,
    invoice_prefix: null,
    tax_enabled: true,
    tax_name: "GST",
    tax_rate: 18,
    terms: "Pay in advance",
    signatory_name: null,
    signatory_designation: null,
  });
  assert.equal(supabase.calls.uploads.length, 0);
});

test("once an invoice exists the starting number is ignored — not sent, not cleared", async () => {
  for (const submitted of ["9999", ""]) {
    const supabase = fakeSupabase({ invoiceCount: 1 });
    const result = await saveInvoiceSettings(supabase, { input: { ...GOOD, starting_invoice_number: submitted } });
    assert.equal(result.success, true);
    assert.equal("starting_invoice_number" in supabase.calls.updates[0].payload, false, JSON.stringify(submitted));
  }
});

test("a blank starting number before the first invoice clears it (numbering unconfigured again)", async () => {
  const supabase = fakeSupabase({ invoiceCount: 0 });
  await saveInvoiceSettings(supabase, { input: { ...GOOD, starting_invoice_number: "" } });
  assert.equal(supabase.calls.updates[0].payload.starting_invoice_number, null);
});

test("tax off leaves the stored tax name and rate alone; turning it on writes them", async () => {
  const off = fakeSupabase();
  await saveInvoiceSettings(off, { input: { ...GOOD, tax_enabled: "0", tax_name: "", tax_rate: "" } });
  assert.equal(off.calls.updates[0].payload.tax_enabled, false);
  assert.equal("tax_name" in off.calls.updates[0].payload, false);
  assert.equal("tax_rate" in off.calls.updates[0].payload, false);

  const on = fakeSupabase();
  await saveInvoiceSettings(on, { input: { ...GOOD, tax_enabled: "1", tax_name: "GST", tax_rate: "12.5" } });
  assert.equal(on.calls.updates[0].payload.tax_name, "GST");
  assert.equal(on.calls.updates[0].payload.tax_rate, 12.5);
});

test("an invalid form never reaches the database", async () => {
  const supabase = fakeSupabase();
  const result = await saveInvoiceSettings(supabase, { input: { ...GOOD, tax_enabled: "1" } });
  assert.equal(result.error, "Check the highlighted fields.");
  assert.ok(result.fieldErrors.tax_name && result.fieldErrors.tax_rate);
  assert.equal(supabase.calls.updates.length, 0);
  assert.equal(supabase.calls.uploads.length, 0);
});

test("known database errors are mapped; the locked starting number is one of them", () => {
  const locked = mapSettingsError({ code: "55006", message: "The starting invoice number cannot be changed once an invoice has been issued." });
  assert.equal(locked.error, "The starting invoice number cannot be changed once an invoice has been issued.");
  assert.equal(locked.code, "55006");

  const checks = [
    ["invoice_settings_tax_complete", "tax_name"],
    ["invoice_settings_tax_rate_range", "tax_rate"],
    ["invoice_settings_tax_name_not_blank", "tax_name"],
    ["invoice_settings_starting_positive", "starting_invoice_number"],
    ["invoice_settings_document_title_valid", "document_title"],
  ];
  for (const [constraint, field] of checks) {
    const mapped = mapSettingsError({ code: "23514", message: `new row for relation "invoice_settings" violates check constraint "${constraint}"` });
    assert.deepEqual(Object.keys(mapped.fieldErrors), [field], constraint);
  }

  assert.equal(mapSettingsError({ code: "42501", message: "permission denied" }).error, "You do not have permission to change the invoice settings.");
});

test("an unknown error is logged by code and message and shown as a generic message — never raw text", async () => {
  const { result, logged } = await quietly(async () => mapSettingsError({ code: "XX000", message: 'relation "x" is on fire' }));
  assert.equal(result.error, "Could not save the invoice settings. Try again.");
  assert.doesNotMatch(result.error, /fire|relation/);
  assert.equal(logged.length, 1);
});

test("a database refusal on save is reported as a mapped message", async () => {
  const supabase = fakeSupabase({ updateError: { code: "55006", message: "The starting invoice number cannot be changed once an invoice has been issued." } });
  const result = await saveInvoiceSettings(supabase, { input: GOOD });
  assert.equal(result.code, "55006");
  assert.match(result.error, /starting invoice number cannot be changed/);
});

// ---- SIGNATURE ------------------------------------------------------------------------------------

test("the signature goes to the private invoice-assets bucket", () => {
  assert.equal(SIGNATURE_BUCKET, "invoice-assets");
  assert.notEqual(SIGNATURE_BUCKET, "profile-photos");
});

test("the path is signatures/<uuid>.<extension>, the extension from the verified type", () => {
  const uuid = "123e4567-e89b-42d3-a456-426614174000";
  assert.equal(signaturePathFor(png(10, "x.png", "image/png"), uuid), `signatures/${uuid}.png`);
  assert.equal(signaturePathFor(png(10, "x", "image/jpeg"), uuid), `signatures/${uuid}.jpg`);
  assert.equal(signaturePathFor(png(10, "evil.exe", "image/webp"), uuid), `signatures/${uuid}.webp`, "never from the file name");
  assert.match(signaturePathFor(png()), /^signatures\/[0-9a-f-]{36}\.png$/);
  assert.notEqual(signaturePathFor(png()), signaturePathFor(png()), "a fresh object every time");
});

test("only JPG, PNG and WebP up to 2 MB are accepted", () => {
  const read = (file) => {
    const form = new FormData();
    form.set("photo", file);
    return readSignatureFromForm(form);
  };
  assert.equal(read(png(100, "a.png", "image/png")).error, null);
  assert.equal(read(png(100, "a.jpg", "image/jpeg")).error, null);
  assert.equal(read(png(100, "a.webp", "image/webp")).error, null);
  assert.equal(read(png(2 * 1024 * 1024, "big.png")).error, null, "exactly 2 MB is allowed");
  assert.equal(read(png(2 * 1024 * 1024 + 1, "big.png")).error, "The signature is too large. Choose an image of 2 MB or less.");
  assert.equal(read(png(100, "a.gif", "image/gif")).error, "Choose a JPG, PNG or WebP image.");
  assert.equal(read(png(100, "a.pdf", "application/pdf")).error, "Choose a JPG, PNG or WebP image.");
  assert.equal(read(png(0, "empty.png")).error, "That file is empty. Choose a different image.");
});

test("an untouched file input and a removal are read from the form", () => {
  const untouched = new FormData();
  untouched.set("photo", new File([], ""));
  assert.deepEqual(readSignatureFromForm(untouched), { file: null, remove: false, error: null });

  const removal = new FormData();
  removal.set("remove_photo", "1");
  assert.deepEqual(readSignatureFromForm(removal), { file: null, remove: true, error: null });
});

test("upload: private bucket, new object, never overwriting", async () => {
  const supabase = fakeSupabase();
  const result = await uploadSignature(supabase, png());
  assert.match(result.path, /^signatures\//);
  const [upload] = supabase.calls.uploads;
  assert.equal(upload.bucket, "invoice-assets");
  assert.equal(upload.path, result.path);
  assert.equal(upload.options.upsert, false);
  assert.equal(upload.type, "image/png");

  const { result: failed } = await quietly(() => uploadSignature(fakeSupabase({ uploadError: { name: "StorageError", message: "no" } }), png()));
  assert.equal(failed.error, "Could not upload the signature. Check your connection and try again.");
});

test("a signed preview URL is generated for the stored path, valid for one hour", async () => {
  assert.equal(SIGNATURE_URL_TTL_SECONDS, 3600);
  const supabase = fakeSupabase();
  const url = await createSignatureUrl(supabase, "signatures/a.png");
  assert.match(url, /^https:\/\/signed\.example\/signatures\/a\.png/);
  assert.deepEqual(supabase.calls.signed, [{ bucket: "invoice-assets", path: "signatures/a.png", seconds: 3600 }]);

  assert.equal(await createSignatureUrl(supabase, null), null);
  assert.equal(supabase.calls.signed.length, 1, "no path, no signing");
  const { result } = await quietly(() => createSignatureUrl(fakeSupabase({ signError: { name: "e", message: "m" } }), "signatures/a.png"));
  assert.equal(result, null, "the page does not fail because a preview could not be signed");
});

test("replace: uploads a new object and patches only signature_path", async () => {
  const supabase = fakeSupabase();
  const staged = await stageSignatureChange(supabase, { file: png(), remove: false });
  assert.deepEqual(Object.keys(staged.patch), ["signature_path"]);
  assert.match(staged.patch.signature_path, /^signatures\/.+\.png$/);
  assert.equal(supabase.calls.uploads.length, 1);
});

test("remove: sets signature_path to NULL and uploads nothing", async () => {
  const supabase = fakeSupabase();
  const staged = await stageSignatureChange(supabase, { file: null, remove: true });
  assert.deepEqual(staged.patch, { signature_path: null });
  assert.equal(supabase.calls.uploads.length, 0);
});

test("a new file wins over a removal; no change writes nothing", async () => {
  const both = await stageSignatureChange(fakeSupabase(), { file: png(), remove: true });
  assert.match(both.patch.signature_path, /^signatures\//);
  assert.deepEqual((await stageSignatureChange(fakeSupabase(), { file: null, remove: false })).patch, {});
});

test("a failed upload stops the save with an error and writes nothing", async () => {
  const supabase = fakeSupabase({ uploadError: { name: "StorageError", message: "no" } });
  const { result } = await quietly(() => saveInvoiceSettings(supabase, { input: GOOD, signature: { file: png(), remove: false, error: null } }));
  assert.match(result.error, /Could not upload the signature/);
  assert.equal(supabase.calls.updates.length, 0);
});

test("saving with a new signature updates only signature_path among the signature fields; with a removal, sets it NULL", async () => {
  const replace = fakeSupabase();
  await saveInvoiceSettings(replace, { input: GOOD, signature: { file: png(), remove: false, error: null } });
  assert.match(replace.calls.updates[0].payload.signature_path, /^signatures\//);

  const remove = fakeSupabase();
  await saveInvoiceSettings(remove, { input: GOOD, signature: { file: null, remove: true, error: null } });
  assert.equal(remove.calls.updates[0].payload.signature_path, null);
  assert.equal(remove.calls.uploads.length, 0);
});

test("a rejected signature file is a field error on the card, and nothing is uploaded or saved", async () => {
  const supabase = fakeSupabase();
  const result = await saveInvoiceSettings(supabase, {
    input: GOOD,
    signature: { file: png(10, "a.gif", "image/gif"), remove: false, error: "Choose a JPG, PNG or WebP image." },
  });
  assert.equal(result.fieldErrors.photo, "Choose a JPG, PNG or WebP image.");
  assert.equal(supabase.calls.uploads.length, 0);
  assert.equal(supabase.calls.updates.length, 0);
});

test("a signature object is NEVER deleted: not on replace, not on remove, not on a failed save", async () => {
  const supabase = fakeSupabase({ updateError: { code: "XX000", message: "boom" } });
  await quietly(async () => {
    await saveInvoiceSettings(supabase, { input: GOOD, signature: { file: png(), remove: false, error: null } });
    await saveInvoiceSettings(supabase, { input: GOOD, signature: { file: null, remove: true, error: null } });
  });
  assert.deepEqual(supabase.calls.removes, []);

  for (const file of ["./signature.js", "./settings-core.js", "./actions.js", "./data.js"]) {
    assert.doesNotMatch(code(file), /\.remove\(|\.delete\(|deleteProfilePhoto/, file);
  }
});

// ---- AUTHORIZATION -------------------------------------------------------------------------------------

test("the page, the data functions and the action each require the Admin role first", () => {
  const page = code("../../app/settings/invoice-receipt/page.js");
  assert.match(page, /export default async function InvoiceReceiptSettingsPage\([^)]*\) \{\s*await requireRole\(ROLES\.ADMIN\);/);

  const data = code("./data.js");
  assert.match(data, /^import "server-only";/);
  for (const name of ["getInvoiceSettings", "hasAnyInvoice", "getSignaturePreviewUrl"]) {
    const start = data.indexOf(`export async function ${name}(`);
    assert.ok(start > 0, name);
    const body = data.slice(start, data.indexOf("\n}\n", start));
    assert.ok(body.indexOf("await requireRole(ROLES.ADMIN)") > 0, `${name} guards`);
    assert.ok(body.indexOf("requireRole") < body.indexOf("createClient"), `${name} guards before the client`);
  }

  const actions = code("./actions.js");
  assert.match(actions, /^"use server";/);
  const action = actions.slice(actions.indexOf("export async function updateInvoiceSettings("));
  assert.match(action, /\{\s*await requireRole\(ROLES\.ADMIN\);/);
  assert.ok(action.indexOf("requireRole") < action.indexOf("createClient"));
});

test("everything uses the session client — never the service-role client", () => {
  for (const file of ["./actions.js", "./data.js", "./settings-core.js", "./signature.js"]) {
    assert.doesNotMatch(code(file), /supabase\/admin|createAdminClient|SECRET_KEY|service_role/, file);
  }
  assert.match(code("./actions.js"), /from "@\/lib\/supabase\/server"/);
});

test("the action redirects to ?success=updated on success, like Center Profile", () => {
  const actions = code("./actions.js");
  assert.match(actions, /revalidatePath\(INVOICE_SETTINGS_PATH\);\s*redirect\(`\$\{INVOICE_SETTINGS_PATH\}\?success=updated`\);/);
  assert.match(actions, /const INVOICE_SETTINGS_PATH = "\/settings\/invoice-receipt";/);
  assert.match(code("../../app/settings/invoice-receipt/page.js"), /updated: "Invoice \/ Receipt settings updated successfully\."/);
});

// ---- SETTINGS WIRING ---------------------------------------------------------------------------------------

test("Settings has exactly four tabs, in order, and the chrome's TAB_PAGES matches", () => {
  const tabs = code("../../app/settings/settings-tabs.js");
  const hrefs = [...tabs.matchAll(/href: "([^"]+)" \}/g)].map((m) => m[1]);
  assert.deepEqual(hrefs, [
    "/settings/center-profile",
    "/settings/invoice-receipt",
    "/settings/instructors",
    "/settings/roles-permissions",
  ]);
  assert.match(tabs, /\{ key: "invoice-receipt", label: "Invoice \/ Receipt", href: "\/settings\/invoice-receipt" \}/);

  const chrome = code("../../app/settings/settings-chrome.js");
  const pages = chrome.match(/TAB_PAGES = \[([\s\S]*?)\]/)[1].match(/"[^"]+"/g).map((s) => s.slice(1, -1));
  assert.deepEqual(pages, hrefs);
  assert.ok(existsSync(new URL("../../app/settings/invoice-receipt/page.js", import.meta.url)));
});

test("docs/02-ux.md describes the four-tab Settings structure", () => {
  const ux = source("../../docs/02-ux.md");
  assert.match(ux, /├── Center Profile\r?\n├── Invoice \/ Receipt\r?\n├── Instructors\r?\n└── Roles & Permissions/);
  assert.doesNotMatch(ux, /the three Settings tabs are unchanged/);
});

test("no Center Profile field is duplicated in Invoice / Receipt Settings", () => {
  const owned = ["name", "logo_url", "address", "phone", "email", "timezone", "currency"];
  for (const file of ["../../app/settings/invoice-receipt/invoice-receipt-form.js", "./validation.js", "./settings-core.js", "./actions.js"]) {
    const text = code(file);
    for (const field of owned) {
      assert.doesNotMatch(text, new RegExp(`name="${field}"|formData\\.get\\("${field}"\\)|\\b${field}:\\s`), `${file}: ${field}`);
    }
  }
  const form = code("../../app/settings/invoice-receipt/invoice-receipt-form.js");
  assert.match(form, /<Link href="\/settings\/center-profile"/);
});

test("the form manages settings only: no invoice-number or tax arithmetic anywhere in the new code", () => {
  for (const file of [
    "../../app/settings/invoice-receipt/invoice-receipt-form.js",
    "../../app/settings/invoice-receipt/page.js",
    "./validation.js",
    "./settings-core.js",
    "./signature.js",
    "./data.js",
    "./actions.js",
  ]) {
    const text = code(file);
    assert.doesNotMatch(text, /next_invoice_number\s*[:=]|nextInvoiceNumber|Math\.max|Math\.min|\.reduce\(/, file);
    assert.doesNotMatch(text, /[a-z_]*(starting|invoice)[a-z_]*\s*[-+*]\s*\d|\+\s*1\b.*invoice/i, file);
    assert.doesNotMatch(text, /Math\.(round|floor|ceil|trunc)|\.toFixed\(|\(\s*100\s*\+|tax_?rate\s*[*/]|[*/]\s*tax_?rate/i, file);
  }
  // The counter is only ever named to say it is not written.
  const writes = [...code("./settings-core.js").matchAll(/next_invoice_number/g)];
  assert.equal(writes.length, 0, "settings-core never mentions the counter in code");
});

test("the signature uses the existing visual card, with the signature-specific storage", () => {
  const form = code("../../app/settings/invoice-receipt/invoice-receipt-form.js");
  assert.match(form, /import ProfilePhotoCard from "@\/components\/ui\/profile-photo-card";/);
  assert.match(form, /<ProfilePhotoCard\s+name=""\s+label="Signature"\s+noun="Signature"/);
  assert.match(form, /fit="contain"/);
  assert.match(form, /currentUrl=\{signatureUrl\}/);
  // …but none of the public profile-photo storage.
  for (const file of ["./actions.js", "./settings-core.js", "./signature.js", "./data.js"]) {
    assert.doesNotMatch(code(file), /photo-staging|profile-photos|stagePhotoChange|uploadProfilePhoto|getPublicUrl/, file);
  }
});

test("the starting number: locked state is disabled and unnamed; the confirmation is only for setting or changing it", () => {
  const form = code("../../app/settings/invoice-receipt/invoice-receipt-form.js");
  assert.match(form, /startingLocked \? \(\s*<Input \{\.\.\.field\} disabled readOnly value=/);
  assert.match(form, /name="starting_invoice_number"/);
  // The locked input carries no name, so it is never submitted.
  const locked = form.match(/startingLocked \? \(\s*(<Input [^>]*\/>)/);
  assert.ok(locked, "the locked input");
  assert.doesNotMatch(locked[1], /name=/);
  assert.match(form, /if \(startingLocked\) return;/);
  assert.match(form, /next !== null && next !== \(settings\?\.starting_invoice_number \?\? null\)/);
  assert.match(form, /<ConfirmDialog/);
  assert.equal((form.match(/<ConfirmDialog/g) ?? []).length, 1);
  assert.match(form, /Once the first invoice is issued, the starting number is locked and cannot be changed\./);
  // The essential state is always visible; the explanation is in the (i) help.
  assert.match(form, /Locked — invoices have been issued\./);
  assert.match(form, /Not set — invoices are not issued automatically\./);
  assert.match(form, /Enter the next number after your last existing invoice\. For example, if your last invoice\s+was 1223, enter 1224\. Once the first invoice is issued, the starting number cannot be\s+changed\./);
  assert.doesNotMatch(form, /next_invoice_number/, "the counter is never displayed");
});

test("tax: fields stay visible and disabled when off, keep their stored values, and show only a concise state message", () => {
  const form = code("../../app/settings/invoice-receipt/invoice-receipt-form.js");
  // Disabled, not removed: both inputs are always rendered, with the stored values as their defaults.
  assert.equal((form.match(/disabled=\{isPending \|\| !taxEnabled\}/g) ?? []).length, 2);
  assert.match(form, /defaultValue=\{state\?\.values\?\.tax_name \?\? settings\?\.tax_name \?\? ""\}/);
  assert.match(form, /defaultValue=\{state\?\.values\?\.tax_rate \?\? settings\?\.tax_rate \?\? ""\}/);
  assert.match(form, /\{!taxEnabled \? \(\s*<p className="text-small text-text-secondary">Tax is not shown on new invoices\.<\/p>\s*\) : null\}/);
  assert.match(form, /<Switch\s+name="tax_enabled"\s+value="1"\s+uncheckedValue="0"/);
  assert.match(form, /<Label id="tax_enabled-label">Enable tax on new invoices<\/Label>/);
  // No duplicate "Tax" heading beside the panel title, no on/off caption, no section description.
  assert.doesNotMatch(form, /<Label id="tax_enabled-label">Tax<\/Label>/);
  assert.doesNotMatch(form, /Tax enabled<|Tax not enabled/);
  assert.doesNotMatch(form, /description="Optional tax/);
});

test("tax: no example placeholders and no permanent explanatory paragraph", () => {
  const form = code("../../app/settings/invoice-receipt/invoice-receipt-form.js");
  assert.doesNotMatch(form, /placeholder="e\.g\./);
  assert.doesNotMatch(form, /placeholder=/, "no placeholder anywhere: the labels say what each field is");
  // The explanation exists once, and only inside the help popover.
  const sentence = /Prices include tax\. The membership amount is the final amount paid by the customer\. Tax is\s+calculated from that amount when the invoice is issued\./g;
  assert.equal((form.match(sentence) ?? []).length, 1);
  const help = form.match(/<HelpPopover label="About tax" title="About tax">([\s\S]*?)<\/HelpPopover>/);
  assert.ok(help, "the tax help control");
  assert.match(help[1], sentence);
  assert.doesNotMatch(form, /Prices include tax:/, "the old permanent paragraph is gone");
});

test("the help control: an accessible (i) button that opens a compact popover with a close control", () => {
  const form = code("../../app/settings/invoice-receipt/invoice-receipt-form.js");
  const help = form.slice(form.indexOf("function HelpPopover("), form.indexOf("export default function InvoiceReceiptForm"));

  // The project's own Popover, not a modal and not a new component library.
  assert.match(form, /from "@\/components\/ui\/popover";/);
  assert.match(help, /<Popover open=\{open\} onOpenChange=\{setOpen\}>/);
  assert.doesNotMatch(help, /Dialog|ConfirmDialog/);
  // The trigger is a labelled, keyboard-reachable button; the close is a labelled button.
  assert.match(help, /<button\s+type="button"\s+aria-label=\{label\}/);
  assert.match(help, /<button\s+type="button"\s+aria-label="Close"\s+onClick=\{\(\) => setOpen\(false\)\}/);
  assert.match(help, /<Info className="size-4" aria-hidden="true" \/>/);
  assert.match(help, /<X className="size-4" aria-hidden="true" \/>/);
  // The trigger keeps rendering after a close, so the explanation can be opened again.
  assert.equal((help.match(/<PopoverTrigger/g) ?? []).length, 1);
  assert.match(help, /const \[open, setOpen\] = useState\(false\);/, "closed by default");
});

test("the help control cannot submit or alter the form", () => {
  const form = code("../../app/settings/invoice-receipt/invoice-receipt-form.js");
  const help = form.slice(form.indexOf("function HelpPopover("), form.indexOf("export default function InvoiceReceiptForm"));
  // Every button in it is type="button", it carries no name (so it submits no value), and it touches no form state.
  assert.equal((help.match(/<button/g) ?? []).length, 2);
  assert.equal((help.match(/<button\s+type="button"/g) ?? []).length, 2);
  assert.doesNotMatch(help, /name=|formRef|formAction|requestSubmit|setFieldErrors|setTaxEnabled|FormData/);
  // The submit path is unchanged: the same action, handlers and Save button.
  assert.match(form, /action=\{submitForm\}\s+onSubmit=\{handleSubmit\}\s+onBlur=\{handleBlur\}\s+onReset=\{handleReset\}/);
  assert.match(form, /<Button type="submit" disabled=\{isPending\}>/);
  assert.equal((form.match(/<form\b/g) ?? []).length, 1);
});

test("on a phone the help opens above its (i), clear of the screen edges, and stays an overlay", () => {
  const form = code("../../app/settings/invoice-receipt/invoice-receipt-form.js");
  const help = form.slice(form.indexOf("function HelpPopover("), form.indexOf("export default function InvoiceReceiptForm"));

  // The same narrow breakpoint (below sm) and server-safe approach as the Students / Memberships search hints.
  assert.match(form, /const NARROW_QUERY = "\(max-width: 639px\)";/);
  assert.match(form, /const getNarrowServer = \(\) => false;/);
  assert.match(help, /const narrow = useSyncExternalStore\(subscribeNarrow, getNarrow, getNarrowServer\);/);
  // Desktop keeps "below"; a phone opens "above" (Base UI flips it if there is no room).
  assert.match(help, /side=\{narrow \? "top" : "bottom"\}/);
  assert.match(help, /align="start"/);
  // Side margins on a phone only, and a narrower maximum so the popup is never wider than the screen minus its gutters.
  assert.match(help, /className="max-sm:mx-4 max-sm:max-w-\[calc\(100vw-4\.5rem\)\]"/);
  // Still the project's Popover — an overlay: no modal, no layout space reserved, no fixed full-screen sizing.
  assert.match(form, /from "@\/components\/ui\/popover";/);
  assert.doesNotMatch(help, /Dialog|Sheet|inset-0|h-screen|w-screen|fixed/);
  // One component serves both help controls, so the Starting Invoice Number and Tax popovers behave alike.
  assert.equal((form.match(/function HelpPopover\(/g) ?? []).length, 1);
  assert.equal((form.match(/<HelpPopover /g) ?? []).length, 3);
  // The help text and both controls are unchanged.
  assert.match(help, /aria-label=\{label\}/);
  assert.match(help, /aria-label="Close"/);
});

test("help is used selectively: only the starting number, the prefix and tax have it", () => {
  const form = code("../../app/settings/invoice-receipt/invoice-receipt-form.js");
  const uses = [...form.matchAll(/<HelpPopover label="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(uses, ["About the starting invoice number", "About the invoice number prefix", "About tax"]);
  // The help for the starting number sits beside its label (a button must not live inside a <label>).
  assert.match(form, /<Label htmlFor="starting_invoice_number">Starting Invoice Number<\/Label>\s*<HelpPopover/);
});

test("help and state text is muted, never red: red is only for errors", () => {
  const form = code("../../app/settings/invoice-receipt/invoice-receipt-form.js");
  const help = form.slice(form.indexOf("function HelpPopover("), form.indexOf("export default function InvoiceReceiptForm"));
  assert.doesNotMatch(help, /text-danger|text-destructive|red-/);
  assert.match(help, /text-small mt-1 text-text-secondary/);
  // The only danger-coloured text in the form is the error banner.
  const dangerLines = form.split("\n").filter((line) => /text-danger|text-destructive/.test(line));
  assert.equal(dangerLines.length, 1);
  assert.match(dangerLines[0], /rounded-input border border-danger\/30 bg-danger\/5 px-3 py-2 text-danger/);
});

test("other sections are decluttered: no redundant panel descriptions or card description", () => {
  const form = code("../../app/settings/invoice-receipt/invoice-receipt-form.js");
  assert.doesNotMatch(form, /description="How the document is titled/);
  assert.doesNotMatch(form, /description="Terms and the signatory/);
  assert.doesNotMatch(form, /description="Used on invoices issued from now on\./);
  // The footer still says changes apply to future invoices and links to Center Profile.
  assert.match(form, /Changes apply to invoices issued from now on\./);
  assert.match(form, /<Link href="\/settings\/center-profile"/);
});

test("the footer says changes apply to future invoices and links to Center Profile", () => {
  const form = code("../../app/settings/invoice-receipt/invoice-receipt-form.js");
  assert.match(form, /Changes apply to invoices issued from now on\. Issued invoices keep the details they were issued\s+with\./);
  assert.match(form, /Center name, address, phone, email and logo come from/);
});

test("the layout follows Center Profile: the same grid, panels, and responsive stacking", () => {
  const form = code("../../app/settings/invoice-receipt/invoice-receipt-form.js");
  assert.match(form, /grid gap-6 lg:grid-cols-5/);
  assert.match(form, /flex flex-col gap-6 lg:col-span-3/);
  assert.match(form, /w-full self-start lg:col-span-2/);
  for (const title of ["Document", "Tax", "Document Content"]) assert.match(form, new RegExp(`title="${title}"`));
  assert.match(form, /<Button type="reset" variant="outline"/);
  assert.match(form, /\{isPending \? "Saving…" : "Save Changes"\}/);
  assert.match(form, /useActionState\(action, \{\}\)/);
});

// ---- REGRESSION -------------------------------------------------------------------------------------------------

test("Center Profile is unchanged by this phase", () => {
  const form = code("../../app/settings/center-profile/center-profile-form.js");
  for (const name of ["name", "address", "phone", "email"]) assert.match(form, new RegExp(`name="${name}"`));
  assert.match(form, /import \{ useProfilePhoto \} from "@\/components\/ui\/profile-photo-field";/);
  assert.doesNotMatch(form, /invoice/i);
  assert.doesNotMatch(code("../center-profile/actions.js"), /invoice/i);
  assert.match(code("../storage/photo-staging.js"), /PROFILE_PHOTO_BUCKET/);
  assert.doesNotMatch(code("../storage/photo-staging.js"), /invoice-assets/);
});

test("the Membership UI and the Phase 1 / Phase 2 invoice code do not depend on the settings code", () => {
  const files = [
    ...readdirSync(new URL("../invoices/", import.meta.url)).filter((f) => f.endsWith(".js") && !f.endsWith(".test.js")).map((f) => `../invoices/${f}`),
    "../../app/memberships/membership-form.js",
    "../../app/memberships/[id]/page.js",
    "../../app/memberships/[id]/invoice-panel.js",
    "../../app/memberships/[id]/issue-invoice.js",
  ];
  for (const file of files) {
    if (file === "../invoices/document-data.js") continue; // the one reuse, below
    assert.doesNotMatch(source(file), /invoice-settings/, file);
  }
  // The stored-invoice view reuses ONLY the signature link helper from the settings code (no settings data or core).
  const documentData = code("../invoices/document-data.js");
  assert.deepEqual([...documentData.matchAll(/@\/lib\/invoice-settings\/([\w-]+)/g)].map((m) => m[1]), ["signature"]);
  // Phase 1 still exposes exactly its two RPCs.
  const core = code("../invoices/invoice-core.js");
  assert.deepEqual([...core.matchAll(/\.rpc\("([a-z_]+)"/g)].map((m) => m[1]).sort(), ["issue_invoice", "update_invoice_details"]);
});

test("Phase 3 adds no invoice screen, PDF, print, share or WhatsApp", () => {
  for (const file of ["../../app/settings/invoice-receipt/invoice-receipt-form.js", "../../app/settings/invoice-receipt/page.js", "./actions.js", "./data.js", "./settings-core.js", "./signature.js"]) {
    assert.doesNotMatch(code(file), /window\.print|navigator\.share|wa\.me|react-pdf|issue_invoice|update_invoice_details/i, file);
  }
  assert.equal(existsSync(new URL("../../app/invoices", import.meta.url)), false);
  assert.deepEqual(readdirSync(new URL("../../app/settings/invoice-receipt/", import.meta.url)).sort(), ["bank-accounts.js", "invoice-receipt-form.js", "page.js"]);
  assert.deepEqual(readdirSync(new URL(".", import.meta.url)).filter((f) => !f.endsWith(".test.js")).sort(), ["actions.js", "data.js", "settings-core.js", "signature.js", "validation.js"]);
});

// ==== INVOICE NUMBER PREFIX (Phase 4E) ===========================================================

const PREFIX_FORM = "../../app/settings/invoice-receipt/invoice-receipt-form.js";

test("prefix validation: an empty input means no prefix (null) — never an empty string", () => {
  for (const blank of ["", undefined, null]) {
    const result = check({ invoice_prefix: blank });
    assert.equal(result.success, true, String(blank));
    assert.equal(result.data.invoice_prefix, null, String(blank));
  }
  assert.equal(check({}).data.invoice_prefix, null, "an absent field is no prefix");
});

test("prefix validation: valid prefixes are saved exactly as typed", () => {
  for (const prefix of ["INV-", "INV/", "YC-", "FY26-", "Receipt-", "Yoga Center-", "A"]) {
    const result = check({ invoice_prefix: prefix });
    assert.equal(result.success, true, prefix);
    assert.equal(result.data.invoice_prefix, prefix);
  }
});

test("prefix validation: internal spaces are accepted", () => {
  assert.equal(check({ invoice_prefix: "Yoga Center-" }).data.invoice_prefix, "Yoga Center-");
  assert.equal(check({ invoice_prefix: "FY 26 / " + "A" }).success, true);
});

test("prefix validation: leading and trailing whitespace is rejected, not trimmed", () => {
  for (const bad of [" INV-", "INV- ", "  INV-", "\tINV-", "INV-\t", "\nINV-", "INV-\n", " ", "   "]) {
    const result = check({ invoice_prefix: bad });
    assert.equal(result.success, false, JSON.stringify(bad));
    assert.equal(result.errors.invoice_prefix, "The prefix cannot start or end with a space.", JSON.stringify(bad));
  }
});

test("prefix validation: a prefix ending in a digit is rejected", () => {
  for (const bad of ["INV123", "1", "INV-2", "FY26"]) {
    const result = check({ invoice_prefix: bad });
    assert.equal(result.success, false, bad);
    assert.equal(result.errors.invoice_prefix, "The prefix cannot end with a number.", bad);
  }
  // A digit that is not last is fine.
  assert.equal(check({ invoice_prefix: "FY26-" }).success, true);
  assert.equal(check({ invoice_prefix: "2026/A" }).success, true);
});

test("prefix validation: at most 20 characters", () => {
  assert.equal(MAX_INVOICE_PREFIX_LENGTH, 20);
  assert.equal(check({ invoice_prefix: "A".repeat(20) }).success, true);
  const tooLong = check({ invoice_prefix: "A".repeat(21) });
  assert.equal(tooLong.success, false);
  assert.equal(tooLong.errors.invoice_prefix, "The prefix can have at most 20 characters.");
  // Characters, not UTF-16 units: 20 emoji is 20 characters.
  assert.equal(check({ invoice_prefix: "\u{1F9D8}".repeat(20) }).success, true);
  assert.equal(check({ invoice_prefix: "\u{1F9D8}".repeat(21) }).success, false);
});

test("prefix validation does not invent other rules: punctuation, letters and symbols are all allowed", () => {
  for (const prefix of ["#", "INV#", "№-", "Fac.-", "A&B/", "(YC)-", "INV_"]) {
    assert.equal(check({ invoice_prefix: prefix }).success, true, prefix);
  }
});

test("prefix validation reports its error beside the other errors, and does not disturb the other fields", () => {
  const result = check({ invoice_prefix: "INV1", terms: "x".repeat(2001) });
  assert.deepEqual(Object.keys(result.errors).sort(), ["invoice_prefix", "terms"]);
  const ok = check({ invoice_prefix: "INV-" });
  assert.equal(ok.data.document_title, "invoice");
  assert.equal(ok.data.starting_invoice_number, 1224);
});

test("the prefix is read and written as a settings column, and is not locked by existing invoices", async () => {
  assert.ok(WRITABLE_COLUMNS.includes("invoice_prefix"));
  assert.ok(INVOICE_SETTINGS_COLUMNS.split(", ").includes("invoice_prefix"));
  assert.equal(WRITABLE_COLUMNS.includes("next_invoice_number"), false);

  // With invoices existing (the starting number is locked), the prefix is still written.
  const supabase = fakeSupabase({ invoiceCount: 3 });
  const result = await saveInvoiceSettings(supabase, { input: { ...GOOD, invoice_prefix: "YC-" } });
  assert.equal(result.success, true);
  assert.equal(supabase.calls.updates[0].payload.invoice_prefix, "YC-");
  assert.equal("starting_invoice_number" in supabase.calls.updates[0].payload, false, "the starting number stays locked");
});

test("saving a prefix writes INV-; clearing the field saves NULL — never an empty string", async () => {
  const set = fakeSupabase({ invoiceCount: 0 });
  await saveInvoiceSettings(set, { input: { ...GOOD, invoice_prefix: "INV-" } });
  assert.equal(set.calls.updates[0].payload.invoice_prefix, "INV-");

  const cleared = fakeSupabase({ invoiceCount: 0 });
  await saveInvoiceSettings(cleared, { input: { ...GOOD, invoice_prefix: "" } });
  assert.equal(Object.hasOwn(cleared.calls.updates[0].payload, "invoice_prefix"), true);
  assert.equal(cleared.calls.updates[0].payload.invoice_prefix, null);
  assert.notEqual(cleared.calls.updates[0].payload.invoice_prefix, "");
});

test("an invalid prefix never reaches the database", async () => {
  const supabase = fakeSupabase();
  const result = await saveInvoiceSettings(supabase, { input: { ...GOOD, invoice_prefix: "INV- " } });
  assert.equal(result.error, "Check the highlighted fields.");
  assert.deepEqual(Object.keys(result.fieldErrors), ["invoice_prefix"]);
  assert.equal(supabase.calls.updates.length, 0);
});

test("updating the prefix leaves every other setting as it was submitted", async () => {
  const input = {
    ...GOOD,
    invoice_prefix: "YC-",
    tax_enabled: "1",
    tax_name: "GST",
    tax_rate: "18",
    terms: "Pay in advance",
    signatory_name: "A. Teacher",
    signatory_designation: "Director",
  };
  const supabase = fakeSupabase({ invoiceCount: 0 });
  await saveInvoiceSettings(supabase, { input });
  assert.deepEqual(supabase.calls.updates[0].payload, {
    document_title: "invoice",
    starting_invoice_number: 1224,
    invoice_prefix: "YC-",
    tax_enabled: true,
    tax_name: "GST",
    tax_rate: 18,
    terms: "Pay in advance",
    signatory_name: "A. Teacher",
    signatory_designation: "Director",
  });
  // No signature change was staged by a prefix edit.
  assert.equal("signature_path" in supabase.calls.updates[0].payload, false);
  assert.equal(supabase.calls.uploads.length, 0);
});

test("the starting number behaves exactly as before: locked ignores it, unlocked saves it, blank clears it", async () => {
  const locked = fakeSupabase({ invoiceCount: 1 });
  await saveInvoiceSettings(locked, { input: { ...GOOD, starting_invoice_number: "9999", invoice_prefix: "INV-" } });
  assert.equal("starting_invoice_number" in locked.calls.updates[0].payload, false);

  const open = fakeSupabase({ invoiceCount: 0 });
  await saveInvoiceSettings(open, { input: { ...GOOD, starting_invoice_number: "786", invoice_prefix: "INV-" } });
  assert.equal(open.calls.updates[0].payload.starting_invoice_number, 786);

  const blank = fakeSupabase({ invoiceCount: 0 });
  await saveInvoiceSettings(blank, { input: { ...GOOD, starting_invoice_number: "", invoice_prefix: "INV-" } });
  assert.equal(blank.calls.updates[0].payload.starting_invoice_number, null);
  // The two are independent settings, never combined into one value.
  assert.equal(open.calls.updates[0].payload.invoice_prefix, "INV-");
  assert.notEqual(String(open.calls.updates[0].payload.starting_invoice_number), "INV-786");
});

test("changing the prefix never touches an invoice: only invoice_settings is written, and invoices are only counted", async () => {
  const supabase = fakeSupabase({ invoiceCount: 2 });
  await saveInvoiceSettings(supabase, { input: { ...GOOD, invoice_prefix: "YC-" } });

  assert.deepEqual(supabase.calls.updates.map((u) => u.table), ["invoice_settings"]);
  const invoiceReads = supabase.calls.queries.filter((q) => q.table === "invoices");
  assert.equal(invoiceReads.length, 1);
  assert.equal(invoiceReads[0].select, "id");
  assert.deepEqual(invoiceReads[0].options, { count: "exact", head: true });
  assert.equal(supabase.calls.removes.length, 0);
});

test("the database's own prefix constraint is mapped to a message on the prefix field", () => {
  const mapped = mapSettingsError({
    code: "23514",
    message: 'new row for relation "invoice_settings" violates check constraint "invoice_settings_invoice_prefix_valid"',
  });
  assert.deepEqual(Object.keys(mapped.fieldErrors), ["invoice_prefix"]);
  assert.doesNotMatch(mapped.error, /violates|constraint|relation/);
});

test("the Settings screen: a labelled prefix input beside the starting number, with the existing help pattern, and no switch", () => {
  const form = code(PREFIX_FORM);
  assert.match(form, /<Label htmlFor="invoice_prefix">Invoice Number Prefix<\/Label>\s*<HelpPopover label="About the invoice number prefix" title="Invoice number prefix">/);
  assert.match(form, /Optional prefix used for new invoices\. Changing the prefix affects future invoices only;\s+existing invoices keep their original prefix\./);
  assert.match(form, /name="invoice_prefix"/);
  // Placed after the Starting Invoice Number field and before the Tax panel, in the Document panel.
  assert.ok(form.indexOf('name="starting_invoice_number"') < form.indexOf('name="invoice_prefix"'));
  assert.ok(form.indexOf('name="invoice_prefix"') < form.indexOf('title="Tax"'));
  // No enable / disable control: prefix OFF is simply an empty input.
  assert.doesNotMatch(form, /prefix_enabled|name="invoice_prefix_enabled"|Enable (the )?prefix/i);
  assert.equal((form.match(/<Switch\b/g) ?? []).length, 1, "the only switch is the tax switch");
  // No placeholder, no permanent explanatory paragraph.
  assert.doesNotMatch(form, /placeholder=/);
});

test("the prefix input loads from the saved SETTING: NULL shows empty, INV- shows INV-, YC- shows YC-", () => {
  const form = code(PREFIX_FORM);
  const expression = form.match(/name="invoice_prefix"[\s\S]*?defaultValue=\{([^}]+)\}/)?.[1];
  assert.ok(expression, "the input's default value");
  // Evaluate the screen's own expression for each saved state.
  const initial = new Function("state", "settings", `return ${expression};`);
  assert.equal(initial({}, { invoice_prefix: null }), "");
  assert.equal(initial({}, { invoice_prefix: "INV-" }), "INV-");
  assert.equal(initial({}, { invoice_prefix: "YC-" }), "YC-");
  assert.equal(initial({}, {}), "");
  // After a failed save the submitted text comes back (even an empty one), not the stored value.
  assert.equal(initial({ values: { invoice_prefix: "YC-" } }, { invoice_prefix: "INV-" }), "YC-");
  assert.equal(initial({ values: { invoice_prefix: "" } }, { invoice_prefix: "INV-" }), "");
});

test("the Settings UI never derives the prefix from an invoice", () => {
  const files = [PREFIX_FORM, "../../app/settings/invoice-receipt/page.js", "./data.js", "./settings-core.js", "./actions.js", "./validation.js"];
  for (const file of files) {
    const text = code(file);
    assert.doesNotMatch(text, /getInvoice\(|getInvoiceForMembership|fetchInvoice\(|fetchInvoiceForMembership|invoice-number|formatInvoiceNumber|lib\/invoices\//, file);
  }
  // The page reads the setting row, and only asks whether any invoice exists (a count) for the starting-number lock.
  const page = code("../../app/settings/invoice-receipt/page.js");
  assert.match(page, /getInvoiceSettings\(\), hasAnyInvoice\(\)/);
  assert.match(page, /settings=\{settings\}/);
});

test("the prefix feature adds no migration, numbering, invoice, membership or document changes", () => {
  for (const file of ["./actions.js", "./data.js", "./settings-core.js", "./signature.js"]) {
    assert.doesNotMatch(code(file), /next_invoice_number\s*[:=]|issue_invoice|update_invoice_details|window\.print|navigator\.share|wa\.me|react-pdf/, file);
  }
  assert.doesNotMatch(code("./validation.js"), /next_invoice_number|Math\.max|Math\.min/);
  // The existing starting-number lock behaviour is still in the screen.
  const form = code(PREFIX_FORM);
  assert.match(form, /if \(startingLocked\) return;/);
  assert.match(form, /Locked — invoices have been issued\./);
  assert.match(form, /Not set — invoices are not issued automatically\./);
});
