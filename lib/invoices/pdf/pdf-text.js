import { inflateSync } from "node:zlib";

// Reads the text out of a rendered PDF (no PDF-parsing dependency), for tests. Copied from invoice-pdf.test.js.

/**
 * The text a PDF shows, page by page, in drawing order. React-PDF writes each font as a Type0 font with a
 * /ToUnicode map and draws text as glyph ids in hex strings, in Flate-compressed streams. So: inflate the
 * streams, read each font's glyph->character map, and decode every `<hex> Tj` / `[<hex> n <hex>] TJ`
 * with the font set by the preceding `/Fn size Tf`.
 */
export function extractPdfPages(buffer) {
  const raw = buffer.toString("latin1"); // one char per byte, so string offsets are byte offsets
  const objects = new Map();
  for (const match of raw.matchAll(/(\d+) 0 obj\s*([\s\S]*?)endobj/g)) {
    const [, number, body] = match;
    const start = body.indexOf("stream");
    let stream = null;
    if (start !== -1 && /\/FlateDecode/.test(body.slice(0, start))) {
      const from = match.index + match[0].indexOf(body) + start + "stream".length;
      const begin = raw[from] === "\r" ? from + 2 : from + 1;
      const end = raw.indexOf("endstream", begin);
      stream = inflateSync(buffer.subarray(begin, end)).toString("latin1");
    }
    objects.set(Number(number), { dict: start === -1 ? body : body.slice(0, start), stream });
  }

  const cmapOf = (toUnicodeObject) => {
    const map = new Map();
    const cmap = objects.get(toUnicodeObject)?.stream ?? "";
    const decode = (hex) => String.fromCodePoint(...(hex.match(/.{4}/g) ?? []).map((unit) => parseInt(unit, 16)));
    for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const [, gid, unicode] of block[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi)) map.set(parseInt(gid, 16), decode(unicode));
    }
    for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      // React-PDF writes each range as `<from> <to> [<char> <char> ...]` (the standard single-start form is read too).
      for (const [, from, to, list, start] of block[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*(?:\[([^\]]*)\]|<([0-9a-f]+)>)/gi)) {
        const units = list ? [...list.matchAll(/<([0-9a-f]+)>/gi)].map((m) => decode(m[1])) : null;
        for (let gid = parseInt(from, 16); gid <= parseInt(to, 16); gid += 1) {
          map.set(gid, units ? units[gid - parseInt(from, 16)] : String.fromCodePoint(parseInt(start, 16) + (gid - parseInt(from, 16))));
        }
      }
    }
    return map;
  };

  const fonts = new Map(); // resource name -> glyph map
  for (const { dict } of objects.values()) {
    for (const [, name, number] of dict.matchAll(/\/(F\d+) (\d+) 0 R/g)) {
      const toUnicode = objects.get(Number(number))?.dict.match(/\/ToUnicode (\d+) 0 R/)?.[1];
      if (toUnicode) fonts.set(name, cmapOf(Number(toUnicode)));
    }
  }

  // Pages in order (the /Kids of the page tree), each with its drawn text and how far down the page it is drawn.
  const kids = [...(raw.match(/\/Kids \[([^\]]*)\]/)?.[1] ?? "").matchAll(/(\d+) 0 R/g)].map((m) => Number(m[1]));
  const pages = kids.map((pageNumber) => {
    const contents = Number(objects.get(pageNumber)?.dict.match(/\/Contents (\d+) 0 R/)?.[1]);
    const stream = objects.get(contents)?.stream ?? "";
    const runs = [];
    const offsets = [0]; // vertical offset of each open `q` level; a `cm` with d = 1 shifts the current one
    let font = null;
    const operations = /^(q|Q)$|^[-\d.]+ [-\d.]+ [-\d.]+ ([-\d.]+) [-\d.]+ ([-\d.]+) cm$|\/(F\d+) [\d.]+ Tf|\[((?:<[0-9a-f]+>|[-\d.\s])+)\] TJ|<([0-9a-f]+)> Tj/gim;
    for (const operation of stream.matchAll(operations)) {
      if (operation[1] === "q") offsets.push(offsets[offsets.length - 1]);
      else if (operation[1] === "Q") offsets.pop();
      else if (operation[2] !== undefined) {
        if (Number(operation[2]) === 1) offsets[offsets.length - 1] += Number(operation[3]);
      } else if (operation[4]) font = fonts.get(operation[4]);
      else {
        const hex = (operation[5] ?? operation[6]).match(/<([0-9a-f]+)>|^([0-9a-f]+)$/gi) ?? [];
        const text = hex
          .map((chunk) => chunk.replace(/[<>]/g, ""))
          .map((chunk) => (chunk.match(/.{4}/g) ?? []).map((gid) => font?.get(parseInt(gid, 16)) ?? "").join(""))
          .join("");
        runs.push({ text, y: offsets[offsets.length - 1] });
      }
    }
    return runs;
  });
  return pages;
}

export const extractPdfText = (buffer) => extractPdfPages(buffer).flat().map((run) => run.text);
