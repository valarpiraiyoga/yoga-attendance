/**
 * The two images an invoice PDF can carry - the logo and the signature - fetched from the links
 * the invoice's own stored paths make (`getInvoiceAssetUrls`, lib/invoices/document-data.js), and
 * made ready for React-PDF.
 *
 * This module queries no database and knows no paths: it is given two links and returns the image
 * bytes. It never throws - an image that is missing, unreachable, too large, the wrong kind or not
 * decodable is simply `null`, and the PDF is drawn without it. (The links are temporary and may
 * be secret, so they are never logged.)
 *
 * React-PDF can draw PNG and JPEG only. The upload rules also allow WebP; a WebP image cannot be
 * embedded and is left out like any other image that cannot be used.
 */

// The upload limit (profile-photo-rules.js): nothing larger was ever accepted.
export const PDF_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const PDF_IMAGE_TIMEOUT_MS = 8000;

/** "png" or "jpg" from the file's own first bytes (never from its name or content type), else null. */
export function sniffImageFormat(bytes) {
  if (!bytes || bytes.length < 8) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  return null;
}

/**
 * @param {string|null|undefined} url
 * @param {{ fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<{ data: Buffer, format: "png"|"jpg" }|null>}
 */
export async function loadPdfImage(url, { fetchImpl = fetch } = {}) {
  if (!url) return null;

  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(PDF_IMAGE_TIMEOUT_MS) });
    if (!response.ok) return null;

    const declared = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(declared) && declared > PDF_IMAGE_MAX_BYTES) return null;

    const data = Buffer.from(await response.arrayBuffer());
    if (data.length === 0 || data.length > PDF_IMAGE_MAX_BYTES) return null;

    const format = sniffImageFormat(data);
    return format ? { data, format } : null;
  } catch {
    return null;
  }
}

/**
 * @param {{ logoUrl?: string|null, signatureUrl?: string|null }} urls
 * @param {{ fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<{ logo: object|null, signature: object|null }>}
 */
export async function loadInvoicePdfImages({ logoUrl, signatureUrl } = {}, options) {
  const [logo, signature] = await Promise.all([loadPdfImage(logoUrl, options), loadPdfImage(signatureUrl, options)]);
  return { logo, signature };
}
