import { useMemo, useState } from 'react';
import { Delete } from 'lucide-react';
import { Modal } from '../common/Modal';
import type { PaymentMethod, SaleDetail, User } from '../../types';
import { money } from '../../utils/money';
import { useCartStore } from '../../stores/cartStore';
import { SaleRepository } from '../../db/repositories/SaleRepository';
import { PrinterRepository } from '../../db/repositories/PrinterRepository';
import { SettingsRepository } from '../../db/repositories/SettingsRepository';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../common/Toast';
import { PAYMENT_METHODS_SETTING_KEY, parseEnabledPaymentMethods } from '../../pages/PaymentSettingsPage';

const ALL_METHODS: Array<{ id: PaymentMethod; label: string }> = [
  { id: 'cash', label: 'เงินสด' },
  { id: 'transfer', label: 'โอนเงิน' },
  { id: 'qr', label: 'QR' },
  { id: 'credit', label: 'บัตรเครดิต' },
  { id: 'mixed', label: 'หลายช่องทาง' },
];

type MixedPaymentMethod = Exclude<PaymentMethod, 'mixed'>;
type ActiveAmountField = 'cash' | MixedPaymentMethod;
type KeypadInputMode = 'manual' | 'quick' | 'full' | null;

const emptyMixedAmounts: Record<MixedPaymentMethod, string> = { cash: '', transfer: '', qr: '', credit: '' };

function amountNumber(value: string) {
  return Number(value || 0);
}

function appendAmount(current: string, key: string) {
  if (key === '.') return current.includes('.') ? current : `${current || '0'}.`;
  if (current === '0') return key;
  return `${current}${key}`;
}

function AmountKeypad({ onKey, onFull, compact = false }: { onKey: (key: string) => void; onFull: () => void; compact?: boolean }) {
  const keys = [
    ['7', '8', '9', '1000'],
    ['4', '5', '6', '500'],
    ['1', '2', '3', '100'],
    ['.', '0', 'back', 'full'],
  ];

  return (
    <div className="grid grid-cols-4 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      {keys.flat().map((key) => {
        const isShortcut = ['1000', '500', '100', 'full'].includes(key);
        return (
          <button
            key={key}
            type="button"
            className={`border-b border-r border-slate-200 font-bold last:border-r-0 ${compact ? 'min-h-[46px] text-xl' : 'min-h-[58px] text-2xl sm:min-h-16 sm:text-3xl'} ${isShortcut ? 'text-primary-700' : 'text-slate-800'}`}
            onClick={() => {
              if (key === 'full') onFull();
              else onKey(key);
            }}
          >
            {key === 'back' ? <Delete className="mx-auto" size={18} /> : key === 'full' ? 'เต็ม' : key}
          </button>
        );
      })}
    </div>
  );
}

export function PaymentModal({ user, onClose, onSuccess }: { user: User; onClose: () => void; onSuccess: (detail: SaleDetail) => void }) {
  const cart = useCartStore();
  const totals = cart.summary();
  const toast = useToast();
  const { data: enabledSetting } = useAsync(() => SettingsRepository.getSetting(PAYMENT_METHODS_SETTING_KEY), []);
  const enabledIds = useMemo(() => parseEnabledPaymentMethods(enabledSetting), [enabledSetting]);
  const methods = useMemo(() => ALL_METHODS.filter((m) => enabledIds.includes(m.id as never)), [enabledIds]);
  const mixedMethods = useMemo(() => methods.filter((item): item is { id: MixedPaymentMethod; label: string } => item.id !== 'mixed'), [methods]);
  const mixedLabels = useMemo(() => Object.fromEntries(mixedMethods.map((item) => [item.id, item.label])) as Record<MixedPaymentMethod, string>, [mixedMethods]);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [received, setReceived] = useState('');
  const [mixedSelected, setMixedSelected] = useState<MixedPaymentMethod[]>(['cash', 'transfer']);
  const [mixedAmounts, setMixedAmounts] = useState<Record<MixedPaymentMethod, string>>(emptyMixedAmounts);
  const [activeAmountField, setActiveAmountField] = useState<ActiveAmountField>('cash');
  const [keypadInputMode, setKeypadInputMode] = useState<KeypadInputMode>(null);

  const mixedPaid = useMemo(() => mixedSelected.reduce((sum, item) => sum + amountNumber(mixedAmounts[item]), 0), [mixedAmounts, mixedSelected]);
  const paid = useMemo(() => {
    if (method === 'mixed') return mixedPaid;
    if (method === 'cash') return amountNumber(received);
    return totals.grandTotal;
  }, [method, mixedPaid, received, totals.grandTotal]);
  const change = Math.max(0, paid - totals.grandTotal);
  const shortage = Math.max(0, totals.grandTotal - paid);

  const selectMethod = (nextMethod: PaymentMethod) => {
    setMethod(nextMethod);
    setKeypadInputMode(null);
    if (nextMethod === 'cash') setActiveAmountField('cash');
    if (nextMethod === 'mixed') setActiveAmountField(mixedSelected[0] ?? 'cash');
  };

  const toggleMixedMethod = (nextMethod: MixedPaymentMethod) => {
    setMixedSelected((current) => {
      if (current.includes(nextMethod)) {
        setMixedAmounts((amounts) => ({ ...amounts, [nextMethod]: '' }));
        const next = current.filter((item) => item !== nextMethod);
        if (activeAmountField === nextMethod) setActiveAmountField(next[0] ?? 'cash');
        setKeypadInputMode(null);
        return next;
      }
      if (current.length >= 2) {
        toast('เลือกช่องทางชำระเงินได้สูงสุด 2 ช่องทาง', 'error');
        return current;
      }
      setActiveAmountField(nextMethod);
      setKeypadInputMode(null);
      return [...current, nextMethod];
    });
  };

  const setActiveAmount = (value: string) => {
    if (method === 'cash' || activeAmountField === 'cash') {
      setReceived(value);
      if (method !== 'mixed') return;
    }
    if (method === 'mixed' && activeAmountField !== 'cash') {
      setMixedAmounts((current) => ({ ...current, [activeAmountField]: value }));
    } else if (method === 'mixed' && activeAmountField === 'cash') {
      setMixedAmounts((current) => ({ ...current, cash: value }));
    }
  };

  const getActiveAmount = () => {
    if (method === 'cash') return received;
    if (method === 'mixed') return mixedAmounts[activeAmountField as MixedPaymentMethod] ?? '';
    return '';
  };

  const handleKeypad = (key: string) => {
    const current = getActiveAmount();
    if (key === 'back') {
      setActiveAmount(current.slice(0, -1));
      setKeypadInputMode('manual');
      return;
    }
    if (['100', '500', '1000'].includes(key)) {
      const nextValue = keypadInputMode === 'quick'
        ? String(amountNumber(current) + Number(key))
        : key;
      setActiveAmount(nextValue);
      setKeypadInputMode('quick');
      return;
    }
    setActiveAmount(appendAmount(current, key));
    setKeypadInputMode('manual');
  };

  const fillActiveFullAmount = () => {
    if (method === 'mixed') {
      const otherTotal = mixedSelected
        .filter((selected) => selected !== activeAmountField)
        .reduce((sum, selected) => sum + amountNumber(mixedAmounts[selected]), 0);
      setActiveAmount(String(Math.max(0, totals.grandTotal - otherTotal)));
      setKeypadInputMode('full');
      return;
    }
    setReceived(String(totals.grandTotal));
    setKeypadInputMode('full');
  };

  const clearMixed = () => {
    setMixedAmounts(emptyMixedAmounts);
    setReceived('');
    setKeypadInputMode(null);
  };

  const buildMixedPayments = () => {
    const rows = mixedSelected.map((item) => ({
      method: item,
      amount: amountNumber(mixedAmounts[item]),
      receivedAmount: amountNumber(mixedAmounts[item]),
      changeAmount: 0,
    }));
    let overpay = change;
    const changeTarget = rows.find((row) => row.method === 'cash') ?? rows[rows.length - 1];
    if (changeTarget) changeTarget.changeAmount = overpay;
    const reductionOrder = [
      ...(changeTarget ? [changeTarget] : []),
      ...rows.filter((row) => row !== changeTarget).reverse(),
    ];
    for (const row of reductionOrder) {
      if (overpay <= 0) break;
      const reduce = Math.min(row.amount, overpay);
      row.amount -= reduce;
      overpay -= reduce;
    }
    return rows.filter((payment) => payment.receivedAmount > 0);
  };

  const confirm = async () => {
    if (!cart.items.length) return toast('ไม่มีสินค้าในตะกร้า', 'error');
    if (method === 'cash' && amountNumber(received) < totals.grandTotal) return toast('เงินสดที่รับมาต้องไม่น้อยกว่ายอดสุทธิ', 'error');
    if (method === 'mixed' && mixedSelected.length !== 2) return toast('การชำระหลายช่องทางต้องเลือก 2 ช่องทาง', 'error');
    if (method === 'mixed' && mixedSelected.some((item) => amountNumber(mixedAmounts[item]) <= 0)) return toast('กรุณาใส่ยอดเงินทั้ง 2 ช่องทาง', 'error');
    if (method === 'mixed' && paid < totals.grandTotal) return toast('ยอดชำระรวมยังไม่ครบ', 'error');

    const payments = method === 'mixed'
      ? buildMixedPayments()
      : [{ method, amount: totals.grandTotal, receivedAmount: method === 'cash' ? amountNumber(received) : totals.grandTotal, changeAmount: change }];

    try {
      const detail = await SaleRepository.createSale({ cashier: user, cart: cart.items, billDiscountAmount: cart.billDiscountAmount, billDiscountPercent: cart.billDiscountPercent, payments });
      const printerSettings = await PrinterRepository.getSettings();
      const hasCashPayment = payments.some((payment) => payment.method === 'cash' && payment.receivedAmount > 0);
      if (printerSettings.openDrawerAfterCashPayment && hasCashPayment) {
        const log = await PrinterRepository.openDrawer({
          user,
          action: 'cash_in',
          amount: payments.filter((payment) => payment.method === 'cash').reduce((sum, payment) => sum + payment.receivedAmount - payment.changeAmount, 0),
          note: `Cash payment ${detail.sale.billNo}`,
        });
        if (log.status === 'failed') toast(log.error ?? 'เปิดลิ้นชักไม่สำเร็จ', 'error');
      }
      cart.clear();
      onSuccess(detail);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'บันทึกการขายไม่สำเร็จ', 'error');
    }
  };

  const mixedStatusClass = shortage > 0 ? 'text-amber-700' : change > 0 ? 'text-emerald-700' : 'text-slate-900';
  const mixedStatusText = shortage > 0 ? 'ยอดที่ยังขาด' : change > 0 ? 'เงินทอน' : 'ยอดครบพอดี';
  const mixedStatusAmount = shortage > 0 ? shortage : change;

  const activeMethodLabel = method === 'mixed'
    ? mixedLabels[activeAmountField as MixedPaymentMethod] ?? 'ยอดที่กำลังกรอก'
    : method === 'cash'
      ? 'จำนวนเงินสดที่รับ'
      : methods.find((item) => item.id === method)?.label ?? 'ยอดรับชำระ';
  const activeAmountValue = method === 'cash'
    ? received
    : method === 'mixed'
      ? mixedAmounts[activeAmountField as MixedPaymentMethod] || ''
      : String(totals.grandTotal);

  return (
    <Modal title="รับชำระเงิน" onClose={onClose} wide panelClassName="max-w-[780px]" bodyClassName="p-3 sm:p-4">

      {/* ── MOBILE LAYOUT (hidden on md+) ── */}
      <div className="flex flex-col gap-2 md:hidden">

        {/* Total */}
        <div className="rounded-lg bg-primary-50 px-4 py-2.5 text-center">
          <div className="text-xs font-bold text-primary-700">ยอดต้องชำระ</div>
          <div className="text-3xl font-black leading-tight text-primary-900">{money(totals.grandTotal)}</div>
        </div>

        {/* Payment method buttons */}
        <div className="grid grid-cols-2 gap-2.5">
          {methods.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => selectMethod(item.id)}
              className={`min-h-[72px] rounded-xl text-lg font-black ${item.id === 'mixed' ? 'col-span-2' : ''} ${method === item.id ? 'bg-primary-600 text-white shadow-sm' : 'bg-slate-100 text-slate-700'}`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Cash summary */}
        {method === 'cash' && (
          <div className="flex gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
            <div className="flex-1 text-slate-500">รับแล้ว <b className="text-slate-900">{money(paid)}</b></div>
            <div className={`flex-1 text-right font-black ${shortage > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
              {shortage > 0 ? 'ขาด' : 'ทอน'} {money(shortage > 0 ? shortage : change)}
            </div>
          </div>
        )}

        {/* Non-cash/non-mixed info */}
        {method !== 'cash' && method !== 'mixed' && (
          <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm">
            <span className="font-bold text-slate-500">บันทึกเต็มจำนวนอัตโนมัติ</span>
            <span className="text-xl font-black text-slate-950">{money(totals.grandTotal)}</span>
          </div>
        )}

        {/* Mixed panel */}
        {method === 'mixed' && (
          <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-2.5">
            <div className="flex flex-wrap gap-1.5">
              {mixedMethods.map((item) => {
                const selected = mixedSelected.includes(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => toggleMixedMethod(item.id)}
                    className={`rounded-md border px-3 py-1.5 text-xs font-black ${selected ? 'border-primary-600 bg-primary-50 text-primary-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {mixedSelected.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setActiveAmountField(item)}
                  className={`rounded-md border bg-white p-2 text-left ${activeAmountField === item ? 'border-primary-600 ring-2 ring-primary-100' : 'border-slate-200'}`}
                >
                  <div className="text-xs font-black text-slate-600">{mixedLabels[item]}</div>
                  <div className="text-right text-base font-black text-slate-950">{mixedAmounts[item] || '0'}</div>
                </button>
              ))}
            </div>
            <div className={`flex justify-between text-sm font-black ${mixedStatusClass}`}>
              <span>{mixedStatusText}</span>
              <span>{money(mixedStatusAmount)}</span>
            </div>
            <button type="button" className="text-xs font-bold text-slate-500 underline" onClick={clearMixed}>ล้างยอด</button>
          </div>
        )}

        {/* Keypad (cash + mixed only) */}
        {(method === 'cash' || method === 'mixed') && (
          <>
            <label className="block text-sm font-bold text-slate-700">
              {activeMethodLabel}
              <input
                inputMode="none"
                readOnly
                className="mt-1 w-full rounded-md border-slate-300 bg-white py-1.5 text-right text-3xl font-black leading-none"
                placeholder="0"
                value={activeAmountValue}
              />
            </label>
            <AmountKeypad onKey={handleKeypad} onFull={fillActiveFullAmount} compact />
          </>
        )}

        {/* Mobile confirm button */}
        <button onClick={confirm} className="w-full rounded-md bg-emerald-600 py-3.5 text-xl font-black text-white hover:bg-emerald-700">
          ยืนยันรับเงิน
        </button>
      </div>

      {/* ── DESKTOP LAYOUT (hidden on mobile) ── */}
      <div className="hidden md:block">
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-[245px_minmax(0,1fr)]">
            <aside className="space-y-2">
              <div className="rounded-lg bg-primary-50 p-2 text-center">
                <div className="text-sm font-bold text-primary-700">ยอดต้องชำระ</div>
                <div className="text-3xl font-black leading-tight text-primary-900">{money(totals.grandTotal)}</div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {methods.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => selectMethod(item.id)}
                    className={`min-h-[60px] rounded-xl text-base font-black ${item.id === 'mixed' ? 'col-span-2' : ''} ${method === item.id ? 'bg-primary-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {method === 'cash' && (
                <div className="space-y-1 rounded-lg border border-slate-200 bg-white p-2.5">
                  <div className="flex justify-between text-sm font-bold text-slate-500">
                    <span>รับแล้ว</span>
                    <span>{money(paid)}</span>
                  </div>
                  <div className={`flex justify-between text-base font-black ${shortage > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                    <span>{shortage > 0 ? 'ยอดที่ยังขาด' : 'เงินทอน'}</span>
                    <span>{money(shortage > 0 ? shortage : change)}</span>
                  </div>
                </div>
              )}

              {method !== 'cash' && method !== 'mixed' && (
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="text-sm font-bold text-slate-500">ยอดรับชำระ</div>
                  <div className="mt-1 text-2xl font-black text-slate-950">{money(totals.grandTotal)}</div>
                  <div className="mt-1 text-xs font-bold text-slate-500">บันทึกเต็มจำนวนอัตโนมัติ</div>
                </div>
              )}

              {method === 'mixed' && (
                <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-2.5">
                  <div className="grid grid-cols-2 gap-2">
                    {mixedMethods.map((item) => {
                      const selected = mixedSelected.includes(item.id);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => toggleMixedMethod(item.id)}
                          className={`rounded-md border px-2 py-1.5 text-xs font-black ${selected ? 'border-primary-600 bg-primary-50 text-primary-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}
                        >
                          {item.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {mixedSelected.map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setActiveAmountField(item)}
                        className={`rounded-md border bg-white p-2 text-left ${activeAmountField === item ? 'border-primary-600 ring-2 ring-primary-100' : 'border-slate-200'}`}
                      >
                        <div className="text-xs font-black text-slate-600">{mixedLabels[item]}</div>
                        <div className="text-right text-lg font-black text-slate-950">{mixedAmounts[item] || '0'}</div>
                      </button>
                    ))}
                  </div>
                  <div className="flex justify-between text-sm font-bold text-slate-500">
                    <span>รวมรับชำระ</span>
                    <span className="text-slate-900">{money(mixedPaid)}</span>
                  </div>
                  <div className={`flex justify-between text-sm font-black ${mixedStatusClass}`}>
                    <span>{mixedStatusText}</span>
                    <span>{money(mixedStatusAmount)}</span>
                  </div>
                  <button type="button" className="text-xs font-bold text-slate-500 underline" onClick={clearMixed}>ล้างยอดหลายช่องทาง</button>
                </div>
              )}
            </aside>

            <section className="space-y-3">
              {method === 'cash' || method === 'mixed' ? (
                <>
                  <label className="block text-sm font-bold text-slate-700">
                    {activeMethodLabel}
                    <input
                      inputMode="none"
                      readOnly
                      className="mt-1 w-full rounded-md border-slate-300 bg-white py-2 text-right text-4xl font-black leading-none"
                      placeholder="0"
                      value={activeAmountValue}
                    />
                  </label>
                  <AmountKeypad onKey={handleKeypad} onFull={fillActiveFullAmount} />
                  {method === 'mixed' && (
                    <button onClick={confirm} className="w-full rounded-md bg-emerald-600 py-3.5 text-xl font-black text-white hover:bg-emerald-700">ยืนยันรับเงิน</button>
                  )}
                </>
              ) : (
                <div className="grid min-h-[360px] place-items-center rounded-lg border border-slate-200 bg-slate-50 p-6 text-center">
                  <div>
                    <div className="text-sm font-bold text-slate-500">ช่องทางที่เลือก</div>
                    <div className="mt-2 text-3xl font-black text-slate-900">{activeMethodLabel}</div>
                    <div className="mt-4 rounded-lg bg-white px-8 py-5 text-4xl font-black text-primary-800 shadow-sm">
                      {money(totals.grandTotal)}
                    </div>
                    <div className="mt-3 text-sm font-bold text-slate-500">ระบบจะบันทึกยอดเต็มจำนวนให้ทันที</div>
                  </div>
                </div>
              )}
            </section>
          </div>

          {method !== 'mixed' && (
            <button onClick={confirm} className="w-full rounded-md bg-emerald-600 py-3.5 text-xl font-black text-white hover:bg-emerald-700">ยืนยันรับเงิน</button>
          )}
        </div>
      </div>

    </Modal>
  );
}
