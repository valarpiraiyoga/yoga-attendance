import { buildWhatsAppUrl } from "../whatsapp.js";
import { invoicePdfFilename } from "./pdf/pdf-request.js";

/**
 * Share / WhatsApp for the stored invoice (V1 Invoice / Receipt, docs/01-product.md §5A "Actions").
 *
 * It shares the PDF the application already makes: the browser fetches the existing, Admin-only
 * `/memberships/[id]/invoice/pdf` route and uses the answer. Nothing is generated in the browser,
 * there is no second PDF endpoint, and no WhatsApp integration - only the plain `wa.me` click-to-chat
 * link the membership receipt already uses.
 *
 * Two ways, chosen by what the browser can do:
 *   1. It can share FILES (Web Share API level 2): the PDF is handed to the native share sheet, where
 *      the person picks WhatsApp or any other app. Closing the sheet is not an error.
 *   2. It cannot: the PDF is downloaded, then WhatsApp is opened with a prepared message. `wa.me`
 *      cannot attach a file, so the person attaches the downloaded PDF themselves - and the wording
 *      never claims otherwise.
 *
 * Everything the browser provides is passed in (`env`), so the flow is tested without one.
 */

export const SHARE_MESSAGES = Object.freeze({
  prepareFailed: "The PDF could not be prepared. Try again.",
  shareFailed: "The invoice could not be shared. Try again.",
  downloaded: "PDF downloaded. Open the WhatsApp chat and attach it to your message.",
  downloadedNotOpened: "PDF downloaded, but WhatsApp could not be opened automatically. Open WhatsApp and attach the downloaded PDF.",
});

/** "Hello, please find your invoice INV-790 for your membership. Thank you." (a Receipt says "receipt"). */
export function buildInvoiceShareMessage(invoiceDocument) {
  return `Hello, please find your ${invoiceDocument.title.toLowerCase()} ${invoiceDocument.number} for your membership. Thank you.`;
}

/**
 * Everything the share button needs, from the stored invoice and its view model: the PDF route, the
 * file name (the same one the download uses), the share-sheet title and text, and the WhatsApp link
 * - to the customer's stored number when it is usable, else a chat opened with no recipient.
 *
 * @param {object} invoice - the stored invoice row.
 * @param {object} invoiceDocument - from `buildInvoiceDocument(invoice)`.
 * @param {string} membershipId
 */
export function invoiceShareProps(invoice, invoiceDocument, membershipId) {
  const message = buildInvoiceShareMessage(invoiceDocument);

  return {
    pdfUrl: `/memberships/${membershipId}/invoice/pdf`,
    filename: invoicePdfFilename(invoiceDocument),
    title: `${invoiceDocument.title} ${invoiceDocument.number}`,
    message,
    whatsAppUrl: buildWhatsAppUrl(invoice.customer_phone, message, invoice.customer_phone_country_code) ?? `https://wa.me/?text=${encodeURIComponent(message)}`,
  };
}

/** Whether this browser can share this file with the native share sheet - every API present, and willing. */
export function canShareFile(nav, file) {
  try {
    return Boolean(nav && typeof nav.share === "function" && typeof nav.canShare === "function" && nav.canShare({ files: [file] }));
  } catch {
    return false;
  }
}

const isCancel = (error) => error?.name === "AbortError";

/**
 * @param {{ pdfUrl: string, filename: string, title: string, message: string, whatsAppUrl: string }} share
 * @param {{
 *   fetch: typeof fetch,
 *   navigator?: object,
 *   createFile: (blob: Blob, filename: string) => File,
 *   download: (blob: Blob, filename: string) => void,
 *   openWindow: (url: string) => object|null,
 * }} env
 * @returns {Promise<{ status: "shared"|"cancelled"|"downloaded"|"downloaded-not-opened"|"error", message: string|null }>}
 */
export async function shareInvoice({ pdfUrl, filename, title, message, whatsAppUrl }, env) {
  let blob;
  try {
    const response = await env.fetch(pdfUrl);
    if (!response.ok) return { status: "error", message: SHARE_MESSAGES.prepareFailed };
    blob = await response.blob();
  } catch {
    return { status: "error", message: SHARE_MESSAGES.prepareFailed };
  }

  let file;
  try {
    file = env.createFile(blob, filename);
  } catch {
    return { status: "error", message: SHARE_MESSAGES.prepareFailed };
  }

  if (canShareFile(env.navigator, file)) {
    try {
      await env.navigator.share({ title, text: message, files: [file] });
      return { status: "shared", message: null };
    } catch (error) {
      if (isCancel(error)) return { status: "cancelled", message: null };
      return { status: "error", message: SHARE_MESSAGES.shareFailed };
    }
  }

  // No file sharing: download the PDF, then open the click-to-chat link. The PDF is not attached.
  try {
    env.download(blob, filename);
  } catch {
    return { status: "error", message: SHARE_MESSAGES.prepareFailed };
  }

  let opened = null;
  try {
    opened = env.openWindow(whatsAppUrl);
  } catch {
    opened = null;
  }
  return opened
    ? { status: "downloaded", message: SHARE_MESSAGES.downloaded }
    : { status: "downloaded-not-opened", message: SHARE_MESSAGES.downloadedNotOpened };
}
