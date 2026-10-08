// Run with `npm test` (Node's built-in test runner).
//
// PDF Phase 6.4 - the Admin-only endpoint GET /memberships/[id]/invoice/pdf. The request flow is
// `handleInvoicePdfRequest` (every collaborator passed in), so its order of steps, its headers and
// its failures are tested for real, with a real PDF rendered; the route file is the thin wrapper
// that supplies the real collaborators and is pinned from source - the project's way for code that
// needs the Next.js runtime.

import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { readFileSync, existsSync } from "node:fs";
import { crc32, deflateSync, inflateSync } from "node:zlib";
import { handleInvoicePdfRequest, invoicePdfFilename } from "./pdf-request.js";
import { renderInvoicePdf } from "./render.js";
import { loadInvoicePdfImages } from "./images.js";
import { buildInvoiceDocument } from "../invoice-document.js";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const ROUTE = "../../../app/memberships/[id]/invoice/pdf/route.js";
const MEMBERSHIP_ID = "11111111-1111-4111-8111-111111111111";

function invoice(overrides = {}) {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    membership_id: MEMBERSHIP_ID,
    invoice_number: 790,
    invoice_prefix: "INV-",
    invoice_date: "2026-10-07",
    payment_date: "2026-10-05",
    document_title: "invoice",
    description: "Monthly Membership",
    plan: "monthly",
    period_start: "2026-10-01",
    period_end: "2026-10-31",
    currency: "INR",
    total_amount: 1180,
    tax_enabled: true,
    tax_name: "GST",
    tax_rate: 18,
    taxable_amount: 1000,
    tax_amount: 180,
    customer_name: "Asha Rao",
    customer_code: "YC-000012",
    customer_phone: "9876543210",
    customer_phone_country_code: "+91",
    customer_email: "asha@example.com",
    business_name: "Sri Yoga Center",
    business_address: "12 Temple Road, Chennai",
    business_phone: "04412345678",
    business_email: "hello@sriyoga.example",
    business_logo_path: "center/logo.png",
    terms: "Fees are non-refundable.",
    signatory_name: "R. Kumar",
    signatory_designation: "Director",
    signature_path: "signatures/sig.png",
    bank_name: "HDFC Bank",
    bank_account_name: "Sri Yoga Center",
    bank_account_number: "50100123456789",
    bank_ifsc_code: "HDFC0001234",
    bank_branch: "Chennai Main",
    ...overrides,
  };
}

/** A real PNG, built by hand. */
function makePng(width = 8, height = 4) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => [30, 64, 175]).flat())]);
  const pixels = deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", pixels), chunk("IEND", Buffer.alloc(0))]);
}

const LOGO_URL = "https://project.supabase.example/storage/v1/object/public/profile-photos/center/logo.png";
const SIGNATURE_URL = "https://project.supabase.example/storage/v1/object/sign/invoice-assets/signatures/sig.png?token=SECRET-TOKEN";

const okImage = (bytes) => ({ ok: true, headers: { get: () => null }, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });

/** The real collaborators, with the database and the network replaced by recorders. */
function setup({ row = invoice(), admin = true, images = "both" } = {}) {
  const calls = [];
  const fetched = [];
  const logoPng = makePng();
  const signaturePng = makePng(24, 10);
  const fetchImpl = async (url) => {
    fetched.push(url);
    if (images === "none") return { ok: false, headers: { get: () => null } };
    if (images === "logo-only" && url === SIGNATURE_URL) return { ok: false, headers: { get: () => null } };
    return okImage(url === SIGNATURE_URL ? signaturePng : logoPng);
  };

  const deps = {
    requireAdmin: async () => {
      calls.push("requireAdmin");
      if (!admin) throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/;307" });
    },
    getInvoice: async (id) => {
      calls.push(`getInvoice:${id}`);
      return row;
    },
    getAssetUrls: async (found) => {
      calls.push("getAssetUrls");
      return { logoUrl: found.business_logo_path ? LOGO_URL : null, signatureUrl: found.signature_path ? SIGNATURE_URL : null };
    },
    loadImages: (urls) => {
      calls.push("loadImages");
      return loadInvoicePdfImages(urls, { fetchImpl });
    },
    render: (doc, imgs) => {
      calls.push("render");
      return renderInvoicePdf(doc, imgs);
    },
  };
  return { deps, calls, fetched };
}

const pdfBytes = async (response) => Buffer.from(await response.arrayBuffer());
const imageObjects = (pdf) => (pdf.toString("latin1").match(/\/Subtype \/Image/g) ?? []).length;

/** The text drawn in a PDF (React-PDF writes glyph ids; the /ToUnicode maps give the characters back). */
function pdfText(buffer) {
  const raw = buffer.toString("latin1");
  const objects = new Map();
  for (const match of raw.matchAll(/(\d+) 0 obj\s*([\s\S]*?)endobj/g)) {
    const [, number, body] = match;
    const start = body.indexOf("stream");
    let stream = null;
    if (start !== -1 && /\/FlateDecode/.test(body.slice(0, start))) {
      const from = match.index + match[0].indexOf(body) + start + "stream".length;
      const begin = raw[from] === "\r" ? from + 2 : from + 1;
      stream = inflateSync(buffer.subarray(begin, raw.indexOf("endstream", begin))).toString("latin1");
    }
    objects.set(Number(number), { dict: start === -1 ? body : body.slice(0, start), stream });
  }
  const decode = (hex) => String.fromCodePoint(...(hex.match(/.{4}/g) ?? []).map((unit) => parseInt(unit, 16)));
  const cmapOf = (id) => {
    const map = new Map();
    const cmap = objects.get(id)?.stream ?? "";
    for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const [, gid, unicode] of block[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi)) map.set(parseInt(gid, 16), decode(unicode));
    }
    for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      for (const [, from, to, list] of block[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*\[([^\]]*)\]/gi)) {
        const units = [...list.matchAll(/<([0-9a-f]+)>/gi)].map((m) => decode(m[1]));
        for (let gid = parseInt(from, 16); gid <= parseInt(to, 16); gid += 1) map.set(gid, units[gid - parseInt(from, 16)]);
      }
    }
    return map;
  };
  const fonts = new Map();
  for (const { dict } of objects.values()) {
    for (const [, name, number] of dict.matchAll(/\/(F\d+) (\d+) 0 R/g)) {
      const toUnicode = objects.get(Number(number))?.dict.match(/\/ToUnicode (\d+) 0 R/)?.[1];
      if (toUnicode) fonts.set(name, cmapOf(Number(toUnicode)));
    }
  }
  const lines = [];
  for (const { stream } of objects.values()) {
    if (!stream || !/ Tf/.test(stream)) continue;
    let font = null;
    for (const op of stream.matchAll(/\/(F\d+) [\d.]+ Tf|\[((?:<[0-9a-f]+>|[-\d.\s])+)\] TJ|<([0-9a-f]+)> Tj/gi)) {
      if (op[1]) {
        font = fonts.get(op[1]);
        continue;
      }
      const hex = (op[2] ?? op[3]).match(/<([0-9a-f]+)>|^([0-9a-f]+)$/gi) ?? [];
      lines.push(hex.map((c) => c.replace(/[<>]/g, "")).map((c) => (c.match(/.{4}/g) ?? []).map((gid) => font?.get(parseInt(gid, 16)) ?? "").join("")).join(""));
    }
  }
  return lines.join(" ").replace(/\s+/g, " ");
}

// ---- authorization -----------------------------------------------------------------------------------------------------------

test("anonymous and Instructor requests are refused before any invoice is read", async () => {
  // requireRole redirects a signed-out visitor to sign in and a non-Admin home; the redirect throws out of the flow.
  const { deps, calls, fetched } = setup({ admin: false });
  await assert.rejects(handleInvoicePdfRequest(MEMBERSHIP_ID, deps), /NEXT_REDIRECT/);
  assert.deepEqual(calls, ["requireAdmin"], "nothing was read, fetched or rendered");
  assert.deepEqual(fetched, []);
});

test("an Admin request is served", async () => {
  const { deps, calls } = setup();
  const response = await handleInvoicePdfRequest(MEMBERSHIP_ID, deps);
  assert.equal(response.status, 200);
  assert.equal(calls[0], "requireAdmin");
});

test("the route asserts the Admin role first, with the project's own requireRole — not a new mechanism", () => {
  const route = code(ROUTE);
  assert.match(route, /import \{ requireRole, ROLES \} from "@\/lib\/auth\/dal";/);
  assert.match(route, /requireAdmin: \(\) => requireRole\(ROLES\.ADMIN\)/);
  assert.match(route, /^import "server-only";/m);
  // And the flow calls it before anything else.
  const flow = code("./pdf-request.js");
  assert.ok(flow.indexOf("await requireAdmin()") < flow.indexOf("await getInvoice("));
});

// ---- the invoice lookup --------------------------------------------------------------------------------------------------------

test("an existing invoice becomes a PDF, looked up by the membership id", async () => {
  const { deps, calls } = setup();
  const response = await handleInvoicePdfRequest(MEMBERSHIP_ID, deps);
  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["requireAdmin", `getInvoice:${MEMBERSHIP_ID}`, "getAssetUrls", "loadImages", "render"]);
});

test("a membership with no invoice is a 404: nothing rendered, no images fetched, no membership data in the answer", async () => {
  const { deps, calls, fetched } = setup({ row: null });
  const response = await handleInvoicePdfRequest(MEMBERSHIP_ID, deps);
  assert.equal(response.status, 404);
  assert.equal(await response.text(), "Invoice not found.");
  assert.deepEqual(calls, ["requireAdmin", `getInvoice:${MEMBERSHIP_ID}`]);
  assert.deepEqual(fetched, []);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.doesNotMatch(response.headers.get("Content-Type"), /pdf/);
});

// ---- the response ---------------------------------------------------------------------------------------------------------------

test("headers: PDF content type, an attachment with the safe file name, and no caching", async () => {
  const { deps } = setup();
  const response = await handleInvoicePdfRequest(MEMBERSHIP_ID, deps);
  const pdf = await pdfBytes(response);

  assert.equal(response.headers.get("Content-Type"), "application/pdf");
  assert.equal(response.headers.get("Content-Disposition"), 'attachment; filename="Invoice-INV-790.pdf"');
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(response.headers.get("Content-Length"), String(pdf.length));
});

test("the body is a valid PDF carrying the invoice: number, rupee totals, tax lines, bank details", async () => {
  const { deps } = setup();
  const pdf = await pdfBytes(await handleInvoicePdfRequest(MEMBERSHIP_ID, deps));

  assert.equal(pdf.subarray(0, 5).toString("latin1"), "%PDF-");
  assert.match(pdf.subarray(-16).toString("latin1"), /%%EOF\s*$/);
  const text = pdfText(pdf);
  for (const shown of ["INV-790", "Asha Rao", "₹1,180.00", "₹1,000.00", "₹90.00", "CGST @ 9%", "SGST @ 9%", "Total Tax", "Total Amount", "50100123456789", "HDFC0001234", "R. Kumar"]) {
    assert.ok(text.includes(shown), shown);
  }
});

test("the logo and the signature are embedded when available", async () => {
  const { deps, fetched } = setup();
  const pdf = await pdfBytes(await handleInvoicePdfRequest(MEMBERSHIP_ID, deps));
  assert.equal(imageObjects(pdf), 2);
  assert.deepEqual([...fetched].sort(), [LOGO_URL, SIGNATURE_URL].sort());
});

test("one image missing: a valid PDF with the other; both missing: a valid text-only PDF with the signatory's name", async () => {
  const one = await pdfBytes(await handleInvoicePdfRequest(MEMBERSHIP_ID, setup({ images: "logo-only" }).deps));
  assert.equal(imageObjects(one), 1);
  assert.equal(one.subarray(0, 5).toString("latin1"), "%PDF-");

  const none = await pdfBytes(await handleInvoicePdfRequest(MEMBERSHIP_ID, setup({ images: "none" }).deps));
  assert.equal(imageObjects(none), 0);
  assert.equal(none.subarray(0, 5).toString("latin1"), "%PDF-");
  assert.ok(pdfText(none).includes("R. Kumar"));
});

test("an invoice that stored no logo and no signature path fetches nothing and still renders", async () => {
  const { deps, fetched } = setup({ row: invoice({ business_logo_path: null, signature_path: null }) });
  const response = await handleInvoicePdfRequest(MEMBERSHIP_ID, deps);
  assert.equal(response.status, 200);
  assert.deepEqual(fetched, []);
  assert.equal(imageObjects(await pdfBytes(response)), 0);
});

test("a Receipt, and an invoice with no bank snapshot, are served the same way", async () => {
  const response = await handleInvoicePdfRequest(
    MEMBERSHIP_ID,
    setup({ row: invoice({ document_title: "receipt", invoice_prefix: "RC-", invoice_number: 12, bank_name: null, bank_account_name: null, bank_account_number: null, bank_ifsc_code: null, bank_branch: null }) }).deps
  );
  assert.equal(response.headers.get("Content-Disposition"), 'attachment; filename="Invoice-RC-12.pdf"');
  const text = pdfText(await pdfBytes(response));
  assert.ok(text.includes("RC-12") && text.includes("RECEIPT"));
  assert.ok(!/bank details/i.test(text));
});

// ---- the file name ----------------------------------------------------------------------------------------------------------------

test("the file name is Invoice- and the formatted number: prefix and plain number", () => {
  assert.equal(invoicePdfFilename(buildInvoiceDocument(invoice())), "Invoice-INV-790.pdf");
  assert.equal(invoicePdfFilename(buildInvoiceDocument(invoice({ invoice_prefix: null }))), "Invoice-790.pdf");
  assert.equal(invoicePdfFilename(buildInvoiceDocument(invoice({ invoice_prefix: "YC-", invoice_number: 1224 }))), "Invoice-YC-1224.pdf");
});

test("the file name is sanitized: no quote, slash, space, CR/LF or header can come through", () => {
  for (const hostile of ['A"B', "../../etc/passwd", "X\r\nSet-Cookie: a=b", "a b\tc", "N/A\\x", "é✓名", ";filename=evil.exe"]) {
    const name = invoicePdfFilename({ number: hostile });
    assert.match(name, /^Invoice[A-Za-z0-9._-]*\.pdf$/, hostile);
    assert.doesNotMatch(name, /[\r\n"\\/;\s]|\.\./, hostile);
  }
  assert.equal(invoicePdfFilename({ number: "" }), "Invoice.pdf");
  assert.equal(invoicePdfFilename({}), "Invoice.pdf");
});

// ---- failure ------------------------------------------------------------------------------------------------------------------------

test("a failure while generating is a safe 500: no detail, no link, no stack — and only the error's kind is logged", async () => {
  const { deps } = setup();
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args.join(" "));
  try {
    const response = await handleInvoicePdfRequest(MEMBERSHIP_ID, {
      ...deps,
      render: async () => {
        throw new TypeError(`could not fetch ${SIGNATURE_URL} for 50100123456789`);
      },
    });
    const body = await response.text();
    assert.equal(response.status, 500);
    assert.equal(body, "The PDF could not be generated. Try again.");
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.doesNotMatch(body, /SECRET|supabase|50100123456789|Error|at /);
    assert.equal(logged.length, 1);
    assert.doesNotMatch(logged[0], /SECRET-TOKEN|supabase|50100123456789|Asha|HDFC/);
  } finally {
    console.error = original;
  }
});

test("an asset helper that fails also gives the safe 500 rather than a stack", async () => {
  const { deps } = setup();
  const original = console.error;
  console.error = () => {};
  try {
    const response = await handleInvoicePdfRequest(MEMBERSHIP_ID, { ...deps, getAssetUrls: async () => { throw new Error("storage down"); } });
    assert.equal(response.status, 500);
    assert.equal(await response.text(), "The PDF could not be generated. Try again.");
  } finally {
    console.error = original;
  }
});

// ---- historical safety and security ------------------------------------------------------------------------------------------------

test("the signed asset links are never in the response — only the image bytes are", async () => {
  const response = await handleInvoicePdfRequest(MEMBERSHIP_ID, setup().deps);
  const headers = [...response.headers.entries()].join("\n");
  const body = (await pdfBytes(response)).toString("latin1");
  for (const secret of ["SECRET-TOKEN", "invoice-assets", "supabase.example", LOGO_URL]) {
    assert.ok(!headers.includes(secret), `header: ${secret}`);
    assert.ok(!body.includes(secret), `body: ${secret}`);
  }
});

test("the route reads only the invoice: no membership, student, settings, centre profile or bank account", () => {
  const files = [ROUTE, "./pdf-request.js"].map(code).join("\n");
  const imports = [...files.matchAll(/^import .* from "(.*)";/gm)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), [
    "../invoice-document.js",
    "@/lib/auth/dal",
    "@/lib/invoices/data",
    "@/lib/invoices/document-data",
    "@/lib/invoices/pdf/images",
    "@/lib/invoices/pdf/pdf-request",
    "@/lib/invoices/pdf/render",
  ].sort());
  assert.doesNotMatch(files, /lib\/(memberships|students|center-profile|invoice-settings|bank-accounts)|getMembership|getStudent|getCenterProfile|getInvoiceSettings|getBankAccounts/);
  assert.doesNotMatch(files, /\.from\(|\.rpc\(|supabase\.|createClient/);
});

test("the route uses the existing pieces, in order: invoice lookup, view model, asset links, image loader, renderer", () => {
  const route = code(ROUTE);
  assert.match(route, /getInvoice: getInvoiceForMembership,\s*getAssetUrls: getInvoiceAssetUrls,\s*loadImages: loadInvoicePdfImages,\s*render: renderInvoicePdf,/);
  const flow = code("./pdf-request.js");
  assert.match(flow, /buildInvoiceDocument\(invoice\)/);
  assert.match(flow, /loadImages\(await getAssetUrls\(invoice\)\)/, "the asset links feed the image loader");
  const order = ["await requireAdmin()", "await getInvoice(", "buildInvoiceDocument(invoice)", "loadImages(await getAssetUrls(invoice))", "render(invoiceDocument, images)"].map((step) => flow.indexOf(step));
  assert.ok(order.every((at) => at > 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test("no service-role client, no second invoice query, and the renderer is the Phase 6.3 wrapper", () => {
  const files = [ROUTE, "./pdf-request.js"].map(code).join("\n");
  assert.doesNotMatch(files, /service_role|SERVICE_ROLE|createAdminClient|supabase\/admin|process\.env/i);
  assert.doesNotMatch(files, /renderToBuffer|renderToStream|@react-pdf/, "rendering goes through renderInvoicePdf");
  assert.doesNotMatch(files, /fetch\(/, "image fetching stays in images.js");
});

test("the Node.js runtime is chosen explicitly, and the PDF is generated on request: nothing is stored", () => {
  const route = code(ROUTE);
  assert.match(route, /export const runtime = "nodejs";/);
  assert.doesNotMatch(route, /edge/i);
  assert.doesNotMatch(files(), /\.upload\(|writeFile|createWriteStream|storage\.from/);
  function files() {
    return [ROUTE, "./pdf-request.js"].map(code).join("\n");
  }
  assert.match(route, /export async function GET\(/);
  assert.doesNotMatch(route, /export (async )?function (POST|PUT|PATCH|DELETE)/);
});

// ---- fonts in the deployment ----------------------------------------------------------------------------------------------------------

test("the fonts are named by literal new URL(..., import.meta.url) calls, which the bundler traces into the deployment", () => {
  const fonts = code("./fonts.js");
  for (const file of ["Inter-Regular.ttf", "Inter-Medium.ttf", "Inter-SemiBold.ttf"]) {
    assert.ok(fonts.includes(`new URL("./fonts/${file}", import.meta.url)`), file);
    assert.ok(existsSync(new URL(`./fonts/${file}`, import.meta.url)), file);
  }
  // The computed process.cwd() path made the build trace the whole project; it is gone.
  assert.doesNotMatch(fonts, /process\.cwd\(\)/);
});

// ---- nothing else moved ----------------------------------------------------------------------------------------------------------------

test("the document, Print and the membership panel are untouched by the PDF endpoint", () => {
  for (const path of ["../../../app/memberships/[id]/invoice/invoice-document.js", "../../../app/memberships/[id]/invoice/print-invoice-button.js", "../../../app/memberships/[id]/invoice-panel.js"]) {
    assert.doesNotMatch(source(path), /Download PDF|invoice\/pdf|pdf-request|lib\/invoices\/pdf/i, path);
  }
  // Only the Invoice Detail page links to it (Phase 6.5), by URL - it imports none of the PDF code.
  assert.doesNotMatch(source("../../../app/memberships/[id]/invoice/page.js"), /pdf-request|lib\/invoices\/pdf|react-pdf/);
  assert.match(source("../../../app/memberships/[id]/invoice/print-invoice-button.js"), /window\.print\(\)/);
  assert.ok(createElement, "react is available");
});
