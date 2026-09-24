"use client";

import SearchSelect from "@/components/forms/SearchSelect";
import { DEFAULT_TIMEZONE, listTimeZoneGroups, searchTimeZoneGroups, timeZoneLabel } from "@/lib/timezones";

// The list is fixed, so it is built once. Each option is one IANA zone, grouped
// under its country: "Asia/Kolkata — India Standard Time" under "India".
const GROUPS = listTimeZoneGroups().map((group) => ({
  label: group.country,
  options: group.zones.map((zone) => ({ value: zone.id, label: zone.label, search: zone.search })),
}));

// Reuses the time zone module's own matching (country, city, identifier or
// friendly name), so what the selector finds and what the validator accepts
// come from one place.
function filterGroups(groups, query) {
  const kept = searchTimeZoneGroups(
    groups.map((group) => ({ country: group.label, zones: group.options.map((o) => ({ id: o.value, label: o.label, search: o.search })) })),
    query
  );
  const keptIds = new Map(kept.map((group) => [group.country, new Set(group.zones.map((zone) => zone.id))]));
  return groups
    .filter((group) => keptIds.has(group.label))
    .map((group) => ({ ...group, options: group.options.filter((option) => keptIds.get(group.label).has(option.value)) }));
}

/**
 * The centre's time zone picker (Center Regional Settings): a searchable list
 * of IANA zones grouped by country, searchable by country, city or identifier.
 * A saved zone that is not in the list (set outside the app) is still shown,
 * and kept, as itself. Submits `name` ("timezone") as the IANA identifier.
 */
export default function TimeZoneSelect({ defaultValue = DEFAULT_TIMEZONE, ...props }) {
  const known = GROUPS.some((group) => group.options.some((option) => option.value === defaultValue));
  const groups = known
    ? GROUPS
    : [{ label: "Current setting", options: [{ value: defaultValue, label: timeZoneLabel(defaultValue), search: defaultValue.toLowerCase() }] }, ...GROUPS];

  return (
    <SearchSelect
      name="timezone"
      groups={groups}
      filter={filterGroups}
      defaultValue={defaultValue}
      placeholder="Select a time zone"
      searchLabel="Search time zones"
      searchPlaceholder="Search country, city or time zone…"
      emptyText="No time zone found."
      listLabel="Time zones"
      {...props}
    />
  );
}
