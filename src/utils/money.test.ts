import { describe, expect, it } from 'vitest';
import { clampDiscount, money } from './money';

describe('money utilities', () => {
  it('formats Thai baht display', () => {
    expect(money(1200)).toBe('฿1,200.00');
  });

  it('never lets discounts make totals negative', () => {
    expect(clampDiscount(100, 150, 0)).toBe(100);
    expect(clampDiscount(100, 20, 90)).toBe(100);
  });
});
