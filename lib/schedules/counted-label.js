/** "1 time slot" / "2 time slots": the count with its singular or plural noun (the count is never hardcoded by callers). */
export function countedLabel(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}
