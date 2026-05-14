import { BadgeDollarSign, Edit3, FileText, MoreVertical, Percent, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Modal } from '../common/Modal';
import { useCartStore } from '../../stores/cartStore';
import { SettingsRepository } from '../../db/repositories/SettingsRepository';
import { useAsync } from '../../hooks/useAsync';
import type { CartItem } from '../../types';
import { clampDiscount, money } from '../../utils/money';
import { usePermissions } from '../../hooks/usePermissions';

type DiscountMode = 'amount' | 'percent';

function itemDiscountValue(item: CartItem) {
  return clampDiscount(item.price * item.quantity, item.discountAmount, item.discountPercent);
}

function itemDiscountText(item: CartItem) {
  const parts = [];
  if (item.discountAmount > 0) parts.push(`ลด ${money(clampDiscount(item.price * item.quantity, item.discountAmount, 0))}`);
  if (item.discountPercent > 0) parts.push(`ลด ${item.discountPercent}% (${money(clampDiscount(item.price * item.quantity, 0, item.discountPercent))})`);
  return parts.join(' / ');
}

function itemNetTotal(item: CartItem) {
  const gross = item.price * item.quantity;
  return Math.max(0, gross - itemDiscountValue(item));
}

function NumberPad({ onKey, compact = true }: { onKey: (key: string) => void; compact?: boolean }) {
  const keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', 'ลบ'];
  return (
    <div className="grid grid-cols-3 gap-2">
      {keys.map((key) => (
        <button key={key} type="button" className={`rounded-md bg-slate-100 text-xl font-black hover:bg-slate-200 ${compact ? 'py-2.5' : 'py-4'}`} onClick={() => onKey(key)}>
          {key}
        </button>
      ))}
    </div>
  );
}

function appendNumber(current: string, key: string) {
  if (key === '.') return current.includes('.') ? current : `${current || '0'}.`;
  return `${current === '0' ? '' : current}${key}`;
}

function QuantityModal({ item, onClose, onConfirm }: { item: CartItem; onClose: () => void; onConfirm: (quantity: number) => void }) {
  const [value, setValue] = useState('');
  const keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', 'ล้าง', '0', 'ลบ'];
  const press = (key: string) => {
    if (key === 'ล้าง') return setValue('');
    if (key === 'ลบ') return setValue((current) => current.slice(0, -1));
    if (key === '.') return;
    setValue((current) => appendNumber(current, key));
  };

  return (
    <Modal title="จำนวนสินค้า" onClose={onClose}>
      <div className="mb-3 min-h-24 rounded-md bg-slate-100 p-4 text-right text-5xl font-black">{value}</div>
      <div className="mb-3 text-sm text-slate-500">{item.name}</div>
      <div className="grid grid-cols-3 gap-2">
        {keys.map((key) => (
          <button key={key} className="rounded-md bg-slate-100 py-4 text-xl font-black hover:bg-slate-200" onClick={() => press(key)}>
            {key}
          </button>
        ))}
      </div>
      <button className="mt-4 w-full rounded-md bg-primary-600 py-4 text-lg font-black text-white hover:bg-primary-700" onClick={() => onConfirm(Math.max(0, Number(value || 0)))}>
        ตกลง
      </button>
    </Modal>
  );
}

function ItemDiscountModal({
  item,
  mode,
  onClose,
  onSave,
}: {
  item: CartItem;
  mode: DiscountMode;
  onClose: () => void;
  onSave: (patch: Partial<CartItem>) => void;
}) {
  const [value, setValue] = useState(String(mode === 'amount' ? item.discountAmount || '' : item.discountPercent || ''));
  const gross = item.price * item.quantity;
  const numberValue = Math.max(0, Number(value || 0));
  const previewDiscount = mode === 'amount' ? clampDiscount(gross, numberValue, 0) : clampDiscount(gross, 0, Math.min(100, numberValue));
  const press = (key: string) => {
    if (key === 'ลบ') return setValue((current) => current.slice(0, -1));
    setValue((current) => appendNumber(current, key));
  };

  return (
    <Modal title={mode === 'amount' ? 'ลดบาท' : 'ลด %'} onClose={onClose}>
      <div className="mb-2 rounded-md bg-slate-50 p-2">
        <div className="font-black">{item.name}</div>
        <div className="text-sm text-slate-500">ยอดก่อนลด {money(gross)}</div>
      </div>
      <label className="block text-sm font-bold text-slate-700">
        {mode === 'amount' ? 'จำนวนเงินที่ลด' : 'เปอร์เซ็นต์ส่วนลด'}
        <div className="mt-1 flex min-h-12 overflow-hidden rounded-md border border-slate-300 bg-white">
          <div className="grid w-full place-items-center px-3 text-right text-2xl font-black">{value || <span className="text-slate-300">0</span>}</div>
          <span className="grid min-w-12 place-items-center bg-slate-100 px-3 font-black text-slate-600">{mode === 'amount' ? '฿' : '%'}</span>
        </div>
      </label>
      <div className="mt-3">
        <NumberPad onKey={press} />
      </div>
      <div className="mt-2 rounded-md bg-primary-50 p-2 text-sm">
        <div className="flex justify-between text-slate-600">
          <span>ส่วนลดที่คำนวณได้</span>
          <b className="text-red-600">{money(previewDiscount)}</b>
        </div>
        <div className="mt-1 flex justify-between text-base font-black text-slate-950">
          <span>ยอดหลังลด</span>
          <span>{money(Math.max(0, gross - previewDiscount))}</span>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button className="rounded-md bg-slate-100 py-3 font-bold text-slate-700" onClick={onClose}>ยกเลิก</button>
        <button
          className="rounded-md bg-primary-600 py-3 font-bold text-white"
          onClick={() => {
            if (mode === 'amount') onSave({ discountAmount: numberValue, discountPercent: 0 });
            else onSave({ discountAmount: 0, discountPercent: Math.min(100, numberValue) });
            onClose();
          }}
        >
          บันทึกส่วนลด
        </button>
      </div>
    </Modal>
  );
}

function BillDiscountModal({
  mode,
  initialValue,
  base,
  onClose,
  onSave,
}: {
  mode: DiscountMode;
  initialValue: number;
  base: number;
  onClose: () => void;
  onSave: (value: number) => void;
}) {
  const [value, setValue] = useState(initialValue > 0 ? String(initialValue) : '');
  const numberValue = Math.max(0, Number(value || 0));
  const previewDiscount = mode === 'amount' ? clampDiscount(base, numberValue, 0) : clampDiscount(base, 0, Math.min(100, numberValue));
  const press = (key: string) => {
    if (key === 'ลบ') return setValue((current) => current.slice(0, -1));
    setValue((current) => appendNumber(current, key));
  };

  return (
    <Modal title={mode === 'amount' ? 'ส่วนลดท้ายบิล' : 'ส่วนลดท้ายบิล %'} onClose={onClose}>
      <label className="block text-sm font-bold text-slate-700">
        {mode === 'amount' ? 'จำนวนเงินที่ลด' : 'เปอร์เซ็นต์ส่วนลด'}
        <div className="mt-1 flex min-h-12 overflow-hidden rounded-md border border-slate-300 bg-white">
          <div className="grid w-full place-items-center px-3 text-right text-2xl font-black">{value || <span className="text-slate-300">0</span>}</div>
          <span className="grid min-w-12 place-items-center bg-slate-100 px-3 font-black text-slate-600">{mode === 'amount' ? '฿' : '%'}</span>
        </div>
      </label>
      <div className="mt-3">
        <NumberPad onKey={press} />
      </div>
      <div className="mt-2 rounded-md bg-primary-50 p-2 text-sm">
        <div className="flex justify-between text-slate-600"><span>ส่วนลดที่คำนวณได้</span><b className="text-red-600">{money(previewDiscount)}</b></div>
        <div className="mt-1 flex justify-between text-base font-black text-slate-950"><span>ยอดหลังลด</span><span>{money(Math.max(0, base - previewDiscount))}</span></div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button className="rounded-md bg-slate-100 py-3 font-bold text-slate-700" onClick={onClose}>ยกเลิก</button>
        <button className="rounded-md bg-primary-600 py-3 font-bold text-white" onClick={() => { onSave(numberValue); onClose(); }}>บันทึกส่วนลด</button>
      </div>
    </Modal>
  );
}

function ItemPriceNoteModal({
  item,
  mode,
  onClose,
  onSave,
}: {
  item: CartItem;
  mode: 'price' | 'note';
  onClose: () => void;
  onSave: (patch: Partial<CartItem>) => void;
}) {
  const [price, setPrice] = useState(String(item.price));
  const [note, setNote] = useState(item.note ?? '');
  const isPriceMode = mode === 'price';

  return (
    <Modal title={isPriceMode ? 'แก้ไขราคาขาย' : 'หมายเหตุรายการขาย'} onClose={onClose}>
      <div className="mb-4 rounded-md bg-slate-50 p-3">
        <div className="font-black">{item.name}</div>
        <div className="text-sm text-slate-500">จำนวน {item.quantity} ชิ้น</div>
      </div>
      {isPriceMode ? (
        <label className="block text-sm font-bold text-slate-700">
          ราคาขายต่อชิ้น
          <input type="number" min={0} className="mt-1 w-full rounded-md border-slate-300" value={price} onChange={(event) => setPrice(event.target.value)} autoFocus />
        </label>
      ) : (
        <label className="block text-sm font-bold text-slate-700">
          หมายเหตุ
          <textarea className="mt-1 w-full rounded-md border-slate-300" rows={3} value={note} onChange={(event) => setNote(event.target.value)} autoFocus />
        </label>
      )}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button className="rounded-md bg-slate-100 py-3 font-bold text-slate-700" onClick={onClose}>ยกเลิก</button>
        <button
          className="rounded-md bg-primary-600 py-3 font-bold text-white"
          onClick={() => {
            onSave(isPriceMode ? { price: Math.max(0, Number(price || 0)) } : { note });
            onClose();
          }}
        >
          บันทึก
        </button>
      </div>
    </Modal>
  );
}

export function CartPanel({ onPay }: { onPay: () => void }) {
  const { items, remove, updateItem, clear, setBillDiscount, billDiscountAmount, billDiscountPercent, summary } = useCartStore();
  const { can } = usePermissions();
  const { data: allowSalePriceEditSetting } = useAsync(() => SettingsRepository.getSetting('allowSalePriceEdit', 'false'), []);
  const [quantityItem, setQuantityItem] = useState<CartItem | null>(null);
  const [discountItem, setDiscountItem] = useState<{ item: CartItem; mode: DiscountMode } | null>(null);
  const [priceNoteItem, setPriceNoteItem] = useState<{ item: CartItem; mode: 'price' | 'note' } | null>(null);
  const [menuItem, setMenuItem] = useState<CartItem | null>(null);
  const [billDiscountMode, setBillDiscountMode] = useState<DiscountMode>(billDiscountPercent > 0 ? 'percent' : 'amount');
  const [billDiscountOpen, setBillDiscountOpen] = useState(false);
  const totals = summary();
  const lineCount = useMemo(() => items.length, [items]);
  const allowPriceEdit = allowSalePriceEditSetting === 'true' && can('edit_sale_price');
  const itemDiscountTotal = useMemo(() => items.reduce((sum, item) => sum + itemDiscountValue(item), 0), [items]);
  const billDiscountBase = Math.max(0, totals.subtotal - itemDiscountTotal);
  const billDiscountTotal = clampDiscount(billDiscountBase, billDiscountAmount, billDiscountPercent);
  const billDiscountValue = billDiscountMode === 'amount' ? billDiscountAmount : billDiscountPercent;

  return (
    <section className="flex h-full flex-col rounded-lg border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <h2 className="text-lg font-black">ตะกร้าปัจจุบัน</h2>
          <p className="text-sm text-slate-500">{lineCount} รายการ | {totals.itemCount} ชิ้น</p>
        </div>
        <button onClick={clear} className="rounded-md bg-red-600 px-3 py-2 text-sm font-black text-white shadow-sm hover:bg-red-700">ล้าง</button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto bg-slate-50">
        {items.length === 0 ? (
          <div className="grid h-44 place-items-center text-center text-slate-400">เลือกสินค้าเพื่อเริ่มขาย</div>
        ) : (
          <div className="divide-y divide-slate-200">
            {items.map((item, index) => {
              const discount = itemDiscountText(item);
              const grossTotal = item.price * item.quantity;
              const netTotal = itemNetTotal(item);
              return (
                <article key={item.cartItemId} className="bg-white px-3 py-2">
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <div className="min-w-0">
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 text-xs text-slate-500">{index + 1}.</span>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-black text-slate-950">{item.name}</div>
                          <div className="text-xs text-slate-500">
                            {money(item.price)}
                            {discount && <span className="ml-2 text-red-600">{discount}</span>}
                          </div>
                          {item.note && <div className="mt-1 truncate text-xs text-amber-700">หมายเหตุ: {item.note}</div>}
                        </div>
                      </div>
                      <div className="relative mt-1.5 ml-6 flex justify-start gap-1">
                        <button
                          className="rounded-md border border-red-100 bg-red-50 p-1.5 text-red-600 hover:bg-red-100"
                          onClick={() => remove(item.cartItemId)}
                          aria-label="ลบรายการ"
                        >
                          <Trash2 size={16} />
                        </button>
                        <button
                          className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50"
                          onClick={() => setMenuItem((current) => (current?.cartItemId === item.cartItemId ? null : item))}
                          aria-label="เมนูรายการ"
                        >
                          <MoreVertical size={16} />
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-col items-end justify-between text-right">
                      <div className="text-right">
                        <div className="text-base font-black text-slate-950">{money(netTotal)}</div>
                        {discount && <div className="text-xs font-bold text-slate-400 line-through">{money(grossTotal)}</div>}
                      </div>
                      <button
                        className="mt-2 min-h-9 min-w-16 rounded-md border border-primary-100 bg-primary-50 px-3 py-2 text-sm font-black text-primary-700 hover:bg-primary-100"
                        onClick={() => setQuantityItem(item)}
                      >
                        x {item.quantity}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <footer className="space-y-2 border-t border-slate-200 p-3 md:space-y-3 md:p-4">
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <label className="flex items-center gap-2 rounded-md bg-slate-100 px-3">
            <Edit3 size={16} className="text-slate-500" />
            <input
              inputMode="none"
              readOnly
              className="w-full border-0 bg-transparent focus:ring-0"
              placeholder="ลดท้ายบิล"
              value={billDiscountValue || ''}
              onClick={() => setBillDiscountOpen(true)}
              onFocus={() => setBillDiscountOpen(true)}
            />
          </label>
          <div className="flex overflow-hidden rounded-md border border-slate-200">
            <button
              type="button"
              className={`px-3 font-black ${billDiscountMode === 'amount' ? 'bg-slate-700 text-white' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}
              onClick={() => {
                setBillDiscountMode('amount');
                setBillDiscount(billDiscountAmount, 0);
              }}
            >
              ฿
            </button>
            <button
              type="button"
              className={`px-3 font-black ${billDiscountMode === 'percent' ? 'bg-slate-700 text-white' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}
              onClick={() => {
                setBillDiscountMode('percent');
                setBillDiscount(0, billDiscountPercent);
              }}
            >
              %
            </button>
          </div>
        </div>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between text-slate-500"><span>รวม</span><b>{money(totals.subtotal)}</b></div>
          <div className="flex justify-between text-red-600"><span>ส่วนลดรายการ</span><b>{money(itemDiscountTotal)}</b></div>
          <div className="flex justify-between text-red-600">
            <span>ส่วนลดท้ายบิล{billDiscountPercent > 0 ? ` ${billDiscountPercent}%` : ''}</span>
            <b>{money(billDiscountTotal)}</b>
          </div>
          <div className="flex justify-between text-xl font-black md:text-2xl"><span>รวมสุทธิ</span><span className="text-primary-700">{money(totals.grandTotal)}</span></div>
        </div>
        <button onClick={onPay} className="w-full rounded-md bg-primary-600 py-3 text-xl font-black text-white shadow-sm hover:bg-primary-700 md:py-4 md:text-2xl">
          ชำระเงิน
        </button>
      </footer>

      {quantityItem && (
        <QuantityModal
          item={quantityItem}
          onClose={() => setQuantityItem(null)}
          onConfirm={(quantity) => {
            if (quantity <= 0) remove(quantityItem.cartItemId);
            else updateItem(quantityItem.cartItemId, { quantity });
            setQuantityItem(null);
          }}
        />
      )}
      {discountItem && (
        <ItemDiscountModal
          item={discountItem.item}
          mode={discountItem.mode}
          onClose={() => setDiscountItem(null)}
          onSave={(patch) => updateItem(discountItem.item.cartItemId, patch)}
        />
      )}
      {billDiscountOpen && (
        <BillDiscountModal
          mode={billDiscountMode}
          initialValue={billDiscountValue}
          base={billDiscountBase}
          onClose={() => setBillDiscountOpen(false)}
          onSave={(value) => {
            if (billDiscountMode === 'amount') setBillDiscount(value, 0);
            else setBillDiscount(0, Math.min(100, value));
          }}
        />
      )}
      {priceNoteItem && (
        <ItemPriceNoteModal
          item={priceNoteItem.item}
          mode={priceNoteItem.mode}
          onClose={() => setPriceNoteItem(null)}
          onSave={(patch) => updateItem(priceNoteItem.item.cartItemId, patch)}
        />
      )}
      {menuItem && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/25 p-3 sm:items-center">
          <button className="absolute inset-0 cursor-default" onClick={() => setMenuItem(null)} aria-label="ปิดเมนู" />
          <div className="relative w-full max-w-sm overflow-hidden rounded-lg border border-slate-200 bg-white text-left shadow-2xl">
            <div className="border-b border-slate-100 px-4 py-3">
              <div className="truncate text-base font-black text-slate-950">{menuItem.name}</div>
              <div className="mt-0.5 text-sm font-bold text-slate-500">x {menuItem.quantity} / {money(itemNetTotal(menuItem))}</div>
            </div>
            <div className="py-1">
              {allowPriceEdit && (
                <button className="flex w-full items-center gap-3 px-4 py-3 text-left font-bold text-slate-700 hover:bg-slate-50" onClick={() => { setPriceNoteItem({ item: menuItem, mode: 'price' }); setMenuItem(null); }}>
                  <Edit3 size={19} /> แก้ไขราคาขาย
                </button>
              )}
              <button className="flex w-full items-center gap-3 px-4 py-3 text-left font-bold text-slate-700 hover:bg-slate-50" onClick={() => { setPriceNoteItem({ item: menuItem, mode: 'note' }); setMenuItem(null); }}>
                <FileText size={19} /> หมายเหตุรายการขาย
              </button>
              <div className="my-1 border-t border-slate-100" />
              <button className="flex w-full items-center gap-3 px-4 py-3 text-left font-bold text-slate-700 hover:bg-slate-50" onClick={() => { setDiscountItem({ item: menuItem, mode: 'amount' }); setMenuItem(null); }}>
                <BadgeDollarSign size={19} /> ลดบาท
              </button>
              <button className="flex w-full items-center gap-3 px-4 py-3 text-left font-bold text-slate-700 hover:bg-slate-50" onClick={() => { setDiscountItem({ item: menuItem, mode: 'percent' }); setMenuItem(null); }}>
                <Percent size={19} /> ลด %
              </button>
              <button className="flex w-full items-center gap-3 px-4 py-3 text-left font-bold text-slate-700 hover:bg-slate-50" onClick={() => { updateItem(menuItem.cartItemId, { discountAmount: 0, discountPercent: 0 }); setMenuItem(null); }}>
                <Percent size={19} /> ยกเลิกส่วนลด
              </button>
            </div>
            <div className="border-t border-slate-100 p-3">
              <button className="w-full rounded-md bg-slate-100 py-3 font-black text-slate-700 hover:bg-slate-200" onClick={() => setMenuItem(null)}>
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
