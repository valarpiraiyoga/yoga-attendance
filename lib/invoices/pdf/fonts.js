import { fileURLToPath } from "node:url";
import { Font } from "@react-pdf/renderer";

/**
 * The font the invoice PDF is set in: Inter, the application's own typeface, from the official
 * Inter 4.1 release (https://github.com/rsms/inter, SIL Open Font License 1.1 - the licence text is
 * beside the files, Inter-LICENSE.txt). The static TrueType files are bundled in `./fonts` because
 * React-PDF cannot use the WOFF2 files `next/font` serves, and its built-in fonts have no rupee
 * sign. The full Inter files are used (not a Latin-only subset), so the rupee sign (U+20B9) and
 * every character the document shows are present.
 *
 * Three weights are registered - Regular (400), Medium (500), SemiBold (600) - the three the HTML
 * invoice uses.
 *
 * Each file is named by a literal `new URL("./fonts/...", import.meta.url)`, the form the Next.js
 * bundler (Turbopack) recognises as a file reference: it copies the font into the server output and
 * traces it into the deployment, so the route finds the fonts in production as well as in tests
 * (where the URL is simply this folder). A computed path (process.cwd()) would make the build trace
 * the whole project.
 */

export const PDF_FONT_FAMILY = "Inter";

export const PDF_FONT_FILES = Object.freeze([
  { fontWeight: 400, file: "Inter-Regular.ttf", url: new URL("./fonts/Inter-Regular.ttf", import.meta.url) },
  { fontWeight: 500, file: "Inter-Medium.ttf", url: new URL("./fonts/Inter-Medium.ttf", import.meta.url) },
  { fontWeight: 600, file: "Inter-SemiBold.ttf", url: new URL("./fonts/Inter-SemiBold.ttf", import.meta.url) },
]);

// A run of more than 28 characters may break (every 14); anything shorter is never split.
const LONG_RUN = 28;
const BREAK_EVERY = 14;

let registered = false;

/** Registers Inter with React-PDF, once per process. */
export function registerPdfFonts() {
  if (registered) return;

  Font.register({
    family: PDF_FONT_FAMILY,
    fonts: PDF_FONT_FILES.map(({ fontWeight, url }) => ({ src: fileURLToPath(url), fontWeight })),
  });
  // Words are not hyphenated: a name or an account number must stay whole. The one exception is a run
  // longer than LONG_RUN characters - only a long reference ID can be that - which may break into pieces so
  // it can never run out of its column and over the text beside it.
  Font.registerHyphenationCallback((word) => (word.length > LONG_RUN ? word.match(new RegExp(`.{1,${BREAK_EVERY}}`, "gs")) : [word]));

  registered = true;
}
