/**
 * The "Membership · MEM-000026 · Monthly" identifier line, set as a tinted badge so
 * the record a header belongs to stands out from the student's details beside it.
 * Full width of its row (it wraps under the other header meta), the badge itself
 * only as wide as its text.
 *
 * @param {object} props
 * @param {string} props.code - the membership code (MEM-…).
 * @param {string} props.plan - the plan's display label.
 */
export default function MembershipTag({ code, plan }) {
  return (
    <span className="basis-full">
      <span className="text-small inline-flex max-w-full flex-wrap items-center gap-x-1.5 rounded-md bg-brand/10 px-2.5 py-1 font-medium text-brand">
        <span>Membership</span>
        <span aria-hidden="true">·</span>
        <span className="font-semibold">{code}</span>
        <span aria-hidden="true">·</span>
        <span>{plan}</span>
      </span>
    </span>
  );
}
