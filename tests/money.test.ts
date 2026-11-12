import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CURRENCY,
  formatMinor,
  formatQuantity,
  formatTaxRate,
  isValidCurrency,
  lineAmountMinor,
  minorUnitExponent,
  parseMinor,
  parseQuantity,
  sumMinor,
  taxAmountMinor,
  toMajorUnits,
} from '@/lib/money';

/**
 * Money is the one place in this codebase where a rounding mistake is
 * silently wrong rather than loudly broken, so it gets unit tests.
 */
describe('minorUnitExponent', () => {
  it('defaults to 2 (cents)', () => {
    expect(minorUnitExponent('USD')).toBe(2);
    expect(minorUnitExponent('EUR')).toBe(2);
    expect(minorUnitExponent('GBP')).toBe(2);
  });

  it('knows the currencies that are not 1/100', () => {
    expect(minorUnitExponent('JPY')).toBe(0);
    expect(minorUnitExponent('KRW')).toBe(0);
    expect(minorUnitExponent('BHD')).toBe(3);
    expect(minorUnitExponent('KWD')).toBe(3);
  });

  it('is case insensitive and defaults sensibly', () => {
    expect(minorUnitExponent('jpy')).toBe(0);
    expect(minorUnitExponent('ZZZ')).toBe(2);
  });
});

describe('parseMinor', () => {
  it('parses plain decimals', () => {
    expect(parseMinor('12.34', 'USD')).toBe(1234);
    expect(parseMinor('0.01', 'USD')).toBe(1);
    expect(parseMinor('1000', 'USD')).toBe(100000);
  });

  it('parses formatted input', () => {
    expect(parseMinor('1,234.56', 'USD')).toBe(123456);
    expect(parseMinor('$1,234.56', 'USD')).toBe(123456);
    expect(parseMinor(' 12.34 ', 'USD')).toBe(1234);
  });

  it('parses negatives', () => {
    expect(parseMinor('-12.34', 'USD')).toBe(-1234);
  });

  it('handles zero-decimal currencies', () => {
    expect(parseMinor('1234', 'JPY')).toBe(1234);
    expect(parseMinor('1234.00', 'JPY')).toBe(1234);
  });

  it('handles three-decimal currencies', () => {
    expect(parseMinor('1.234', 'BHD')).toBe(1234);
  });

  it('refuses to silently drop precision', () => {
    // 10.005 USD cannot be represented in cents.
    expect(parseMinor('10.005', 'USD')).toBeNull();
    expect(parseMinor('10.005', 'BHD')).toBe(10005);
  });

  it('rejects unusable input', () => {
    expect(parseMinor('', 'USD')).toBeNull();
    expect(parseMinor('.', 'USD')).toBeNull();
    expect(parseMinor('-', 'USD')).toBeNull();
    expect(parseMinor('abc', 'USD')).toBeNull();
  });

  it('round trips through formatMinor', () => {
    expect(parseMinor('1250.00', 'USD')).toBe(125000);
    expect(formatMinor(125000, 'USD', 'en-US')).toContain('1,250');
  });
});

describe('formatMinor', () => {
  it('formats cents as currency', () => {
    expect(formatMinor(123456, 'USD', 'en-US')).toBe('$1,234.56');
    expect(formatMinor(0, 'USD', 'en-US')).toBe('$0.00');
    expect(formatMinor(-5000, 'USD', 'en-US')).toBe('-$50.00');
  });

  it('formats zero-decimal currencies without decimals', () => {
    expect(formatMinor(1234, 'JPY', 'en-US')).toBe('¥1,234');
  });

  it('falls back for an unknown currency code', () => {
    expect(formatMinor(100, 'ZZZ', 'en-US')).toContain('ZZZ');
  });
});

describe('toMajorUnits', () => {
  it('converts minor units for display', () => {
    expect(toMajorUnits(123456, 'USD')).toBe(1234.56);
    expect(toMajorUnits(1234, 'JPY')).toBe(1234);
  });
});

describe('quantity handling', () => {
  it('parses fractional quantities into thousandths', () => {
    expect(parseQuantity('2.5')).toBe(2500);
    expect(parseQuantity('2')).toBe(2000);
    expect(parseQuantity('0.125')).toBe(125);
  });

  it('formats thousandths back', () => {
    expect(formatQuantity(2500)).toBe('2.5');
    expect(formatQuantity(2000)).toBe('2');
    expect(formatQuantity(125)).toBe('0.125');
  });

  it('rejects unusable quantities', () => {
    expect(parseQuantity('')).toBeNull();
    expect(parseQuantity('abc')).toBeNull();
  });
});

describe('lineAmountMinor', () => {
  it('multiplies quantity by unit price in minor units', () => {
    expect(lineAmountMinor(1000, 12500)).toBe(12500); // 1 x $125.00
    expect(lineAmountMinor(2500, 12500)).toBe(31250); // 2.5 x $125.00
  });

  it('rounds half-up to the minor unit', () => {
    // 3 x $0.005 would be 1.5 cents -> 2 cents
    expect(lineAmountMinor(3000, 1)).toBe(3);
    // 1.5 x $0.01 = 1.5 cents -> 2 cents
    expect(lineAmountMinor(1500, 1)).toBe(2);
  });

  it('does not lose a cent to floating point', () => {
    // 0.1 + 0.2 style drift: 3 x $33.33 must be 9999, not 9998.
    expect(lineAmountMinor(3000, 3333)).toBe(9999);
  });
});

describe('taxAmountMinor', () => {
  it('applies a basis point rate', () => {
    expect(taxAmountMinor(10000, 2000)).toBe(2000); // 20% of $100.00
    expect(taxAmountMinor(10000, 0)).toBe(0);
    expect(taxAmountMinor(10000, 10000)).toBe(10000); // 100%
  });

  it('rounds to the minor unit', () => {
    expect(taxAmountMinor(333, 2000)).toBe(67); // 66.6 -> 67
  });
});

describe('sumMinor', () => {
  it('adds minor units', () => {
    expect(sumMinor([100, 250, 25])).toBe(375);
    expect(sumMinor([])).toBe(0);
  });

  it('ignores non-finite values instead of producing NaN', () => {
    expect(sumMinor([100, Number.NaN, 25])).toBe(125);
  });
});

describe('formatTaxRate', () => {
  it('renders basis points as a percentage', () => {
    expect(formatTaxRate(2000)).toBe('20%');
    expect(formatTaxRate(0)).toBe('0%');
    expect(formatTaxRate(1750)).toBe('17.5%');
  });
});

describe('isValidCurrency', () => {
  it('accepts ISO 4217 alphabetic codes', () => {
    expect(isValidCurrency('USD')).toBe(true);
    expect(isValidCurrency('EUR')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isValidCurrency('US')).toBe(false);
    expect(isValidCurrency('US1')).toBe(false);
    expect(isValidCurrency('')).toBe(false);
  });
});

describe('DEFAULT_CURRENCY', () => {
  it('is USD', () => {
    expect(DEFAULT_CURRENCY).toBe('USD');
  });
});
