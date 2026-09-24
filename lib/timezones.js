/**
 * Time zone metadata (Center Regional Settings).
 *
 * The centre stores a real IANA identifier ("Asia/Kolkata", "America/New_York"),
 * never an abbreviation ("IST") or an offset ("+05:30"): those cannot describe a
 * zone that observes daylight saving. All the actual time arithmetic is done by
 * `Intl` (and Postgres) from the IANA rules - nothing here calculates an offset.
 *
 * This module holds only what a person picks from: the zones grouped by country,
 * so the selector can be searched by country, city or identifier. Friendly names
 * ("Eastern Time") come from `Intl`, not from a table kept here.
 *
 * Pure (no imports), shared by the selector, the settings validator and tests.
 */

export const DEFAULT_TIMEZONE = "Asia/Kolkata";

// [country, [IANA zone, ...]]. Every zone is a canonical IANA name that both
// `Intl` and Postgres accept. A country with several zones lists them west to
// east. Add a line to offer another zone; nothing else needs to change.
const ZONES_BY_COUNTRY = [
  ["Afghanistan", ["Asia/Kabul"]],
  ["Argentina", ["America/Argentina/Buenos_Aires"]],
  ["Australia", [
    "Australia/Perth", "Australia/Darwin", "Australia/Adelaide", "Australia/Brisbane",
    "Australia/Sydney", "Australia/Melbourne", "Australia/Hobart",
  ]],
  ["Austria", ["Europe/Vienna"]],
  ["Bahrain", ["Asia/Bahrain"]],
  ["Bangladesh", ["Asia/Dhaka"]],
  ["Belgium", ["Europe/Brussels"]],
  ["Bhutan", ["Asia/Thimphu"]],
  ["Brazil", ["America/Rio_Branco", "America/Manaus", "America/Sao_Paulo", "America/Noronha"]],
  ["Bulgaria", ["Europe/Sofia"]],
  ["Cambodia", ["Asia/Phnom_Penh"]],
  ["Canada", [
    "America/Vancouver", "America/Edmonton", "America/Regina", "America/Winnipeg",
    "America/Toronto", "America/Halifax", "America/St_Johns",
  ]],
  ["Chile", ["America/Santiago"]],
  ["China", ["Asia/Shanghai"]],
  ["Colombia", ["America/Bogota"]],
  ["Costa Rica", ["America/Costa_Rica"]],
  ["Croatia", ["Europe/Zagreb"]],
  ["Cyprus", ["Asia/Nicosia"]],
  ["Czechia", ["Europe/Prague"]],
  ["Denmark", ["Europe/Copenhagen"]],
  ["Ecuador", ["America/Guayaquil"]],
  ["Egypt", ["Africa/Cairo"]],
  ["Estonia", ["Europe/Tallinn"]],
  ["Ethiopia", ["Africa/Addis_Ababa"]],
  ["Fiji", ["Pacific/Fiji"]],
  ["Finland", ["Europe/Helsinki"]],
  ["France", ["Europe/Paris"]],
  ["Germany", ["Europe/Berlin"]],
  ["Ghana", ["Africa/Accra"]],
  ["Greece", ["Europe/Athens"]],
  ["Hong Kong", ["Asia/Hong_Kong"]],
  ["Hungary", ["Europe/Budapest"]],
  ["Iceland", ["Atlantic/Reykjavik"]],
  ["India", ["Asia/Kolkata"]],
  ["Indonesia", ["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"]],
  ["Iran", ["Asia/Tehran"]],
  ["Iraq", ["Asia/Baghdad"]],
  ["Ireland", ["Europe/Dublin"]],
  ["Israel", ["Asia/Jerusalem"]],
  ["Italy", ["Europe/Rome"]],
  ["Japan", ["Asia/Tokyo"]],
  ["Jordan", ["Asia/Amman"]],
  ["Kazakhstan", ["Asia/Almaty"]],
  ["Kenya", ["Africa/Nairobi"]],
  ["Kuwait", ["Asia/Kuwait"]],
  ["Laos", ["Asia/Vientiane"]],
  ["Latvia", ["Europe/Riga"]],
  ["Lebanon", ["Asia/Beirut"]],
  ["Lithuania", ["Europe/Vilnius"]],
  ["Malaysia", ["Asia/Kuala_Lumpur"]],
  ["Maldives", ["Indian/Maldives"]],
  ["Mauritius", ["Indian/Mauritius"]],
  ["Mexico", ["America/Tijuana", "America/Mazatlan", "America/Mexico_City", "America/Cancun"]],
  ["Morocco", ["Africa/Casablanca"]],
  ["Myanmar", ["Asia/Yangon"]],
  ["Nepal", ["Asia/Kathmandu"]],
  ["Netherlands", ["Europe/Amsterdam"]],
  ["New Zealand", ["Pacific/Auckland"]],
  ["Nigeria", ["Africa/Lagos"]],
  ["Norway", ["Europe/Oslo"]],
  ["Oman", ["Asia/Muscat"]],
  ["Pakistan", ["Asia/Karachi"]],
  ["Panama", ["America/Panama"]],
  ["Peru", ["America/Lima"]],
  ["Philippines", ["Asia/Manila"]],
  ["Poland", ["Europe/Warsaw"]],
  ["Portugal", ["Europe/Lisbon", "Atlantic/Azores"]],
  ["Qatar", ["Asia/Qatar"]],
  ["Romania", ["Europe/Bucharest"]],
  ["Russia", ["Europe/Kaliningrad", "Europe/Moscow", "Asia/Yekaterinburg", "Asia/Novosibirsk", "Asia/Vladivostok"]],
  ["Saudi Arabia", ["Asia/Riyadh"]],
  ["Serbia", ["Europe/Belgrade"]],
  ["Singapore", ["Asia/Singapore"]],
  ["Slovakia", ["Europe/Bratislava"]],
  ["Slovenia", ["Europe/Ljubljana"]],
  ["South Africa", ["Africa/Johannesburg"]],
  ["South Korea", ["Asia/Seoul"]],
  ["Spain", ["Europe/Madrid", "Atlantic/Canary"]],
  ["Sri Lanka", ["Asia/Colombo"]],
  ["Sweden", ["Europe/Stockholm"]],
  ["Switzerland", ["Europe/Zurich"]],
  ["Taiwan", ["Asia/Taipei"]],
  ["Tanzania", ["Africa/Dar_es_Salaam"]],
  ["Thailand", ["Asia/Bangkok"]],
  ["Turkey", ["Europe/Istanbul"]],
  ["Uganda", ["Africa/Kampala"]],
  ["Ukraine", ["Europe/Kyiv"]],
  ["United Arab Emirates", ["Asia/Dubai"]],
  ["United Kingdom", ["Europe/London"]],
  ["United States", [
    "Pacific/Honolulu", "America/Anchorage", "America/Los_Angeles", "America/Phoenix",
    "America/Denver", "America/Chicago", "America/New_York",
  ]],
  ["Uruguay", ["America/Montevideo"]],
  ["Uzbekistan", ["Asia/Tashkent"]],
  ["Vietnam", ["Asia/Ho_Chi_Minh"]],
  ["Zambia", ["Africa/Lusaka"]],
  ["Zimbabwe", ["Africa/Harare"]],
  ["Universal", ["UTC"]],
];

const ZONE_SET = new Set(ZONES_BY_COUNTRY.flatMap(([, zones]) => zones));

// An "Area/Location" IANA name (or plain UTC). This is what stops "IST",
// "+05:30" and "India" - which `Intl` would otherwise accept or reject
// inconsistently - from being stored as a time zone.
const IANA_SHAPE = /^(?:UTC|[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+)$/;

/**
 * True for a usable IANA time zone identifier: the right shape AND one the
 * platform actually knows. "IST", "+05:30", "India" and "Mars/Base" are all
 * rejected. (Postgres re-checks this against its own zone table on save.)
 */
export function isValidTimeZone(value) {
  if (typeof value !== "string" || !IANA_SHAPE.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** True when the zone is one the selector offers. */
export function isListedTimeZone(value) {
  return ZONE_SET.has(value);
}

function zoneName(timeZone) {
  // "longGeneric" is the daylight-saving-neutral name ("Eastern Time") rather
  // than the name of the current season ("Eastern Daylight Time"); older
  // engines without it fall back to the plain long name.
  for (const timeZoneName of ["longGeneric", "long"]) {
    try {
      const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName })
        .formatToParts(new Date())
        .find((piece) => piece.type === "timeZoneName");
      if (part) return part.value;
    } catch {
      // try the next form
    }
  }
  return "";
}

/** The friendly label for a zone: "Asia/Kolkata — India Standard Time". */
export function timeZoneLabel(timeZone) {
  const name = zoneName(timeZone);
  return name ? `${timeZone} — ${name}` : timeZone;
}

/** The city part of a zone id, readable: "America/Los_Angeles" → "Los Angeles". */
function cityOf(timeZone) {
  return timeZone.split("/").at(-1).replaceAll("_", " ");
}

/**
 * The zones as picker groups: `[{ country, zones: [{ id, label, search }] }]`,
 * countries A-Z. `search` is the lower-cased text a query is matched against:
 * the country, the city, the identifier and the friendly name.
 */
export function listTimeZoneGroups() {
  return ZONES_BY_COUNTRY.map(([country, ids]) => ({
    country,
    zones: ids.map((id) => {
      const label = timeZoneLabel(id);
      return { id, label, search: `${country} ${cityOf(id)} ${id} ${label}`.toLowerCase() };
    }),
  }));
}

/**
 * Filters `listTimeZoneGroups()` output by a typed query, keeping a country's
 * heading only when one of its zones matches. Matching a country name keeps
 * all of that country's zones.
 */
export function searchTimeZoneGroups(groups, query) {
  const term = String(query ?? "").trim().toLowerCase();
  if (!term) return groups;
  return groups
    .map((group) => {
      const countryMatches = group.country.toLowerCase().includes(term);
      const zones = countryMatches ? group.zones : group.zones.filter((zone) => zone.search.includes(term));
      return { ...group, zones };
    })
    .filter((group) => group.zones.length > 0);
}
