import { useEffect, useMemo, useState } from 'react';
import type { Product, SaleDetail, SaleStatus } from '../types';
import type { CashDrawerAction } from '../types';
import { CategoryRepository } from '../db/repositories/CategoryRepository';
import { ProductRepository } from '../db/repositories/ProductRepository';
import { SettingsRepository } from '../db/repositories/SettingsRepository';
import { SaleRepository } from '../db/repositories/SaleRepository';
import { ReportRepository } from '../db/repositories/ReportRepository';
import { ParkedBillRepository } from '../db/repositories/ParkedBillRepository';
import { PrinterRepository } from '../db/repositories/PrinterRepository';
import { useAsync } from '../hooks/useAsync';
import { useCartStore } from '../stores/cartStore';
import { ProductButton, posProductGridClasses } from '../components/pos/ProductButton';
import { CartPanel } from '../components/pos/CartPanel';
import { OpenPriceModal } from '../components/pos/OpenPriceModal';
import { PaymentModal } from '../components/pos/PaymentModal';
import { ReceiptModal } from '../components/pos/ReceiptModal';
import { Modal } from '../components/common/Modal';
import { useAuthStore } from '../stores/authStore';
import { useToast } from '../components/common/Toast';
import { formatDateInput, formatDateTime } from '../utils/date';
import { money } from '../utils/money';
import { CalendarDays, History, LayoutGrid, PanelLeftClose, PanelLeftOpen, Printer, Search, ShoppingCart, ReceiptText, Trash2, WalletCards } from 'lucide-react';
import { isMirrorModeActive } from '../stores/mirrorStore';
import { PrinterOutputService } from '../services/printerOutputService';
import { formatSalesSummaryText } from '../services/receiptTextFormatter';
import {
  getReceiptContentSettings,
  getReceiptPreviewShellStyle,
  getReceiptPreviewStyle,
  getReceiptRenderConfig,
  type ReceiptRenderConfig,
} from '../services/receiptLayoutService';

const METHOD_LABEL: Record<string, string> = {
  cash: 'เงินสด',
  transfer: 'โอนเงิน',
  qr: 'QR Code',
  credit: 'บัตรเครดิต',
  mixed: 'หลายช่องทาง',
};

const billStatusTabs: Array<{ value: '' | SaleStatus; label: string }> = [
  { value: 'completed', label: 'สำเร็จ' },
  { value: 'voided', label: 'Void' },
  { value: 'refunded', label: 'Refund' },
  { value: 'partially_refunded', label: 'คืนบางส่วน' },
  { value: '', label: 'ทั้งหมด' },
];

function toFontPx(value: string | null | undefined) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : undefined;
}

export function PosPage() {
  const { data: categories, reload: reloadCategories } = useAsync(() => CategoryRepository.getCategories(), []);
  const { data: products, reload: reloadProducts } = useAsync(() => ProductRepository.getProducts(), []);
  const { data: productButtonSize } = useAsync(() => SettingsRepository.getSetting('productButtonSize', 'medium'), []);
  const { data: displayFontSize } = useAsync(() => SettingsRepository.getSetting('productButtonDisplayFontSize', 'medium'), []);
  const { data: nameFontSize } = useAsync(() => SettingsRepository.getSetting('productButtonNameFontSize', 'medium'), []);
  const { data: priceFontSize } = useAsync(() => SettingsRepository.getSetting('productButtonPriceFontSize', 'medium'), []);
  const { data: displayFontPx } = useAsync(() => SettingsRepository.getSetting('productButtonDisplayFontPx', '30'), []);
  const { data: nameFontPx } = useAsync(() => SettingsRepository.getSetting('productButtonNameFontPx', '14'), []);
  const { data: priceFontPx } = useAsync(() => SettingsRepository.getSetting('productButtonPriceFontPx', '14'), []);
  const [categoryId, setCategoryId] = useState<string>('all');
  const [categoryPanelOpen, setCategoryPanelOpen] = useState(false);
  const [categorySidebarCollapsed, setCategorySidebarCollapsed] = useState(false);
  const [query, setQuery] = useState('');
  const [mobileTab, setMobileTab] = useState<'products' | 'cart'>('products');
  const [openPrice, setOpenPrice] = useState<Product | null>(null);
  const [payment, setPayment] = useState(false);
  const [receipt, setReceipt] = useState<SaleDetail | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyDate, setHistoryDate] = useState(formatDateInput());
  const [historyStatus, setHistoryStatus] = useState<'' | SaleStatus>('completed');
  const [historySelected, setHistorySelected] = useState<SaleDetail | null>(null);
  const [historyPrinting, setHistoryPrinting] = useState(false);
  const [parkedOpen, setParkedOpen] = useState(false);
  const [parkNameOpen, setParkNameOpen] = useState(false);
  const [parkName, setParkName] = useState('');
  const [renamingParkedId, setRenamingParkedId] = useState<string | null>(null);
  const [renamingParkedName, setRenamingParkedName] = useState('');
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryDate, setSummaryDate] = useState(formatDateInput());
  const [summaryPrinting, setSummaryPrinting] = useState(false);
  const [summaryPreviewOpen, setSummaryPreviewOpen] = useState(false);
  const [summaryPrintText, setSummaryPrintText] = useState('');
  const [summaryRenderConfig, setSummaryRenderConfig] = useState<ReceiptRenderConfig | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerAction, setDrawerAction] = useState<CashDrawerAction>('cash_in');
  const [drawerAmount, setDrawerAmount] = useState('');
  const [drawerNote, setDrawerNote] = useState('');
  const cart = useCartStore();
  const user = useAuthStore((state) => state.user)!;
  const toast = useToast();

  // รับข้อมูลสินค้า/หมวดหมู่ใหม่จาก device อื่นทันทีเมื่อ sync ดึงมา
  useEffect(() => {
    const onCatalogUpdated = () => { reloadCategories(); reloadProducts(); };
    window.addEventListener('calpos:catalog-updated', onCatalogUpdated);
    return () => window.removeEventListener('calpos:catalog-updated', onCatalogUpdated);
  }, [reloadCategories, reloadProducts]);
  const { data: historyBills, reload: reloadHistory } = useAsync(
    () => SaleRepository.searchSales({ query: historyQuery, date: historyDate, status: historyStatus }),
    [historyQuery, historyDate, historyStatus],
  );
  const { data: parkedBills, reload: reloadParkedBills } = useAsync(
    () => ParkedBillRepository.getParkedBills(user.id),
    [user.id],
  );
  const { data: paymentSummary, reload: reloadPaymentSummary } = useAsync(
    () => ReportRepository.getPaymentSummary(summaryDate),
    [summaryDate],
  );
  const { data: dailySummary, reload: reloadDailySummary } = useAsync(
    () => ReportRepository.getDailySummary(summaryDate),
    [summaryDate],
  );

  const filteredProducts = useMemo(() => (products ?? []).filter((product) => {
    const matchCategory = categoryId === 'all' || product.categoryId === categoryId;
    const matchQuery = !query || product.name.toLowerCase().includes(query.toLowerCase()) || product.displayName.includes(query);
    return matchCategory && matchQuery;
  }), [products, categoryId, query]);

  const quantities = useMemo(() => {
    const map = new Map<string, number>();
    cart.items.forEach((item) => map.set(item.productId, (map.get(item.productId) ?? 0) + item.quantity));
    return map;
  }, [cart.items]);

  const normalizedProductSize = productButtonSize === 'small' || productButtonSize === 'large' ? productButtonSize : 'medium';
  const gridClass = posProductGridClasses[normalizedProductSize];

  const toggleCategoryPanel = () => {
    if (window.matchMedia('(min-width: 1280px)').matches) {
      setCategorySidebarCollapsed((current) => !current);
      return;
    }
    setCategoryPanelOpen((current) => !current);
  };

  const clickProduct = (product: Product) => {
    if (product.isOpenPrice) setOpenPrice(product);
    else cart.addProduct(product);
    if (window.innerWidth < 768) setMobileTab('products');
  };

  const historySummary = useMemo(() => {
    const rows = historyBills ?? [];
    return {
      bills: rows.length,
      total: rows.reduce((sum, detail) => sum + detail.sale.total, 0),
      items: rows.reduce((sum, detail) => sum + detail.items.reduce((itemSum, item) => itemSum + item.quantity, 0), 0),
    };
  }, [historyBills]);

  const paymentLabel = (detail: SaleDetail) => {
    const labels: Record<string, string> = { cash: 'เงินสด', transfer: 'โอนเงิน', qr: 'QR', credit: 'บัตรเครดิต', mixed: 'หลายช่องทาง' };
    const methods = Array.from(new Set(detail.payments.map((paymentItem) => paymentItem.method)));
    return methods.length > 1 ? 'หลายช่องทาง' : (labels[methods[0] ?? ''] ?? '-');
  };

  const paymentReceived = (detail: SaleDetail) => detail.payments.reduce((sum, payment) => sum + payment.receivedAmount, 0);
  const paymentChange = (detail: SaleDetail) => detail.payments.reduce((sum, payment) => sum + payment.changeAmount, 0);

  const statusLabel = (status: SaleStatus) => {
    const labels: Record<SaleStatus, string> = { completed: 'สำเร็จ', voided: 'Void', refunded: 'Refund', partially_refunded: 'คืนบางส่วน' };
    return labels[status];
  };

  const openPayment = () => {
    if (!cart.items.length) {
      toast('กรุณาเลือกสินค้าก่อนชำระเงิน', 'error');
      return;
    }
    setPayment(true);
  };

  const parkCurrentCart = async () => {
    if (!cart.items.length) {
      setParkedOpen(true);
      reloadParkedBills();
      return;
    }
    setParkName('');
    setParkNameOpen(true);
  };

  const saveParkedBill = async () => {
    const totals = cart.summary();
    if (!cart.items.length) {
      setParkNameOpen(false);
      return;
    }
    const defaultName = `พักบิล ${new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}`;
    await ParkedBillRepository.createParkedBill({
      name: parkName.trim() || defaultName,
      cashierId: user.id,
      cart: {
        items: cart.items,
        billDiscountAmount: cart.billDiscountAmount,
        billDiscountPercent: cart.billDiscountPercent,
      },
    });
    cart.clear();
    setParkName('');
    setParkNameOpen(false);
    toast(`พักบิลแล้ว ${totals.itemCount} ชิ้น ยอด ${money(totals.grandTotal)}`, 'success');
    setParkedOpen(true);
    reloadParkedBills();
  };

  const startRenameParkedBill = (billId: string, name: string) => {
    setRenamingParkedId(billId);
    setRenamingParkedName(name);
  };

  const saveRenameParkedBill = async () => {
    if (!renamingParkedId) return;
    const nextName = renamingParkedName.trim() || `พักบิล ${new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}`;
    await ParkedBillRepository.updateName(renamingParkedId, nextName);
    setRenamingParkedId(null);
    setRenamingParkedName('');
    toast('บันทึกชื่อบิลพักแล้ว', 'success');
    reloadParkedBills();
  };

  const restoreParkedBill = async (billId: string) => {
    const bill = parkedBills?.find((item) => item.id === billId);
    if (!bill) return;
    if (cart.items.length && !window.confirm('ตะกร้าปัจจุบันมีสินค้าอยู่ ต้องการแทนที่ด้วยบิลพักนี้หรือไม่?')) return;
    cart.restoreCart(ParkedBillRepository.parseCart(bill));
    await ParkedBillRepository.deleteParkedBill(bill.id);
    toast('เรียกบิลพักกลับเข้าตะกร้าแล้ว', 'success');
    setParkedOpen(false);
    reloadParkedBills();
  };

  const deleteParkedBill = async (billId: string) => {
    await ParkedBillRepository.deleteParkedBill(billId);
    toast('ลบบิลพักแล้ว', 'success');
    reloadParkedBills();
  };

  const openSummary = () => {
    setSummaryOpen(true);
    reloadPaymentSummary();
    reloadDailySummary();
  };

  const buildSummaryPrintPreview = async () => {
    const [printerSettings, contentSettings] = await Promise.all([
      PrinterRepository.getSettings(),
      getReceiptContentSettings(),
    ]);
    const renderConfig = getReceiptRenderConfig(printerSettings);
    const text = formatSalesSummaryText({
      date: summaryDate,
      payments: paymentSummary ?? { cash: 0, transfer: 0, qr: 0, credit: 0 },
      summary: dailySummary ?? { totalSales: 0, billCount: 0, totalDiscount: 0 },
      charsPerLineValue: renderConfig.charsPerLine,
      contentSettings,
    });

    setSummaryRenderConfig(renderConfig);
    setSummaryPrintText(text);
    setSummaryPreviewOpen(true);
  };

  const printSummary = async () => {
    if (summaryPrinting) return;
    setSummaryPrinting(true);
    try {
      const text = summaryPrintText;
      if (!text) return;

      try {
        const result = await PrinterOutputService.printText(text);
        if (result === 'native') {
          toast('ส่งพิมพ์ใบสรุปยอดแล้ว', 'success');
          return;
        }
      } catch (error) {
        toast(error instanceof Error ? error.message : 'พิมพ์ใบสรุปยอดไม่สำเร็จ', 'error');
        return;
      }

      document.body.dataset.printMode = 'receipt';
      const cleanup = () => {
        delete document.body.dataset.printMode;
        window.removeEventListener('afterprint', cleanup);
      };
      window.addEventListener('afterprint', cleanup);
      window.setTimeout(() => {
        window.print();
        window.setTimeout(cleanup, 800);
      }, 50);
    } finally {
      window.setTimeout(() => setSummaryPrinting(false), 1200);
    }
  };

  const printHistoryBill = async () => {
    if (!historySelected || historyPrinting) return;
    setHistoryPrinting(true);
    try {
      try {
        const result = await PrinterOutputService.printReceipt(historySelected);
        if (result === 'native') { toast('ส่งพิมพ์ใบเสร็จแล้ว', 'success'); return; }
      } catch (error) {
        toast(error instanceof Error ? error.message : 'พิมพ์ใบเสร็จไม่สำเร็จ', 'error');
        return;
      }
      document.body.dataset.printMode = 'receipt';
      const cleanup = () => { delete document.body.dataset.printMode; window.removeEventListener('afterprint', cleanup); };
      window.addEventListener('afterprint', cleanup);
      window.setTimeout(() => { window.print(); window.setTimeout(cleanup, 800); }, 50);
    } finally {
      window.setTimeout(() => setHistoryPrinting(false), 1200);
    }
  };

  const openCashDrawer = async () => {
    const log = await PrinterRepository.openDrawer({
      user,
      action: drawerAction,
      amount: Math.max(0, Number(drawerAmount || 0)),
      note: drawerNote.trim(),
    });
    if (log.status === 'success') toast('บันทึกการเปิดลิ้นชักแล้ว', 'success');
    else toast(log.error ?? 'เปิดลิ้นชักไม่สำเร็จ', 'error');
    setDrawerOpen(false);
    setDrawerAmount('');
    setDrawerNote('');
    setDrawerAction('cash_in');
  };

  return (
    <div className="h-[calc(100dvh-7.5rem)] p-2 md:p-3 lg:h-[calc(100dvh-4rem)] lg:p-4">
      <div className="mb-2 grid grid-cols-2 rounded-md bg-white p-1 md:hidden">
        <button className={`rounded-md py-2 font-black ${mobileTab === 'products' ? 'bg-primary-600 text-white' : 'text-slate-500'}`} onClick={() => setMobileTab('products')}>สินค้า</button>
        <button className={`rounded-md py-2 font-black ${mobileTab === 'cart' ? 'bg-primary-600 text-white' : 'text-slate-500'}`} onClick={() => setMobileTab('cart')}>ตะกร้า ({cart.summary().itemCount})</button>
      </div>
      <div className={`grid h-full gap-2 md:grid-cols-[minmax(0,1fr)_340px] lg:gap-3 lg:grid-cols-[minmax(0,1fr)_380px] ${categorySidebarCollapsed ? 'xl:grid-cols-[minmax(0,1fr)_420px]' : 'xl:grid-cols-[220px_minmax(0,1fr)_420px]'}`}>
        <aside className={`${categorySidebarCollapsed ? 'xl:hidden' : 'xl:block'} hidden overflow-auto rounded-lg border border-slate-200 bg-white p-3 shadow-sm`}>
          <button onClick={() => setCategoryId('all')} className={`mb-2 w-full rounded-md px-3 py-3 text-left font-bold ${categoryId === 'all' ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-700'}`}>ทั้งหมด</button>
          {(categories ?? []).map((category) => (
            <button key={category.id} onClick={() => setCategoryId(category.id)} className={`mb-2 flex w-full items-center gap-2 rounded-md px-3 py-3 text-left font-bold ${categoryId === category.id ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-700'}`}>
              <span className="h-3 w-3 rounded-full" style={{ background: category.color }} /> {category.name}
            </button>
          ))}
        </aside>
        <section className={`${mobileTab !== 'products' ? 'hidden md:flex' : 'flex'} min-h-0 flex-col`}>
          <div className="mb-2 flex items-center gap-2 md:mb-3">
            <button
              type="button"
              onClick={toggleCategoryPanel}
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white shadow-sm ${categoryPanelOpen ? 'text-primary-700 ring-2 ring-primary-100' : 'text-slate-600'} ${categorySidebarCollapsed ? 'xl:text-slate-600 xl:ring-0' : 'xl:text-primary-700 xl:ring-2 xl:ring-primary-100'}`}
              aria-label="หมวดหมู่สินค้า"
              title={categorySidebarCollapsed ? 'แสดงหมวดหมู่' : 'พับหมวดหมู่'}
            >
              <LayoutGrid size={22} className="xl:hidden" />
              {categorySidebarCollapsed ? <PanelLeftOpen size={22} className="hidden xl:block" /> : <PanelLeftClose size={22} className="hidden xl:block" />}
            </button>
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 shadow-sm">
            <Search size={20} className="text-slate-400" />
            <input className="w-full border-0 bg-transparent py-2.5 focus:ring-0 md:py-3" placeholder="ค้นหาสินค้า ราคา หรือชื่อ" value={query} onChange={(event) => setQuery(event.target.value)} />
            </div>
          </div>
          {categoryPanelOpen && (
            <div className="mb-2 grid max-h-56 grid-cols-2 gap-2 overflow-auto rounded-lg border border-slate-200 bg-white p-2 shadow-sm sm:grid-cols-3 md:max-h-64 lg:grid-cols-4 xl:hidden">
              <button onClick={() => { setCategoryId('all'); setCategoryPanelOpen(false); }} className={`rounded-md px-3 py-3 text-left text-sm font-black ${categoryId === 'all' ? 'bg-primary-600 text-white' : 'bg-slate-50 text-slate-700'}`}>ทั้งหมด</button>
              {(categories ?? []).map((category) => (
                <button key={category.id} onClick={() => { setCategoryId(category.id); setCategoryPanelOpen(false); }} className={`flex items-center gap-2 rounded-md px-3 py-3 text-left text-sm font-black ${categoryId === category.id ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-700'}`}>
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: category.color }} /> <span className="truncate">{category.name}</span>
                </button>
              ))}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-auto rounded-lg">
            <div className={`grid gap-2 pb-8 sm:justify-start sm:gap-3 ${gridClass}`}>
              {filteredProducts.map((product) => (
                <ProductButton
                  key={product.id}
                  product={product}
                  quantity={quantities.get(product.id) ?? 0}
                  size={normalizedProductSize}
                  displayFontSize={(displayFontSize === 'small' || displayFontSize === 'large' ? displayFontSize : 'medium')}
                  nameFontSize={(nameFontSize === 'small' || nameFontSize === 'large' ? nameFontSize : 'medium')}
                  priceFontSize={(priceFontSize === 'small' || priceFontSize === 'large' ? priceFontSize : 'medium')}
                  displayFontPx={toFontPx(displayFontPx)}
                  nameFontPx={toFontPx(nameFontPx)}
                  priceFontPx={toFontPx(priceFontPx)}
                  compactOnMobile
                  onClick={() => clickProduct(product)}
                />
              ))}
            </div>
          </div>
          {!isMirrorModeActive() && (
            <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-white p-2 shadow-sm sm:grid-cols-[repeat(4,minmax(0,1fr))] md:mt-3">
              <button
                type="button"
                onClick={() => {
                  setHistoryOpen(true);
                  reloadHistory();
                }}
                className="flex items-center justify-center gap-2 rounded-md border border-primary-200 bg-primary-50 px-4 py-3 font-black text-primary-700 hover:bg-primary-100"
              >
                <History size={20} /> ประวัติบิล
              </button>
              <button
                type="button"
                onClick={parkCurrentCart}
                className="flex items-center justify-center gap-2 rounded-md border border-primary-200 bg-primary-50 px-4 py-3 font-black text-primary-700 hover:bg-primary-100"
              >
                <ShoppingCart size={20} /> พักบิล{(parkedBills?.length ?? 0) > 0 ? ` (${parkedBills?.length})` : ''}
              </button>
              <button
                type="button"
                onClick={openSummary}
                className="flex items-center justify-center gap-2 rounded-md border border-primary-200 bg-primary-50 px-4 py-3 font-black text-primary-700 hover:bg-primary-100"
              >
                <ReceiptText size={20} /> สรุป
              </button>
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                className="flex items-center justify-center gap-2 rounded-md border border-primary-200 bg-primary-50 px-4 py-3 font-black text-primary-700 hover:bg-primary-100"
              >
                <WalletCards size={20} /> เปิดลิ้นชัก
              </button>
            </div>
          )}
        </section>
        <div className={`${mobileTab !== 'cart' ? 'hidden md:block' : 'block'} min-h-0`}>
          <CartPanel onPay={openPayment} />
        </div>
      </div>
      {openPrice && <OpenPriceModal product={openPrice} onClose={() => setOpenPrice(null)} onConfirm={(price, note) => { cart.addProduct(openPrice, { price, note }); setOpenPrice(null); }} />}
      {payment && <PaymentModal user={user} onClose={() => setPayment(false)} onSuccess={(detail) => { setPayment(false); setReceipt(detail); reloadHistory(); }} />}
      {receipt && <ReceiptModal detail={receipt} onClose={() => setReceipt(null)} />}
      {drawerOpen && (
        <Modal title="เปิดลิ้นชักเก็บเงิน" onClose={() => setDrawerOpen(false)}>
          <div className="space-y-4">
            <label className="block text-sm font-bold text-slate-700">
              จำนวนเงิน
              <div className="mt-1 grid grid-cols-[140px_minmax(0,1fr)] rounded-md border border-slate-300 bg-white">
                <select className="border-0 border-r border-slate-300 bg-slate-50 font-black focus:ring-0" value={drawerAction} onChange={(event) => setDrawerAction(event.target.value as CashDrawerAction)}>
                  <option value="cash_in">นำเงินเข้า</option>
                  <option value="cash_out">นำเงินออก</option>
                  <option value="open_only">เปิดอย่างเดียว</option>
                </select>
                <input
                  type="number"
                  min={0}
                  className="border-0 text-right text-xl font-black focus:ring-0"
                  value={drawerAmount}
                  onChange={(event) => setDrawerAmount(event.target.value)}
                  placeholder="0"
                  disabled={drawerAction === 'open_only'}
                />
              </div>
            </label>
            <label className="block text-sm font-bold text-slate-700">
              หมายเหตุ
              <textarea className="mt-1 h-36 w-full resize-none rounded-md border-slate-300" value={drawerNote} onChange={(event) => setDrawerNote(event.target.value)} placeholder="เช่น แลกเงินทอน, เอาเงินเข้ากะ, ตรวจนับเงิน" />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button className="rounded-md bg-slate-100 py-3 font-bold text-slate-700" onClick={() => setDrawerOpen(false)}>ยกเลิก</button>
              <button className="rounded-md bg-emerald-600 py-3 font-black text-white" onClick={openCashDrawer}>เปิด</button>
            </div>
          </div>
        </Modal>
      )}
      {parkNameOpen && (
        <Modal title="พักบิล" onClose={() => setParkNameOpen(false)}>
          <div className="space-y-4">
            <div className="rounded-md bg-slate-50 p-3">
              <div className="text-sm font-bold text-slate-500">ตะกร้าปัจจุบัน</div>
              <div className="mt-1 flex justify-between text-lg font-black">
                <span>{cart.summary().itemCount.toLocaleString('th-TH')} ชิ้น</span>
                <span>{money(cart.summary().grandTotal)}</span>
              </div>
            </div>
            <label className="block text-sm font-bold text-slate-700">
              ชื่อบิลพัก (ไม่บังคับ)
              <input
                className="mt-1 w-full rounded-md border-slate-300"
                placeholder="เว้นว่างเพื่อใช้ชื่ออัตโนมัติ"
                value={parkName}
                onChange={(event) => setParkName(event.target.value)}
                autoFocus
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button className="rounded-md bg-slate-100 py-3 font-bold text-slate-700" onClick={() => setParkNameOpen(false)}>ยกเลิก</button>
              <button className="rounded-md bg-primary-600 py-3 font-black text-white" onClick={saveParkedBill}>พักบิล</button>
            </div>
          </div>
        </Modal>
      )}
      {parkedOpen && (
        <Modal title="รายการพักบิล" onClose={() => setParkedOpen(false)} wide>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-md bg-primary-50 p-3">
                <div className="text-xs font-bold text-primary-700">จำนวนบิลพัก</div>
                <div className="text-2xl font-black text-primary-900">{(parkedBills ?? []).length.toLocaleString('th-TH')}</div>
              </div>
              <div className="rounded-md bg-slate-50 p-3">
                <div className="text-xs font-bold text-slate-500">บิลในตะกร้าปัจจุบัน</div>
                <div className="text-2xl font-black text-slate-950">{cart.summary().itemCount.toLocaleString('th-TH')} ชิ้น</div>
              </div>
              <div className="rounded-md bg-slate-50 p-3">
                <div className="text-xs font-bold text-slate-500">ยอดตะกร้าปัจจุบัน</div>
                <div className="text-2xl font-black text-slate-950">{money(cart.summary().grandTotal)}</div>
              </div>
            </div>
            <div className="max-h-[52vh] overflow-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-slate-50 text-left text-slate-500">
                  <tr>
                    <th className="p-3">ชื่อ</th>
                    <th>เวลา</th>
                    <th>จำนวน</th>
                    <th>ยอด</th>
                    <th className="text-right">จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {(parkedBills ?? []).map((bill) => {
                    const parkedCart = ParkedBillRepository.parseCart(bill);
                    const parkedTotal = parkedCart.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
                    const parkedCount = parkedCart.items.reduce((sum, item) => sum + item.quantity, 0);
                    return (
                      <tr key={bill.id} className="border-t border-slate-100">
                        <td className="p-3 font-black text-slate-900">
                          {renamingParkedId === bill.id ? (
                            <div className="flex max-w-sm gap-2">
                              <input
                                className="min-w-0 flex-1 rounded-md border-slate-300 text-sm font-bold"
                                value={renamingParkedName}
                                onChange={(event) => setRenamingParkedName(event.target.value)}
                                autoFocus
                              />
                              <button className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-700" onClick={saveRenameParkedBill}>บันทึก</button>
                              <button className="rounded-md bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600" onClick={() => setRenamingParkedId(null)}>ยกเลิก</button>
                            </div>
                          ) : (
                            <button className="text-left font-black text-slate-900 hover:text-primary-700" onClick={() => startRenameParkedBill(bill.id, bill.name)}>
                              {bill.name}
                            </button>
                          )}
                        </td>
                        <td>{formatDateTime(bill.createdAt)}</td>
                        <td>{parkedCart.items.length.toLocaleString('th-TH')} รายการ / {parkedCount.toLocaleString('th-TH')} ชิ้น</td>
                        <td className="font-black">{money(parkedTotal)}</td>
                        <td className="p-3">
                          <div className="flex justify-end gap-2">
                            <button className="rounded-md bg-primary-600 px-3 py-2 font-black text-white" onClick={() => restoreParkedBill(bill.id)}>เรียกคืน</button>
                            <button className="rounded-md bg-slate-100 px-3 py-2 font-bold text-slate-700" onClick={() => startRenameParkedBill(bill.id, bill.name)}>ตั้งชื่อ</button>
                            <button className="rounded-md bg-red-50 px-3 py-2 font-black text-red-600" onClick={() => deleteParkedBill(bill.id)}><Trash2 size={16} /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {(parkedBills ?? []).length === 0 && <div className="p-8 text-center font-bold text-slate-500">ยังไม่มีบิลพัก</div>}
            </div>
          </div>
        </Modal>
      )}
      {summaryOpen && (
        <Modal title="สรุปยอดขายตามประเภท" onClose={() => setSummaryOpen(false)} wide>
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[220px_1fr_auto] md:items-center">
              <label className="flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3">
                <CalendarDays size={18} className="text-slate-400" />
                <input type="date" className="w-full border-0 py-2.5 focus:ring-0" value={summaryDate} onChange={(event) => setSummaryDate(event.target.value)} />
              </label>
              <button className="rounded-md bg-primary-600 px-4 py-2 font-black text-white" onClick={() => { reloadPaymentSummary(); reloadDailySummary(); }}>รีเฟรช</button>
              <button
                className="flex items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2 font-black text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                onClick={() => void buildSummaryPrintPreview()}
                disabled={summaryPrinting}
              >
                <Printer size={17} /> พิมพ์ใบสรุปยอด
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-md bg-primary-50 p-3">
                <div className="text-xs font-bold text-primary-700">ยอดขายสุทธิ</div>
                <div className="text-2xl font-black text-primary-900">{money(dailySummary?.totalSales ?? 0)}</div>
              </div>
              <div className="rounded-md bg-slate-50 p-3">
                <div className="text-xs font-bold text-slate-500">จำนวนบิล</div>
                <div className="text-2xl font-black text-slate-950">{(dailySummary?.billCount ?? 0).toLocaleString('th-TH')}</div>
              </div>
              <div className="rounded-md bg-red-50 p-3">
                <div className="text-xs font-bold text-red-700">ส่วนลดรวม</div>
                <div className="text-2xl font-black text-red-800">{money(dailySummary?.totalDiscount ?? 0)}</div>
              </div>
            </div>
            <div className="rounded-lg border border-slate-200">
              {[
                ['เงินสด', paymentSummary?.cash ?? 0],
                ['เงินโอน', paymentSummary?.transfer ?? 0],
                ['QR', paymentSummary?.qr ?? 0],
                ['บัตรเครดิต', paymentSummary?.credit ?? 0],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between border-b border-slate-100 px-4 py-3 last:border-b-0">
                  <span className="font-bold text-slate-700">{label}</span>
                  <span className="font-black text-slate-950">{money(Number(value))}</span>
                </div>
              ))}
            </div>
          </div>
        </Modal>
      )}
      {summaryPreviewOpen && (
        <Modal title="ตัวอย่างใบสรุปยอด" onClose={() => setSummaryPreviewOpen(false)} wide>
          <div className="flex max-h-[76vh] min-h-0 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto rounded-md bg-slate-200 p-5">
              <div
                className="print-receipt mx-auto bg-white"
                style={summaryRenderConfig ? getReceiptPreviewShellStyle(summaryRenderConfig, 0.65) : undefined}
              >
                {summaryRenderConfig && (
                  <pre className="whitespace-pre-wrap bg-white text-black shadow-sm" style={getReceiptPreviewStyle(summaryRenderConfig, 0.65)}>
                    {summaryPrintText}
                  </pre>
                )}
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                onClick={() => setSummaryPreviewOpen(false)}
                className="rounded-md bg-slate-100 py-3 font-bold text-slate-700 hover:bg-slate-200"
              >
                ยกเลิก
              </button>
              <button
                onClick={() => void printSummary()}
                disabled={summaryPrinting}
                className="flex items-center justify-center gap-2 rounded-md bg-primary-600 py-3 font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                <Printer size={18} /> {summaryPrinting ? 'กำลังพิมพ์...' : 'พิมพ์'}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {historyOpen && (
        <Modal title="ประวัติบิลในหน้าขาย" onClose={() => setHistoryOpen(false)} wide>
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[1fr_180px_auto]">
              <label className="flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3">
                <Search size={18} className="text-slate-400" />
                <input className="w-full border-0 py-2.5 focus:ring-0" placeholder="ค้นหาเลขบิล" value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} />
              </label>
              <label className="flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3">
                <CalendarDays size={18} className="text-slate-400" />
                <input type="date" className="w-full border-0 py-2.5 focus:ring-0" value={historyDate} onChange={(event) => setHistoryDate(event.target.value)} />
              </label>
              <button className="rounded-md bg-primary-600 px-4 py-2 font-black text-white" onClick={reloadHistory}>รีเฟรช</button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {billStatusTabs.map((tab) => (
                <button
                  key={tab.value || 'all'}
                  className={`rounded-md border px-4 py-2 text-sm font-black ${historyStatus === tab.value ? 'border-primary-600 bg-primary-600 text-white' : 'border-slate-200 bg-white text-slate-600'}`}
                  onClick={() => setHistoryStatus(tab.value)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-md bg-slate-50 p-3">
                <div className="text-xs font-bold text-slate-500">จำนวนบิล</div>
                <div className="text-2xl font-black text-slate-950">{historySummary.bills.toLocaleString('th-TH')}</div>
              </div>
              <div className="rounded-md bg-slate-50 p-3">
                <div className="text-xs font-bold text-slate-500">จำนวนรายการ</div>
                <div className="text-2xl font-black text-slate-950">{historySummary.items.toLocaleString('th-TH')}</div>
              </div>
              <div className="rounded-md bg-primary-50 p-3">
                <div className="text-xs font-bold text-primary-700">ยอดรวม</div>
                <div className="text-2xl font-black text-primary-900">{money(historySummary.total)}</div>
              </div>
            </div>

            <div className="max-h-[52vh] overflow-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="bg-slate-50 text-left text-slate-500">
                  <tr>
                    <th className="p-3">เลขบิล</th>
                    <th>วันที่</th>
                    <th>พนักงาน</th>
                    <th>รายการ</th>
                    <th>ชำระเงิน</th>
                    <th>ยอดรวม</th>
                    <th>สถานะ</th>
                    <th className="p-3 text-right">ดู</th>
                  </tr>
                </thead>
                <tbody>
                  {(historyBills ?? []).map((detail) => (
                    <tr key={detail.sale.id} className="border-t border-slate-100 hover:bg-primary-50/50">
                      <td className="p-3 font-black text-slate-900">{detail.sale.billNo}</td>
                      <td>{formatDateTime(detail.sale.createdAt)}</td>
                      <td>{detail.sale.cashierName}</td>
                      <td>{detail.items.reduce((sum, item) => sum + item.quantity, 0).toLocaleString('th-TH')}</td>
                      <td>{paymentLabel(detail)}</td>
                      <td className="font-black text-emerald-700">{money(detail.sale.total)}</td>
                      <td>
                        <span className={`rounded-full px-2 py-1 text-xs font-bold ${detail.sale.status === 'completed' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                          {statusLabel(detail.sale.status)}
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        <button className="rounded-md bg-slate-100 px-3 py-2 font-bold text-slate-700" onClick={() => setHistorySelected(detail)}>รายละเอียด</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(historyBills ?? []).length === 0 && <div className="p-8 text-center font-bold text-slate-500">ไม่พบบิลตามเงื่อนไข</div>}
            </div>
          </div>
        </Modal>
      )}
      {historySelected && (
        <Modal title={`รายละเอียดบิล ${historySelected.sale.billNo}`} onClose={() => setHistorySelected(null)} wide>
          <div className="grid gap-4 md:grid-cols-[1fr_280px]">
            <div>
              <div className="mb-3 font-black">รายการสินค้า</div>
              {historySelected.items.map((item) => (
                <div key={item.id} className="flex justify-between border-b border-slate-100 py-2 text-sm">
                  <span>{item.productName} x {item.quantity}</span>
                  <b>{money(item.total)}</b>
                </div>
              ))}
            </div>
            <div className="rounded-lg bg-slate-50 p-4">
              <div className="mb-3 rounded-md bg-white p-3 text-sm">
                <div className="mb-2 flex justify-between text-xs font-bold text-slate-400">
                  <span>ประเภทชำระเงิน</span>
                  <span>จำนวนรับ</span>
                </div>
                {historySelected.payments.length > 1 ? (
                  historySelected.payments.map((p) => (
                    <div key={p.id} className="flex justify-between py-0.5">
                      <span className="font-semibold text-slate-700">{METHOD_LABEL[p.method] ?? p.method}</span>
                      <b>{money(p.receivedAmount)}</b>
                    </div>
                  ))
                ) : (
                  <div className="flex justify-between py-0.5">
                    <span className="font-semibold text-slate-700">{METHOD_LABEL[historySelected.payments[0]?.method] ?? '-'}</span>
                    <b>{money(historySelected.payments[0]?.receivedAmount ?? 0)}</b>
                  </div>
                )}
                <div className="mt-2 space-y-1 border-t border-slate-200 pt-2">
                  <div className="flex justify-between"><span className="text-slate-600">รับเงินรวม</span><b>{money(paymentReceived(historySelected))}</b></div>
                  <div className="flex justify-between font-bold text-emerald-700"><span>เงินทอน</span><span>{money(paymentChange(historySelected))}</span></div>
                </div>
              </div>
              <div className="mb-2 text-xs text-slate-400">{formatDateTime(historySelected.sale.createdAt)}</div>
              <div className="flex justify-between py-1 text-sm"><span className="text-slate-500">พนักงาน</span><b>{historySelected.sale.cashierName}</b></div>
              <div className="flex justify-between py-1 text-sm"><span className="text-slate-500">ยอดก่อนลด</span><b>{money(historySelected.sale.subtotal)}</b></div>
              <div className="flex justify-between py-1 text-sm"><span className="text-slate-500">ส่วนลด</span><b>{money(historySelected.sale.discountAmount)}</b></div>
              <div className="mt-2 flex justify-between border-t border-slate-200 pt-3 text-xl font-black"><span>ยอดสุทธิ</span><span>{money(historySelected.sale.total)}</span></div>
              <button
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-md bg-primary-600 py-3 font-black text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                onClick={() => void printHistoryBill()}
                disabled={historyPrinting}
              >
                <Printer size={18} /> {historyPrinting ? 'กำลังพิมพ์...' : 'พิมพ์ซ้ำ'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
