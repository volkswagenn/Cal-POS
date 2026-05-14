import type { Product } from '../../types';
import { money } from '../../utils/money';

export type ProductButtonSize = 'small' | 'medium' | 'large';
export type ProductFontSize = 'small' | 'medium' | 'large';

export const productGridClasses: Record<ProductButtonSize, string> = {
  small: 'grid-cols-[repeat(auto-fill,112px)]',
  medium: 'grid-cols-[repeat(auto-fill,172px)]',
  large: 'grid-cols-[repeat(auto-fill,220px)]',
};

export const posProductGridClasses: Record<ProductButtonSize, string> = {
  small: 'grid-cols-3 sm:grid-cols-[repeat(auto-fill,112px)]',
  medium: 'grid-cols-2 sm:grid-cols-[repeat(auto-fill,172px)]',
  large: 'grid-cols-2 sm:grid-cols-[repeat(auto-fill,220px)]',
};

const sizeClasses: Record<ProductButtonSize, { card: string; responsiveCard: string; number: string; name: string; price: string; nameArea: string; nameWrap: string }> = {
  small: {
    card: 'h-24 w-[112px] p-2',
    responsiveCard: 'h-24 w-full p-2 sm:w-[112px]',
    number: 'text-2xl',
    name: 'text-xs',
    price: 'text-xs',
    nameArea: '',
    nameWrap: 'truncate',
  },
  medium: {
    card: 'h-32 w-[172px] p-3',
    responsiveCard: 'h-28 w-full p-2.5 sm:h-32 sm:w-[172px] sm:p-3',
    number: 'text-3xl',
    name: 'text-sm',
    price: 'text-sm',
    nameArea: 'flex min-h-10 items-center',
    nameWrap: 'overflow-hidden [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]',
  },
  large: {
    card: 'h-40 w-[220px] p-4',
    responsiveCard: 'h-32 w-full p-3 sm:h-40 sm:w-[220px] sm:p-4',
    number: 'text-5xl',
    name: 'text-base',
    price: 'text-base',
    nameArea: 'flex min-h-14 items-center',
    nameWrap: 'overflow-hidden [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]',
  },
};

const displayFontClasses: Record<ProductFontSize, string> = {
  small: 'text-2xl',
  medium: 'text-3xl',
  large: 'text-5xl',
};

const nameFontClasses: Record<ProductFontSize, string> = {
  small: 'text-xs',
  medium: 'text-sm',
  large: 'text-base',
};

const priceFontClasses: Record<ProductFontSize, string> = {
  small: 'text-xs',
  medium: 'text-sm',
  large: 'text-base',
};

export function ProductButton({
  product,
  quantity,
  onClick,
  size = 'medium',
  displayFontSize = 'medium',
  nameFontSize = 'medium',
  priceFontSize = 'medium',
  displayFontPx,
  nameFontPx,
  priceFontPx,
  compactOnMobile = false,
}: {
  product: Product;
  quantity: number;
  onClick: () => void;
  size?: ProductButtonSize;
  displayFontSize?: ProductFontSize;
  nameFontSize?: ProductFontSize;
  priceFontSize?: ProductFontSize;
  displayFontPx?: number;
  nameFontPx?: number;
  priceFontPx?: number;
  compactOnMobile?: boolean;
}) {
  const styles = sizeClasses[size] ?? sizeClasses.medium;
  const productName = product.isOpenPrice ? 'กำหนดราคาเอง' : product.name;
  const displayText = product.isOpenPrice ? 'OPEN' : (product.displayName || product.name);
  const priceText = product.isOpenPrice ? 'แตะเพื่อใส่ราคา' : money(product.price);
  const displayClass = displayFontClasses[displayFontSize] ?? displayFontClasses.medium;
  const nameClass = nameFontClasses[nameFontSize] ?? nameFontClasses.medium;
  const priceClass = priceFontClasses[priceFontSize] ?? priceFontClasses.medium;
  const cardClass = compactOnMobile ? styles.responsiveCard : styles.card;
  const displayStyle = displayFontPx ? { fontSize: compactOnMobile ? `clamp(22px, 8vw, ${displayFontPx}px)` : `${displayFontPx}px` } : undefined;
  const nameStyle = nameFontPx ? { fontSize: compactOnMobile ? `clamp(11px, 3.6vw, ${nameFontPx}px)` : `${nameFontPx}px` } : undefined;
  const priceStyle = priceFontPx ? { fontSize: compactOnMobile ? `clamp(11px, 3.6vw, ${priceFontPx}px)` : `${priceFontPx}px` } : undefined;

  return (
    <button
      onClick={onClick}
      className={`relative flex flex-col overflow-hidden rounded-lg border-2 bg-white text-left shadow-sm transition active:translate-y-0 ${cardClass}`}
      style={{ borderColor: product.color }}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {quantity > 0 && <span className="absolute right-2 top-2 rounded-full bg-primary-600 px-2 py-0.5 text-xs font-black text-white">{quantity}</span>}
        <div className={`${displayClass || styles.number} max-w-full truncate font-black leading-none`} style={{ color: product.color, ...displayStyle }}>
          {displayText}
        </div>
        <div className={`mt-2 max-w-full ${styles.nameArea}`}>
          <div className={`max-w-full font-bold leading-snug text-slate-700 ${nameClass || styles.name} ${styles.nameWrap}`} style={nameStyle}>
            {productName}
          </div>
        </div>
        <div className={`mt-auto max-w-full truncate pt-1 font-semibold text-slate-500 ${priceClass || styles.price}`} style={priceStyle}>
          {priceText}
        </div>
      </div>
    </button>
  );
}
