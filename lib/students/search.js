// Relative-import-free and framework-free, so `npm test` can load it under plain Node.

/**
 * The PostgREST `.or()` filter for the Students search box ("Search by student
 * name, phone number or batch"): a student matches when the term is in their
 * name or phone, or when they are one of `batchStudentIds` — the students with
 * an active enrollment in a batch whose name or code matches the term (resolved
 * separately by `findStudentIdsByBatchTerm`, lib/students/data.js, since a
 * batch match lives in another table).
 *
 * `escapedTerm` must already be escaped for the `.or()` grammar
 * (`escapeForOrFilter`); ids are UUIDs and need no escaping. With no batch
 * matches the filter is exactly the previous name-or-phone one.
 *
 * @param {string} escapedTerm
 * @param {string[]} [batchStudentIds]
 * @returns {string}
 */
export function buildStudentSearchFilter(escapedTerm, batchStudentIds = []) {
  const parts = [`full_name.ilike.%${escapedTerm}%`, `phone.ilike.%${escapedTerm}%`];
  if (batchStudentIds.length > 0) parts.push(`id.in.(${batchStudentIds.join(",")})`);
  return parts.join(",");
}
