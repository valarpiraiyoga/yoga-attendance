// Run with `npm test` (Node's built-in test runner).
//
// Phase 5.3 - Share / WhatsApp on the Invoice Detail. The flow (lib/invoices/share-invoice.js) is
// tested directly with a mocked browser (fetch, navigator.share / canShare, download, window.open),
// so nothing depends on a real native share sheet; the button and the page are pinned from source,
// the project's way for code that needs the React and Next.js runtime.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { buildInvoiceDocument } from "./invoice-document.js";
import { buildInvoiceShareMessage, canShareFile, invoiceShareProps, shareInvoice, SHARE_MESSAGES } from "./share-invoice.js";
import { invoicePdfFilename } from "./pdf/pdf-request.js";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

const BUTTON = "../../app/memberships/[id]/invoice/share-invoice-button.js";
const PAGE = "../../app/memberships/[id]/invoice/page.js";
const MEMBERSHIP_ID = "11111111-1111-4111-8111-111111111111";

function invoice(overrides = {}) {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    invoice_number: 790,
    invoice_prefix: "INV-",
    invoice_date: "2026-10-07",
    payment_date: "2026-10-05",
    document_title: "invoice",
    description: "Monthly Membership",
    period_start: "2026-10-01",
    period_end: "2026-10-31",
    currency: "INR",
    total_amount: 1180,
    tax_enabled: false,
    customer_name: "Asha Rao",
    customer_code: "YC-000012",
    customer_phone: "9876543210",
    customer_phone_country_code: "+91",
    business_name: "Sri Yoga Center",
    ...overrides,
  };
}

const propsFor = (overrides) => {
  const row = invoice(overrides);
  return invoiceShareProps(row, buildInvoiceDocument(row), MEMBERSHIP_ID);
};

/** A mocked browser. `shareable` = does navigator.canShare accept files; `shareError` = what share() throws. */
function mockBrowser({ hasShare = true, hasCanShare = true, shareable = true, shareError = null, fetchOk = true, fetchThrows = false, popupBlocked = false } = {}) {
  const log = { fetched: [], files: [], shared: [], canShareArgs: [], downloads: [], opened: [] };
  const pdfBlob = new Blob(["%PDF-1.3 fake"], { type: "application/pdf" });

  const navigator = {};
  if (hasShare) {
    navigator.share = async (data) => {
      log.shared.push(data);
      if (shareError) throw shareError;
    };
  }
  if (hasCanShare) {
    navigator.canShare = (data) => {
      log.canShareArgs.push(data);
      return shareable;
    };
  }

  const env = {
    fetch: async (url) => {
      log.fetched.push(url);
      if (fetchThrows) throw new TypeError("Failed to fetch");
      return { ok: fetchOk, status: fetchOk ? 200 : 500, blob: async () => pdfBlob };
    },
    navigator,
    createFile: (blob, filename) => {
      const file = new File([blob], filename, { type: "application/pdf" });
      log.files.push(file);
      return file;
    },
    download: (blob, filename) => log.downloads.push({ blob, filename }),
    openWindow: (url) => {
      log.opened.push(url);
      return popupBlocked ? null : { opener: null };
    },
  };
  return { env, log };
}

// ---- what the page gives the button -----------------------------------------------------------------------------------------

test("the share props: the existing PDF route, the download's own file name, a title, the message and the chat link", () => {
  const props = propsFor();
  assert.equal(props.pdfUrl, `/memberships/${MEMBERSHIP_ID}/invoice/pdf`);
  assert.equal(props.filename, "Invoice-INV-790.pdf");
  assert.equal(props.filename, invoicePdfFilename(buildInvoiceDocument(invoice())), "the one file-name helper, not a second convention");
  assert.equal(props.title, "Invoice INV-790");
  assert.equal(props.message, "Hello, please find your invoice INV-790 for your membership. Thank you.");
  assert.deepEqual(Object.keys(props).sort(), ["filename", "message", "pdfUrl", "title", "whatsAppUrl"]);
});

test("the message carries the actual formatted invoice number — prefix included — and nothing internal", () => {
  assert.equal(propsFor({ invoice_prefix: null, invoice_number: 1224 }).message, "Hello, please find your invoice 1224 for your membership. Thank you.");
  assert.equal(propsFor({ invoice_prefix: "YC-", invoice_number: 12 }).message, "Hello, please find your invoice YC-12 for your membership. Thank you.");
  assert.equal(buildInvoiceShareMessage(buildInvoiceDocument(invoice({ document_title: "receipt", invoice_prefix: "RC-", invoice_number: 5 }))), "Hello, please find your receipt RC-5 for your membership. Thank you.");
  const message = propsFor().message;
  for (const internal of ["Asha", "YC-000012", "1180", "₹", "Sri Yoga", "Monthly", "9876543210"]) assert.ok(!message.includes(internal), internal);
});

test("the WhatsApp link is the plain wa.me click-to-chat: the stored customer number with its country code, the message encoded", () => {
  const props = propsFor();
  assert.equal(props.whatsAppUrl, `https://wa.me/919876543210?text=${encodeURIComponent(props.message)}`);
  assert.match(props.whatsAppUrl, /^https:\/\/wa\.me\/\d+\?text=/);
});

test("with no usable number the chat opens with no recipient — a number is never invented", () => {
  for (const overrides of [{ customer_phone: null }, { customer_phone: "" }, { customer_phone: "123" }, { customer_phone: "abc" }]) {
    const props = propsFor({ customer_phone_country_code: null, ...overrides });
    assert.equal(props.whatsAppUrl, `https://wa.me/?text=${encodeURIComponent(props.message)}`, JSON.stringify(overrides));
  }
});

test("a different country code is used as stored", () => {
  assert.match(propsFor({ customer_phone: "7911123456", customer_phone_country_code: "+44" }).whatsAppUrl, /^https:\/\/wa\.me\/447911123456\?text=/);
});

// ---- capability detection ----------------------------------------------------------------------------------------------------

test("file sharing is used only when share, canShare and canShare({files}) are all there", () => {
  const file = new File(["x"], "Invoice-INV-790.pdf", { type: "application/pdf" });
  const seen = [];
  assert.equal(canShareFile({ share() {}, canShare: (data) => (seen.push(data), true) }, file), true);
  assert.deepEqual(seen, [{ files: [file] }], "asked about exactly this file");

  assert.equal(canShareFile({ share() {}, canShare: () => false }, file), false, "canShare says no");
  assert.equal(canShareFile({ share() {} }, file), false, "no canShare");
  assert.equal(canShareFile({ canShare: () => true }, file), false, "no share");
  assert.equal(canShareFile({}, file), false);
  assert.equal(canShareFile(undefined, file), false, "no navigator at all");
  assert.equal(canShareFile({ share() {}, canShare: () => { throw new TypeError("nope"); } }, file), false, "a throwing canShare is no");
});

// ---- native file sharing -------------------------------------------------------------------------------------------------------

test("with file sharing: the PDF is fetched from the existing route only, made a File with the right name, and shared", async () => {
  const props = propsFor();
  const { env, log } = mockBrowser();
  const outcome = await shareInvoice(props, env);

  assert.deepEqual(outcome, { status: "shared", message: null });
  assert.deepEqual(log.fetched, [`/memberships/${MEMBERSHIP_ID}/invoice/pdf`], "one request, to the existing route");
  assert.equal(log.files.length, 1);
  assert.equal(log.files[0].name, "Invoice-INV-790.pdf");
  assert.equal(log.files[0].type, "application/pdf");
  assert.equal(log.shared.length, 1);
  assert.deepEqual(log.shared[0].files, [log.files[0]]);
  assert.equal(log.shared[0].title, "Invoice INV-790");
  assert.equal(log.shared[0].text, props.message);
  // Nothing else happens: no download, no WhatsApp window.
  assert.deepEqual(log.downloads, []);
  assert.deepEqual(log.opened, []);
});

test("canShare is asked first and respected: when it says no, share() is never called with the file", async () => {
  const { env, log } = mockBrowser({ shareable: false });
  await shareInvoice(propsFor(), env);
  assert.equal(log.canShareArgs.length, 1);
  assert.deepEqual(log.canShareArgs[0].files, [log.files[0]]);
  assert.deepEqual(log.shared, []);
  assert.equal(log.downloads.length, 1, "it fell back");
});

test("closing the share sheet (AbortError) is a normal cancellation — no error, no fallback", async () => {
  const { env, log } = mockBrowser({ shareError: Object.assign(new Error("Share canceled"), { name: "AbortError" }) });
  const outcome = await shareInvoice(propsFor(), env);
  assert.deepEqual(outcome, { status: "cancelled", message: null });
  assert.deepEqual(log.downloads, []);
  assert.deepEqual(log.opened, []);
});

test("any other share failure is a friendly error — and not the browser's own message", async () => {
  const { env } = mockBrowser({ shareError: Object.assign(new Error("NotAllowedError: Permission denied at chrome-extension://abc"), { name: "NotAllowedError" }) });
  const outcome = await shareInvoice(propsFor(), env);
  assert.equal(outcome.status, "error");
  assert.equal(outcome.message, SHARE_MESSAGES.shareFailed);
  assert.ok(!outcome.message.includes("chrome-extension"));
});

// ---- the fallback ----------------------------------------------------------------------------------------------------------------

test("without share support: the existing PDF is downloaded under the same file name, then WhatsApp click-to-chat opens", async () => {
  for (const browser of [{ hasShare: false, hasCanShare: false }, { hasShare: true, hasCanShare: false }, { shareable: false }]) {
    const props = propsFor();
    const { env, log } = mockBrowser(browser);
    const outcome = await shareInvoice(props, env);

    assert.equal(outcome.status, "downloaded", JSON.stringify(browser));
    assert.deepEqual(log.fetched, [props.pdfUrl]);
    assert.equal(log.downloads.length, 1);
    assert.equal(log.downloads[0].filename, "Invoice-INV-790.pdf");
    assert.deepEqual(log.opened, [props.whatsAppUrl]);
    assert.deepEqual(log.shared, [], "share() is never attempted with a file");
  }
});

test("the download happens before WhatsApp opens", async () => {
  const order = [];
  const { env } = mockBrowser({ hasShare: false });
  const wrapped = { ...env, download: (...args) => (order.push("download"), env.download(...args)), openWindow: (...args) => (order.push("open"), env.openWindow(...args)) };
  await shareInvoice(propsFor(), wrapped);
  assert.deepEqual(order, ["download", "open"]);
});

test("the fallback never claims the PDF was attached — it tells the person to attach it", async () => {
  const { env } = mockBrowser({ hasShare: false });
  const outcome = await shareInvoice(propsFor(), env);
  assert.equal(outcome.message, SHARE_MESSAGES.downloaded);
  assert.match(outcome.message, /attach it/i);
  for (const text of Object.values(SHARE_MESSAGES)) assert.doesNotMatch(text, /\b(attached|sent|shared with|delivered)\b/i, text);
});

test("if the browser blocks the WhatsApp window, the person is told the PDF was downloaded and WhatsApp did not open", async () => {
  const { env, log } = mockBrowser({ hasShare: false, popupBlocked: true });
  const outcome = await shareInvoice(propsFor(), env);
  assert.equal(outcome.status, "downloaded-not-opened");
  assert.equal(outcome.message, SHARE_MESSAGES.downloadedNotOpened);
  assert.match(outcome.message, /PDF downloaded/);
  assert.match(outcome.message, /could not be opened automatically/);
  assert.equal(log.downloads.length, 1);

  const throws = { ...env, openWindow: () => { throw new Error("blocked"); } };
  assert.equal((await shareInvoice(propsFor(), throws)).status, "downloaded-not-opened");
});

// ---- failures --------------------------------------------------------------------------------------------------------------------

test("a PDF that cannot be fetched is a friendly error: nothing shared, downloaded or opened", async () => {
  for (const browser of [{ fetchOk: false }, { fetchThrows: true }]) {
    const { env, log } = mockBrowser(browser);
    const outcome = await shareInvoice(propsFor(), env);
    assert.deepEqual(outcome, { status: "error", message: SHARE_MESSAGES.prepareFailed });
    assert.deepEqual([log.shared, log.downloads, log.opened], [[], [], []]);
  }
});

test("a failure turning the answer into a file, or saving it, is a friendly error too", async () => {
  const { env, log } = mockBrowser();
  const noFile = await shareInvoice(propsFor(), { ...env, createFile: () => { throw new Error("File constructor missing"); } });
  assert.deepEqual(noFile, { status: "error", message: SHARE_MESSAGES.prepareFailed });

  const { env: fallbackEnv, log: fallbackLog } = mockBrowser({ hasShare: false });
  const noDownload = await shareInvoice(propsFor(), { ...fallbackEnv, download: () => { throw new Error("quota"); } });
  assert.equal(noDownload.status, "error");
  assert.deepEqual(fallbackLog.opened, [], "WhatsApp is not opened when the PDF could not be saved");
  assert.deepEqual(log.shared, []);
});

test("no message ever carries a stack, a URL or internal text", () => {
  for (const text of Object.values(SHARE_MESSAGES)) assert.doesNotMatch(text, /https?:|\bat \w+\.|Error:|supabase|\/memberships|stack/i, text);
});

// ---- the button ------------------------------------------------------------------------------------------------------------------

test("the button is a small client component; a click runs once — a second click while working is ignored", () => {
  const button = code(BUTTON);
  assert.match(button, /^"use client";/);
  assert.match(button, /async function handleShare\(\) \{\s*if \(running\.current\) return;\s*running\.current = true;\s*setBusy\(true\);/);
  assert.match(button, /finally \{\s*running\.current = false;\s*setBusy\(false\);\s*\}/);
  assert.match(button, /disabled=\{busy\} aria-busy=\{busy\}/);
  assert.match(button, /\{busy \? "Preparing…" : "Share \/ WhatsApp"\}/);
});

test("the button has a visible name, an icon that is only decoration, and the shared Button", () => {
  const button = code(BUTTON);
  assert.match(button, /import \{ Button \} from "@\/components\/ui\/button";/);
  assert.match(button, /<Share2 className="size-4" aria-hidden="true" \/>\s*\{busy/);
  assert.match(button, /<Button type="button" variant="outline"/);
});

test("it reports through the application's own toast: errors in red, the download notice in green, a cancellation silently", () => {
  const button = code(BUTTON);
  assert.match(button, /import Toast from "@\/components\/ui\/toast";/);
  assert.match(button, /if \(outcome\.message\)/);
  assert.match(button, /outcome\.status === "error" \|\| outcome\.status === "downloaded-not-opened" \? "error" : "success"/);
});

test("the browser pieces: fetch of the given route, a File of type application/pdf, an object-URL download, and window.open that drops the opener", () => {
  const button = code(BUTTON);
  assert.match(button, /fetch: \(url\) => fetch\(url\)/);
  assert.match(button, /new File\(\[blob\], filename, \{ type: "application\/pdf" \}\)/);
  assert.match(button, /URL\.createObjectURL\(blob\)/);
  assert.match(button, /link\.download = filename;/);
  assert.match(button, /URL\.revokeObjectURL/);
  assert.match(button, /window\.open\(url, "_blank"\)/);
  assert.match(button, /opened\.opener = null/);
});

// ---- boundaries ---------------------------------------------------------------------------------------------------------------------

test("no PDF is built in the browser: no PDF library, no InvoicePdf, no second endpoint, no signed link", () => {
  for (const path of [BUTTON, "./share-invoice.js"]) {
    const text = code(path);
    assert.doesNotMatch(text, /@react-pdf|react-pdf|jspdf|html2canvas/i, path);
    assert.doesNotMatch(text, /\bInvoicePdf\b|pdf\/invoice-pdf|renderInvoicePdf|renderToBuffer/, path);
    assert.doesNotMatch(text, /getInvoiceAssetUrls|signedUrl|createSignedUrl|invoice-assets|signature_path|business_logo_path/i, path);
  }
  // The only route it ever asks for is the existing PDF route.
  assert.deepEqual([...code("./share-invoice.js").matchAll(/\/memberships\/[^`"']*/g)].map((m) => m[0]), ["/memberships/${membershipId}/invoice/pdf"]);
  assert.equal(readdirSync(new URL("../../app/memberships/[id]/invoice/pdf/", import.meta.url)).join(), "route.js");
});

test("no WhatsApp Business API and no external SDK: the existing wa.me helper only", () => {
  const files = [BUTTON, "./share-invoice.js"].map(code).join("\n");
  assert.doesNotMatch(files, /graph\.facebook|api\.whatsapp|whatsapp-web|business|twilio|@whiskeysockets|axios|XMLHttpRequest/i);
  assert.deepEqual([...code("./share-invoice.js").matchAll(/^import .* from "(.*)";/gm)].map((m) => m[1]), ["../whatsapp.js", "./pdf/pdf-request.js"]);
  assert.deepEqual([...code(BUTTON).matchAll(/^import .* from "(.*)";/gm)].map((m) => m[1]), [
    "react",
    "lucide-react",
    "@/components/ui/button",
    "@/components/ui/toast",
    "@/lib/invoices/share-invoice",
  ]);
  // The only wa.me link is built by lib/whatsapp.js, or is the recipient-less form of the same link.
  assert.match(code("./share-invoice.js"), /https:\/\/wa\.me\/\?text=/);
  assert.match(code("../whatsapp.js"), /https:\/\/wa\.me\/\$\{number\}\?text=/);
});

test("the share code reads nothing but the invoice it is given: no settings, membership, student, centre profile or bank account", () => {
  const files = ["./share-invoice.js", BUTTON].map(code).join("\n");
  assert.doesNotMatch(files, /supabase|createClient|requireRole|invoice-settings|center-profile|bank-accounts|lib\/(memberships|students)/);
  assert.doesNotMatch(files, /Math\.|toFixed|tax|amount/i);
});

// ---- the page --------------------------------------------------------------------------------------------------------------------

test("the page adds Share / WhatsApp after Edit, in the header's actions; the first three actions are as they were", () => {
  const page = code(PAGE);
  assert.match(
    page,
    /<PrintInvoiceButton \/>\s*<Button\s+variant="outline"\s+render=\{<a href=\{`\/memberships\/\$\{id\}\/invoice\/pdf`\} \/>\}\s+nativeButton=\{false\}\s*>\s*<Download className="size-4" aria-hidden="true" \/>\s*Download PDF\s*<\/Button>\s*<EditInvoice\s+initial=\{editInvoiceInitial\(invoice\)\}\s+title=\{invoiceDocument\.title\}\s+number=\{invoiceDocument\.number\}\s*\/>\s*<ShareInvoiceButton share=\{invoiceShareProps\(invoice, invoiceDocument, id\)\} \/>/
  );
  assert.match(page, /<PageHeader\s+compact\s+className="print:hidden"/);
  assert.match(code("../../app/memberships/[id]/invoice/print-invoice-button.js"), /onClick=\{\(\) => window\.print\(\)\}/);
  // The page itself stays a server component and holds no share logic.
  assert.doesNotMatch(page, /"use client"|navigator|window\.|fetch\(|wa\.me/);
});

test("Share / WhatsApp is Admin-only because the page is: no invoice, no button; nothing outside the page imports it", () => {
  const page = code(PAGE);
  assert.ok(page.indexOf("await requireRole(ROLES.ADMIN)") < page.indexOf("await getInvoiceForMembership("));
  assert.ok(page.indexOf("notFound()") < page.indexOf("<ShareInvoiceButton"));

  const importers = (dir) =>
    readdirSync(new URL(dir, import.meta.url), { recursive: true })
      .map(String)
      .filter((f) => /\.(js|jsx)$/.test(f) && !/\.test\.js$/.test(f))
      .filter((f) => source(`${dir}${f}`).includes("share-invoice"))
      .map((f) => f.replaceAll("\\", "/"));
  assert.deepEqual(importers("../../app/"), ["memberships/[id]/invoice/page.js", "memberships/[id]/invoice/share-invoice-button.js"]);
  assert.deepEqual(importers("../../components/"), []);
  // And the route it fetches refuses non-Admins on its own.
  assert.match(code("../../app/memberships/[id]/invoice/pdf/route.js"), /requireAdmin: \(\) => requireRole\(ROLES\.ADMIN\)/);
});

test("on a narrow screen it is the header's own action: shown at every width, one button, no fixed width or separate layout", () => {
  const button = code(BUTTON);
  assert.doesNotMatch(button, /\bw-\[|\bmin-w|\bwhitespace-nowrap|overflow-x|\bgrid-cols|\bsm:|\bmd:|\blg:|className="[^"]*\bhidden\b/);
  assert.doesNotMatch(code(PAGE), /mobileActions/);
  const header = source("../../components/layout/PageHeader.js");
  assert.match(header, /mobileActions \? "hidden lg:flex" : "flex"/);
  assert.match(header, /shrink-0 flex-wrap items-center gap-2/);
});

test("Invoice Detail, the PDF, Edit, the numbering and the snapshot are untouched by sharing", () => {
  for (const path of ["../../app/memberships/[id]/invoice/invoice-document.js", "./invoice-document.js", "./pdf/invoice-pdf.js", "./pdf/render.js", "./pdf/images.js", "./invoice-core.js", "./edit-invoice.js", "../../app/memberships/[id]/invoice/edit-invoice.js", "./tax-split.js"]) {
    assert.doesNotMatch(code(path), /share-invoice|ShareInvoice|invoiceShareProps|navigator\.share|wa\.me/, path);
  }
  // The PDF route is exactly the one the download uses; sharing adds no endpoint.
  assert.equal(readdirSync(new URL("../../app/memberships/[id]/invoice/", import.meta.url)).sort().join(), "edit-invoice.js,invoice-document.js,page.js,pdf,print-invoice-button.js,share-invoice-button.js");
});
