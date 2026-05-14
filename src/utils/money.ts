export function money(value: number, currency = '฿') {
  return `${currency}${Number(value || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function clampDiscount(total: number, amount: number, percent: number) {
  const raw = Math.max(0, amount) + total * (Math.max(0, percent) / 100);
  return Math.min(total, raw);
}
