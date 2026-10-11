/**
 * What a class-count membership has used and has left (migration 0043: a membership's remaining classes are its
 * total less the classes recorded - there is no stored counter). Pure, so every screen reads it the same way.
 *
 * The data layer embeds the membership's records with their reversal, `class_count_attendance(id,
 * class_count_attendance_reversals(id))` (migration 0045). Remaining classes are NET: a record that has a reversal no
 * longer takes a class. A reversal embeds as an object, an array or null depending on how PostgREST sees the relation,
 * so any non-empty value means "reversed". A plain `[{ count: N }]` (a gross count) is still read as N.
 */

/** How many of the embedded records still take a class. */
export function netUsedOf(recordedRows) {
  if (!Array.isArray(recordedRows)) return 0;
  if (recordedRows.length === 1 && typeof recordedRows[0]?.count === "number") return recordedRows[0].count;
  return recordedRows.filter((row) => !hasReversal(row?.class_count_attendance_reversals)).length;
}

/** True when an embedded reversal is present (object, or non-empty array). */
export function hasReversal(reversal) {
  return Array.isArray(reversal) ? reversal.length > 0 : Boolean(reversal);
}


/**
 * @param {{ kind?: string, total_classes?: number|null }} membership
 * @param {object[]|null|undefined} recordedRows - the embedded records with their reversals.
 * @returns {{ total: number, used: number, remaining: number } | null} null for a duration membership.
 */
export function classCountOf(membership, recordedRows) {
  if (membership?.kind !== "class_count") return null;
  const total = membership.total_classes ?? 0;
  const used = netUsedOf(recordedRows);
  return { total, used, remaining: Math.max(0, total - used) };
}

/** `7 of 10 classes left` (singular for 1 of 1). */
export function classCountText(classCount) {
  const noun = classCount.total === 1 ? "class" : "classes";
  return `${classCount.remaining} of ${classCount.total} ${noun} left`;
}
