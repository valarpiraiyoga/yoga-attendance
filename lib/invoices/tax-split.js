/**
 * How a stored invoice's total tax is PRESENTED as CGST and SGST.
 *
 * The configured tax rate is the combined GST rate, and the tax was calculated once, in the
 * database, when the invoice was issued (supabase/migrations/0026). That stored total tax is
 * authoritative: this helper never recalculates it, never touches the amount before tax, and
 * never reads the tax name. It only divides the stored total tax into two equal halves for
 * display, and halves the stored rate for the two labels:
 *
 *   rate:   5%     -> CGST @ 2.5%   and SGST @ 2.5%
 *           18%    -> CGST @ 9%     and SGST @ 9%
 *           5.25%  -> CGST @ 2.625% and SGST @ 2.625%
 *   amount: CGST = total tax / 2 rounded to the paisa (a half rounds up), SGST = total tax - CGST,
 *           so CGST + SGST equals the stored total tax EXACTLY.
 *
 * Everything is whole-number arithmetic on paise (hundredths) and thousandths of a percent,
 * parsed from the stored decimal text: no floating-point arithmetic touches an amount or a
 * rate, so a case like 4.545 cannot round the wrong way. Amounts come back as exact decimal
 * strings ("330.95").
 *
 * Pure (no database, no React). Existing invoices are not changed: this reads their stored
 * values at display time and writes nothing.
 */

// A stored numeric(10,2) / numeric(5,2) value: digits with at most two decimals.
const DECIMAL = /^(\d+)(?:\.(\d{1,2}))?$/;

/** "661.9" / 661.9 / "661.90" -> 66190 (hundredths), or null when it is not a plain stored decimal. */
function toHundredths(value) {
  if (value === null || value === undefined) return null;
  const match = DECIMAL.exec(String(value).trim());
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

/** 33095 (hundredths) -> "330.95". */
function formatHundredths(hundredths) {
  const whole = (hundredths - (hundredths % 100)) / 100;
  return `${whole}.${String(hundredths % 100).padStart(2, "0")}`;
}

/** 2625 (thousandths) -> "2.625"; 2500 -> "2.5"; 9000 -> "9". */
function formatThousandths(thousandths) {
  const whole = (thousandths - (thousandths % 1000)) / 1000;
  const fraction = String(thousandths % 1000)
    .padStart(3, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

/**
 * Splits a stored total tax into CGST and SGST for display.
 *
 * Returns null — no split to show — when there is no tax: tax disabled (null values), a zero
 * tax amount, or a rate that is missing or zero.
 *
 * @param {number|string|null|undefined} totalTax - the invoice's stored `tax_amount`.
 * @param {number|string|null|undefined} rate - the invoice's stored `tax_rate` (the combined rate, in percent).
 * @returns {{ rate: string, cgst: string, sgst: string, cgstPaise: number, sgstPaise: number } | null}
 */
export function splitTax(totalTax, rate) {
  const paise = toHundredths(totalTax);
  const rateHundredths = toHundredths(rate);
  if (paise === null || paise <= 0 || rateHundredths === null || rateHundredths <= 0) return null;

  // total / 2 rounded to the paisa, a half rounding up: (paise + 1) / 2 rounded down, in whole numbers.
  const cgstPaise = (paise + 1 - ((paise + 1) % 2)) / 2;
  const sgstPaise = paise - cgstPaise;

  return {
    // Half of the combined rate, in thousandths of a percent: hundredths x 5 = (hundredths / 2) in thousandths.
    rate: formatThousandths(rateHundredths * 5),
    cgst: formatHundredths(cgstPaise),
    sgst: formatHundredths(sgstPaise),
    cgstPaise,
    sgstPaise,
  };
}
