/**
 * Batch Identity: the curated colour palette a batch can be given.
 *
 * A batch stores only a stable KEY (`batches.batch_color`, e.g. "teal") - never
 * a hex or a CSS string. The key resolves here to static Tailwind classes, so
 * the palette can be retuned in one place (the `--batch-*` tokens in
 * app/globals.css) without touching any data. Every class is written out in
 * full (not built from the key) so Tailwind can see it.
 *
 * The colour is an ACCENT only: a dot, a tint, a left edge. It never replaces
 * the semantic status colours (Active / Inactive / Expired / Pending / Error /
 * Warning - lib/status.js), and it is never the only identifier - the batch
 * name or code always stays visible beside it.
 *
 * Pure and dependency-free, so both the form and the server action use it.
 * Keep the key list in step with the `batches_batch_color_valid` check in
 * supabase/migrations/0023_batch_identity.sql.
 */

export const DEFAULT_BATCH_COLOR = "teal";

// label, then the classes each surface needs:
//   dot   solid fill (the swatch / colour dot)
//   tile  the initials tile: a pale tint and a deepened text colour
//   edge  a left accent edge (Weekly Schedule cards)
//   wash  a very pale tint for the surface behind a card's accent
//   border  a soft outline in the colour (image and tile edges)
export const BATCH_COLORS = {
  teal: {
    label: "Teal",
    dot: "bg-batch-teal",
    tile: "bg-batch-teal/15 text-batch-teal-strong",
    edge: "border-l-batch-teal",
    wash: "bg-batch-teal/10 hover:bg-batch-teal/15",
    border: "border-batch-teal/30",
  },
  blue: {
    label: "Blue",
    dot: "bg-batch-blue",
    tile: "bg-batch-blue/15 text-batch-blue-strong",
    edge: "border-l-batch-blue",
    wash: "bg-batch-blue/10 hover:bg-batch-blue/15",
    border: "border-batch-blue/30",
  },
  indigo: {
    label: "Indigo",
    dot: "bg-batch-indigo",
    tile: "bg-batch-indigo/15 text-batch-indigo-strong",
    edge: "border-l-batch-indigo",
    wash: "bg-batch-indigo/10 hover:bg-batch-indigo/15",
    border: "border-batch-indigo/30",
  },
  purple: {
    label: "Purple",
    dot: "bg-batch-purple",
    tile: "bg-batch-purple/15 text-batch-purple-strong",
    edge: "border-l-batch-purple",
    wash: "bg-batch-purple/10 hover:bg-batch-purple/15",
    border: "border-batch-purple/30",
  },
  pink: {
    label: "Pink",
    dot: "bg-batch-pink",
    tile: "bg-batch-pink/15 text-batch-pink-strong",
    edge: "border-l-batch-pink",
    wash: "bg-batch-pink/10 hover:bg-batch-pink/15",
    border: "border-batch-pink/30",
  },
  orange: {
    label: "Orange",
    dot: "bg-batch-orange",
    tile: "bg-batch-orange/15 text-batch-orange-strong",
    edge: "border-l-batch-orange",
    wash: "bg-batch-orange/10 hover:bg-batch-orange/15",
    border: "border-batch-orange/30",
  },
  amber: {
    label: "Amber",
    dot: "bg-batch-amber",
    tile: "bg-batch-amber/15 text-batch-amber-strong",
    edge: "border-l-batch-amber",
    wash: "bg-batch-amber/10 hover:bg-batch-amber/15",
    border: "border-batch-amber/30",
  },
  green: {
    label: "Green",
    dot: "bg-batch-green",
    tile: "bg-batch-green/15 text-batch-green-strong",
    edge: "border-l-batch-green",
    wash: "bg-batch-green/10 hover:bg-batch-green/15",
    border: "border-batch-green/30",
  },
  red: {
    label: "Red",
    dot: "bg-batch-red",
    tile: "bg-batch-red/15 text-batch-red-strong",
    edge: "border-l-batch-red",
    wash: "bg-batch-red/10 hover:bg-batch-red/15",
    border: "border-batch-red/30",
  },
  slate: {
    label: "Slate",
    dot: "bg-batch-slate",
    tile: "bg-batch-slate/15 text-batch-slate-strong",
    edge: "border-l-batch-slate",
    wash: "bg-batch-slate/10 hover:bg-batch-slate/15",
    border: "border-batch-slate/30",
  },
};

export const BATCH_COLOR_KEYS = Object.keys(BATCH_COLORS);

/** True for a known palette key (and nothing else - not a hex, not "Teal"). */
export function isBatchColor(value) {
  return typeof value === "string" && Object.hasOwn(BATCH_COLORS, value);
}

/**
 * The palette entry for a stored key. A missing or unknown key (a batch that
 * predates the feature, or a key removed from the palette later) resolves to
 * the default teal, so a row can never render without an accent.
 */
export function getBatchColor(key) {
  return BATCH_COLORS[isBatchColor(key) ? key : DEFAULT_BATCH_COLOR];
}

/** The palette as a list, for the colour picker. */
export function listBatchColors() {
  return BATCH_COLOR_KEYS.map((key) => ({ key, ...BATCH_COLORS[key] }));
}
