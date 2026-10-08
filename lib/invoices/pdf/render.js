import { createElement as h } from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import InvoicePdf from "./invoice-pdf.js";

/**
 * The invoice PDF as bytes, from the view model and the (optional) images.
 *
 * An image can pass the first-bytes check yet still be undecodable (a truncated or corrupt file),
 * and React-PDF then fails the whole render. An invoice must not be lost to its logo, so on a
 * failure the render is retried without the images that might be at fault: first without the
 * signature, then without the logo, then without either - the text identity, the signatory's name
 * and designation and the Authorized Signatory label are always drawn. Only a failure that persists
 * with no images at all is an error.
 *
 * @param {object} invoiceDocument - from `buildInvoiceDocument`.
 * @param {{ logo?: object|null, signature?: object|null }} [images] - from `loadInvoicePdfImages`.
 * @returns {Promise<Buffer>}
 */
export async function renderInvoicePdf(invoiceDocument, images = {}) {
  const { logo = null, signature = null } = images ?? {};

  const attempts = [
    { logo, signature },
    { logo, signature: null },
    { logo: null, signature },
    { logo: null, signature: null },
  ].filter((attempt, index, all) => all.findIndex((other) => other.logo === attempt.logo && other.signature === attempt.signature) === index);

  let failure;
  for (const attempt of attempts) {
    try {
      return await renderToBuffer(h(InvoicePdf, { invoiceDocument, images: attempt }));
    } catch (error) {
      failure = error;
    }
  }
  throw failure;
}
