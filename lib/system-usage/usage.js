/**
 * System Usage (V1) - the pure logic behind the Admin Dashboard's usage card: the Free plan limits,
 * the percentage and remaining capacity, the status thresholds, and how bytes are written.
 *
 * Everything is in BYTES until the last step. The limits live here and nowhere else.
 *
 * Units follow the Supabase dashboard's own convention: 1 KB = 1024 bytes, so "500 MB" is
 * 500 x 1024 x 1024 bytes and "1 GB" is 1024 x 1024 x 1024 bytes.
 */

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

/** The Supabase Free plan allowances this card measures against. The one place they are defined. */
export const FREE_PLAN_LIMITS = Object.freeze({
  databaseBytes: 500 * MB,
  storageBytes: 1 * GB,
});

/** The approved thresholds, as a percentage of a limit. */
export const USAGE_THRESHOLDS = Object.freeze({
  warning: 70,
  critical: 90,
  limit: 100,
});

/** Least to most severe. */
export const USAGE_STATUSES = Object.freeze(["normal", "warning", "critical", "limit"]);

export const STATUS_LABEL = Object.freeze({
  normal: "Normal",
  warning: "Warning",
  critical: "Critical",
  limit: "Limit reached",
});

export const STATUS_MESSAGE = Object.freeze({
  normal: "Usage is within the Free plan limits.",
  warning: "Usage is high. Plan ahead for more capacity.",
  critical: "Usage is critical. Free up space or upgrade soon.",
  limit: "Free plan limit reached. Free up space or upgrade now.",
});

const isByteCount = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Exact percentage of the limit that is used (may exceed 100). */
export function percentUsed(usedBytes, limitBytes) {
  if (!isByteCount(usedBytes) || !(limitBytes > 0)) return 0;
  return (usedBytes / limitBytes) * 100;
}

/** Capacity left, never below zero. */
export function remainingBytes(usedBytes, limitBytes) {
  if (!isByteCount(usedBytes)) return Math.max(0, limitBytes);
  return Math.max(0, limitBytes - usedBytes);
}

/**
 * normal below 70%; warning from 70% up to (not including) 90%; critical from 90% up to (not
 * including) 100%; limit from 100%. Compared exactly, in bytes, so 69.99% is never "warning".
 */
export function usageStatus(usedBytes, limitBytes) {
  if (!isByteCount(usedBytes) || !(limitBytes > 0)) return "normal";
  const scaled = usedBytes * 100;
  if (scaled >= limitBytes * USAGE_THRESHOLDS.limit) return "limit";
  if (scaled >= limitBytes * USAGE_THRESHOLDS.critical) return "critical";
  if (scaled >= limitBytes * USAGE_THRESHOLDS.warning) return "warning";
  return "normal";
}

/** The more severe of several statuses. */
export function worstStatus(statuses) {
  return statuses.reduce((worst, status) => (USAGE_STATUSES.indexOf(status) > USAGE_STATUSES.indexOf(worst) ? status : worst), "normal");
}

const trimmed = (value) => String(value).replace(/\.0+$/, "");

/** "0 B", "512 B", "1.5 KB", "12.4 MB", "500 MB", "1 GB" - one decimal at most, no trailing ".0". */
export function formatBytes(bytes) {
  if (!isByteCount(bytes)) return "—";
  if (bytes < KB) return `${Math.round(bytes)} B`;
  const [value, unit] = bytes < MB ? [bytes / KB, "KB"] : bytes < GB ? [bytes / MB, "MB"] : [bytes / GB, "GB"];
  // Round down to one decimal, so a value just under the next unit or the limit never reads as reached.
  return `${trimmed((Math.floor(value * 10 + 1e-9) / 10).toFixed(1))} ${unit}`;
}

/** "0.4%", "12%", "100%" - one decimal under 10%, whole above, always rounded DOWN so 100% means reached. */
export function formatPercent(percent) {
  if (!Number.isFinite(percent) || percent < 0) return "0%";
  const shown = percent < 10 ? Math.floor(percent * 10 + 1e-9) / 10 : Math.floor(percent + 1e-9);
  return `${trimmed(shown.toFixed(percent < 10 ? 1 : 0))}%`;
}

/** The bytes the data layer returns, or null when they are not two usable numbers. */
export function parseUsage(raw) {
  const databaseBytes = Number(raw?.database_bytes);
  const storageBytes = Number(raw?.storage_bytes);
  if (!isByteCount(databaseBytes) || !isByteCount(storageBytes)) return null;
  return { databaseBytes, storageBytes };
}

function describe(key, label, usedBytes, limitBytes) {
  const percent = percentUsed(usedBytes, limitBytes);
  return {
    key,
    label,
    usedBytes,
    limitBytes,
    percent,
    status: usageStatus(usedBytes, limitBytes),
    usedText: formatBytes(usedBytes),
    limitText: formatBytes(limitBytes),
    percentText: formatPercent(percent),
    remainingText: formatBytes(remainingBytes(usedBytes, limitBytes)),
  };
}

/**
 * What the card shows, from the two byte counts: Database and File Storage, each with its used and
 * limit text, percentage and remaining capacity, and one overall status (the worse of the two).
 *
 * @param {{ databaseBytes: number, storageBytes: number }} usage
 */
export function buildSystemUsage({ databaseBytes, storageBytes }) {
  const items = [
    describe("database", "Database", databaseBytes, FREE_PLAN_LIMITS.databaseBytes),
    describe("storage", "File Storage", storageBytes, FREE_PLAN_LIMITS.storageBytes),
  ];
  const status = worstStatus(items.map((item) => item.status));

  return { items, status, statusLabel: STATUS_LABEL[status], message: STATUS_MESSAGE[status] };
}
