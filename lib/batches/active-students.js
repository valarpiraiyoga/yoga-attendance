// A batch's Active Students (01-product.md §6 "Active Students"): the students with an ACTIVE enrollment in it. One definition and one count, used
// by Batch Details' summary card and its Students section heading, so the two can never disagree. Pure: relative imports only, so `npm test` loads it.

/** Whether an enrollment counts as active: its own status is "active" (the same test the Students list and the enrollment screens use). */
export function isActiveEnrollment(enrollment) {
  return enrollment?.status === "active";
}

/**
 * The number of active enrollments in a batch's enrollment list. Counts the list it is given as it is - search and the status filter narrow the
 * rows on screen, never this number. An inactive enrollment is not counted (it stays in the list, marked Inactive).
 *
 * @param {{ status?: string }[]|null|undefined} enrollments
 * @returns {number}
 */
export function countActiveEnrollments(enrollments) {
  return (enrollments ?? []).filter(isActiveEnrollment).length;
}
