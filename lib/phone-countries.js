// Relative-import-free and framework-free, so `npm test` can load it under plain Node.

/**
 * Country metadata for the phone country-code selector — a small, maintainable
 * list (ISO 3166-1 alpha-2 code, English name, international calling code)
 * rather than a phone-number library: the application stores the calling code
 * and the national digits separately and only needs to pick and show the code.
 *
 * India first (the centre's country and the default), then alphabetical. A code
 * shared by several countries (+1, +7, +44 …) appears once per country, so the
 * picker can show — and search by — the country's name. The flag is derived
 * from the ISO code (regional-indicator letters), so there are no image assets.
 */
const RAW_COUNTRIES = `
IN|India|91
AF|Afghanistan|93
AL|Albania|355
DZ|Algeria|213
AD|Andorra|376
AO|Angola|244
AR|Argentina|54
AM|Armenia|374
AU|Australia|61
AT|Austria|43
AZ|Azerbaijan|994
BH|Bahrain|973
BD|Bangladesh|880
BY|Belarus|375
BE|Belgium|32
BT|Bhutan|975
BO|Bolivia|591
BA|Bosnia and Herzegovina|387
BW|Botswana|267
BR|Brazil|55
BN|Brunei|673
BG|Bulgaria|359
KH|Cambodia|855
CM|Cameroon|237
CA|Canada|1
CL|Chile|56
CN|China|86
CO|Colombia|57
CR|Costa Rica|506
HR|Croatia|385
CU|Cuba|53
CY|Cyprus|357
CZ|Czechia|420
DK|Denmark|45
DO|Dominican Republic|1
EC|Ecuador|593
EG|Egypt|20
SV|El Salvador|503
EE|Estonia|372
ET|Ethiopia|251
FJ|Fiji|679
FI|Finland|358
FR|France|33
GE|Georgia|995
DE|Germany|49
GH|Ghana|233
GR|Greece|30
GT|Guatemala|502
HK|Hong Kong|852
HU|Hungary|36
IS|Iceland|354
ID|Indonesia|62
IR|Iran|98
IQ|Iraq|964
IE|Ireland|353
IL|Israel|972
IT|Italy|39
JM|Jamaica|1
JP|Japan|81
JO|Jordan|962
KZ|Kazakhstan|7
KE|Kenya|254
KW|Kuwait|965
KG|Kyrgyzstan|996
LA|Laos|856
LV|Latvia|371
LB|Lebanon|961
LY|Libya|218
LT|Lithuania|370
LU|Luxembourg|352
MO|Macau|853
MG|Madagascar|261
MY|Malaysia|60
MV|Maldives|960
MT|Malta|356
MU|Mauritius|230
MX|Mexico|52
MD|Moldova|373
MN|Mongolia|976
ME|Montenegro|382
MA|Morocco|212
MZ|Mozambique|258
MM|Myanmar|95
NA|Namibia|264
NP|Nepal|977
NL|Netherlands|31
NZ|New Zealand|64
NG|Nigeria|234
MK|North Macedonia|389
NO|Norway|47
OM|Oman|968
PK|Pakistan|92
PS|Palestine|970
PA|Panama|507
PY|Paraguay|595
PE|Peru|51
PH|Philippines|63
PL|Poland|48
PT|Portugal|351
QA|Qatar|974
RO|Romania|40
RU|Russia|7
RW|Rwanda|250
SA|Saudi Arabia|966
SN|Senegal|221
RS|Serbia|381
SG|Singapore|65
SK|Slovakia|421
SI|Slovenia|386
ZA|South Africa|27
KR|South Korea|82
ES|Spain|34
LK|Sri Lanka|94
SD|Sudan|249
SE|Sweden|46
CH|Switzerland|41
SY|Syria|963
TW|Taiwan|886
TJ|Tajikistan|992
TZ|Tanzania|255
TH|Thailand|66
TN|Tunisia|216
TR|Turkey|90
UG|Uganda|256
UA|Ukraine|380
AE|United Arab Emirates|971
GB|United Kingdom|44
US|United States|1
UY|Uruguay|598
UZ|Uzbekistan|998
VE|Venezuela|58
VN|Vietnam|84
YE|Yemen|967
ZM|Zambia|260
ZW|Zimbabwe|263
`;

/** The default country — the centre is in India (amounts are in rupees). */
export const DEFAULT_COUNTRY_ISO = "IN";

/** `"IN"` -> the flag emoji (two regional-indicator letters). */
export function flagEmoji(iso) {
  return String(iso)
    .toUpperCase()
    .replace(/./g, (letter) => String.fromCodePoint(127397 + letter.charCodeAt(0)));
}

/** `{ iso, name, dialCode: "+91", flag }[]`, India first, the rest alphabetical. */
export const COUNTRIES = RAW_COUNTRIES.trim()
  .split("\n")
  .map((line) => {
    const [iso, name, digits] = line.split("|");
    return { iso, name, dialCode: `+${digits}`, flag: flagEmoji(iso) };
  });

/** The default country's entry (India, +91). */
export const DEFAULT_COUNTRY = COUNTRIES.find((country) => country.iso === DEFAULT_COUNTRY_ISO);

/**
 * The country a stored calling code stands for. A shared code (+1, +7 …)
 * resolves to the first country in the list that uses it (India for +91, the
 * United States for +1); an unknown code resolves to `null`, so a code outside
 * this list is still shown as itself rather than swallowed.
 */
export function countryForDialCode(dialCode) {
  return COUNTRIES.find((country) => country.dialCode === dialCode) ?? null;
}

/**
 * Countries matching a search term, by name, ISO code or calling code —
 * case-insensitive, and a leading "+" or "00" on a number is ignored ("+44",
 * "44" and "united" all find the United Kingdom). An empty term returns the
 * whole list.
 */
export function searchCountries(term) {
  const needle = String(term ?? "").trim().toLowerCase();
  if (!needle) return COUNTRIES;

  const digits = needle.replace(/^(\+|00)/, "");
  const numeric = /^\d+$/.test(digits);

  return COUNTRIES.filter((country) => {
    if (numeric && country.dialCode.slice(1).startsWith(digits)) return true;
    return country.name.toLowerCase().includes(needle) || country.iso.toLowerCase() === needle;
  });
}
