/**
 * Money handling for Kontrora.
 *
 * All monetary amounts are stored and transported as **integer minor units**
 * (cents for USD/EUR/GBP, yen for JPY, fils for BHD/KWD/...). Floating point
 * is never used to hold an amount — only for display formatting.
 *
 * The platform had no money helper before this module: the only monetary
 * column in the schema is `escrows.amount_per_milestone BIGINT`, and the one
 * component that displayed it (`components/project-escrow.tsx`) was never
 * rendered. This module is therefore the single place where the platform's
 * money rules live.
 */

/** ISO 4217 currencies whose minor unit is not 1/100. */
const MINOR_UNIT_EXPONENTS: Record<string, number> = {
  BHD: 3,
  CLP: 0,
  CVE: 0,
  DJF: 0,
  GNF: 0,
  IDR: 0,
  IQD: 3,
  ISK: 0,
  JOD: 3,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  PYG: 0,
  RWF: 0,
  TND: 3,
  UGX: 0,
  UYI: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
};

/** Default currency used when a record does not carry one. */
export const DEFAULT_CURRENCY = 'USD';

/**
 * Number of decimal places between a major unit and its minor unit.
 * Defaults to 2 (cents) for every currency not listed above.
 */
export function minorUnitExponent(currency: string = DEFAULT_CURRENCY): number {
  return MINOR_UNIT_EXPONENTS[currency.toUpperCase()] ?? 2;
}

/** True when the currency code is a well-formed ISO 4217 alphabetic code. */
export function isValidCurrency(currency: string): boolean {
  return /^[A-Za-z]{3}$/.test(currency);
}

/**
 * Convert minor units to a major-unit number for display purposes only.
 * Never use the result for arithmetic that is persisted.
 */
export function toMajorUnits(amountMinor: number, currency: string = DEFAULT_CURRENCY): number {
  return amountMinor / 10 ** minorUnitExponent(currency);
}

/**
 * Format minor units as a localised currency string.
 *
 * `formatMinor(123456, 'USD')` -> "$1,234.56"
 * `formatMinor(1234, 'JPY')`   -> "¥1,234"
 */
export function formatMinor(
  amountMinor: number,
  currency: string = DEFAULT_CURRENCY,
  locale: string = 'en-US'
): string {
  const code = currency.toUpperCase();
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
    }).format(toMajorUnits(amountMinor, code));
  } catch {
    // Unknown currency codes fall back to a plain decimal with the code.
    return `${toMajorUnits(amountMinor, code).toFixed(minorUnitExponent(code))} ${code}`;
  }
}

/**
 * Parse a human-entered amount into minor units without floating point loss.
 *
 * Accepts "1234.56", "1,234.56", "1 234.56", "$1,234.56" and "-12.00".
 * Returns null when the input is not a usable amount, or when it carries
 * more precision than the currency can represent (e.g. 10.005 USD) — silently
 * truncating money is worse than rejecting it.
 */
export function parseMinor(
  input: string | number,
  currency: string = DEFAULT_CURRENCY
): number | null {
  const exponent = minorUnitExponent(currency);

  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    const scaled = Math.round(input * 10 ** exponent);
    return Number.isSafeInteger(scaled) ? scaled : null;
  }

  const cleaned = input.trim().replace(/[\s,]/g, '').replace(/[^0-9.\-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.' || cleaned === '-.') return null;

  const negative = cleaned.startsWith('-');
  const absolute = negative ? cleaned.slice(1) : cleaned;
  const [whole, fraction = ''] = absolute.split('.');

  if (whole === '' && fraction === '') return null;
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(fraction)) return null;
  // Refuse to silently drop precision the currency cannot represent — but
  // trailing zeros are harmless ("1234.00" JPY is 1234 yen).
  if (fraction.length > exponent && /[1-9]/.test(fraction.slice(exponent))) return null;

  const padded = fraction.padEnd(exponent, '0');
  const value = Number(whole || '0') * 10 ** exponent + Number(padded || '0');
  if (!Number.isSafeInteger(value)) return null;

  return negative ? -value : value;
}

/** Format a quantity held in thousandths ("milli-units") for display. */
export function formatQuantity(quantityMilli: number): string {
  const value = quantityMilli / 1000;
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '');
}

/** Parse a human-entered quantity into thousandths. */
export function parseQuantity(input: string | number): number | null {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    return Math.round(input * 1000);
  }
  const cleaned = input.trim().replace(/[\s,]/g, '');
  if (cleaned === '') return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 1000);
}

/**
 * Line amount in minor units for a quantity held in thousandths.
 *
 * `unitAmountMinor * quantityMilli / 1000`, rounded half-up to the minor unit.
 */
export function lineAmountMinor(quantityMilli: number, unitAmountMinor: number): number {
  return Math.round((unitAmountMinor * quantityMilli) / 1000);
}

/** Tax for an amount given a rate expressed in basis points (1/100 of a percent). */
export function taxAmountMinor(amountMinor: number, rateBasisPoints: number): number {
  return Math.round((amountMinor * rateBasisPoints) / 10000);
}

/** Sum a list of minor-unit amounts, guarding against non-integer input. */
export function sumMinor(amounts: number[]): number {
  return amounts.reduce((total, amount) => total + (Number.isFinite(amount) ? amount : 0), 0);
}

/** Format a basis-point tax rate for display ("2000" -> "20%", "1750" -> "17.5%"). */
export function formatTaxRate(rateBasisPoints: number): string {
  // Round to four decimal places first so floating point noise does not leak
  // into the rendered rate.
  const percent = Math.round((rateBasisPoints / 100) * 10000) / 10000;
  return `${percent}%`;
}
