import type { Product } from '../types';

export function numericProductName(input: string, fallbackPrice?: number) {
  const numberText = input.match(/\d+(?:\.\d+)?/g)?.join('') ?? '';
  if (numberText) return numberText;
  if (fallbackPrice && fallbackPrice > 0) return String(fallbackPrice);
  return '';
}

export function productPriceName(price: number) {
  return Number.isInteger(price) ? String(price) : String(price).replace(/\.?0+$/, '');
}

export function productNameWithBaht(input: string, fallbackPrice?: number) {
  const trimmed = input.trim();
  if (/บาท$/u.test(trimmed)) return trimmed;
  const numeric = numericProductName(trimmed, fallbackPrice);
  return numeric ? `${numeric} บาท` : trimmed;
}

export function shouldKeepProductName(product: Pick<Product, 'categoryId' | 'isOpenPrice'>) {
  return product.isOpenPrice || product.categoryId === 'cat_open';
}

export function normalizeProductNameFields<T extends Partial<Product> & Pick<Product, 'categoryId' | 'isOpenPrice'>>(product: T): T {
  if (shouldKeepProductName(product)) return product;
  const price = Number(product.price ?? 0);
  const normalized = price > 0 ? productPriceName(price) : numericProductName(`${product.name ?? ''} ${product.displayName ?? ''}`, price);
  if (!normalized) return product;
  const displayName = `${product.displayName ?? ''}`.trim() || normalized;
  return { ...product, name: `${normalized} บาท`, displayName };
}
