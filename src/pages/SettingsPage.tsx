import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useLocation } from 'react-router-dom';
import { CreditCard, KeyRound, MonitorCog, Printer, RotateCcw, Save, SlidersHorizontal } from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { Card } from '../components/common/Card';
import { Modal } from '../components/common/Modal';
import { SettingsRepository } from '../db/repositories/SettingsRepository';
import { ProductRepository } from '../db/repositories/ProductRepository';
import { defaultPrinterSettings, PrinterRepository } from '../db/repositories/PrinterRepository';
import { CatalogDefaultRepository } from '../db/repositories/CatalogDefaultRepository';
import { useAsync } from '../hooks/useAsync';
import { useToast } from '../components/common/Toast';
import { ProductButton, productGridClasses, type ProductButtonSize, type ProductFontSize } from '../components/pos/ProductButton';
import type { PrinterSettings, SaleDetail } from '../types';
import { PrinterDeviceService, type PrinterDeviceCandidate } from '../services/printerDeviceService';
import { PrinterOutputService } from '../services/printerOutputService';
import { formatReceiptText } from '../services/receiptTextFormatter';
import { getReceiptRenderConfig, notifyReceiptSettingsUpdated } from '../services/receiptLayoutService';
import { ReceiptCanvasPreview } from '../components/pos/ReceiptCanvasPreview';
import { useAuthStore } from '../stores/authStore';
import { usePrinterLiveStatus } from '../hooks/usePrinterLiveStatus';
import { usePermissions } from '../hooks/usePermissions';
import { getDeviceCode, setDeviceCode, DEVICE_CODE_MAX_LEN } from '../utils/deviceCode';
import { ALL_PAYMENT_METHODS, PAYMENT_METHODS_SETTING_KEY, parseEnabledPaymentMethods, type PaymentMethodId } from './PaymentSettingsPage';
import { DISCOUNT_APPROVAL_REQUIRED_KEY } from '../utils/discountApproval';
import { LOGIN_SECURITY_CONFIG_KEY, defaultLoginSecurityConfig, parseLoginSecurityConfig } from '../utils/loginSecurity';

const sizeOptions = [
  { value: 'small', title: 'เล็ก' },
  { value: 'medium', title: 'กลาง' },
  { value: 'large', title: 'ใหญ่' },
] as const;

const fontPresetPx = {
  display: { small: 24, medium: 30, large: 48 },
  name: { small: 12, medium: 14, large: 16 },
  price: { small: 12, medium: 14, large: 16 },
} as const;

const fontLimits = {
  display: { min: 18, max: 64 },
  name: { min: 10, max: 28 },
  price: { min: 10, max: 28 },
} as const;

type FontTarget = keyof typeof fontPresetPx;
type SettingsTab = 'sale' | 'printer' | 'general' | 'payment' | 'login';
type PrinterSubTab = 'connection' | 'receipt';
type ConfirmDialogState = {
  title: string;
  message: string;
  confirmText: string;
  onConfirm: () => void;
};

const defaultProductCardSettings = {
  productSize: 'medium',
  displayFontSize: 'medium',
  nameFontSize: 'medium',
  priceFontSize: 'medium',
  displayFontPx: 30,
  nameFontPx: 14,
  priceFontPx: 14,
} as const;

const receiptPaperConfigs = {
  '58mm': {
    label: 'Thermal 58mm',
    cssWidth: '58mm',
    charsKey: 'receiptCharsPerLine58',
    widthKey: 'receiptWidthDots58',
    fontKey: 'receiptFontSizePx58',
    defaultChars: '32',
    defaultWidthDots: '384',
    defaultFontSizePx: '24',
  },
  '80mm': {
    label: 'Thermal 80mm',
    cssWidth: '80mm',
    charsKey: 'receiptCharsPerLine80',
    widthKey: 'receiptWidthDots80',
    fontKey: 'receiptFontSizePx80',
    defaultChars: '42',
    defaultWidthDots: '560',
    defaultFontSizePx: '28',
  },
} as const;

type ReceiptPaperSize = keyof typeof receiptPaperConfigs;

function getReceiptPaperSize(settings: PrinterSettings): ReceiptPaperSize {
  return settings.paperSize === '58mm' ? '58mm' : '80mm';
}

function createReceiptPreviewDetail(): SaleDetail {
  const createdAt = new Date('2026-05-07T08:44:00+07:00').toISOString();
  return {
    sale: {
      id: 'preview-sale',
      billNo: 'CALPOS-20260507-000001',
      cashierId: 'preview-user',
      cashierName: 'ผู้ดูแลระบบ',
      subtotal: 335,
      discountAmount: 5,
      discountPercent: 0,
      total: 330,
      status: 'completed',
      createdAt,
      updatedAt: createdAt,
    },
    items: [
      {
        id: 'preview-item-1',
        saleId: 'preview-sale',
        productId: 'p1',
        productName: 'ข้าวผัดไม่เอาผัก',
        price: 60,
        quantity: 1,
        subtotal: 60,
        discountAmount: 5,
        discountPercent: 0,
        total: 55,
        note: 'ไม่เอาผัก',
        isOpenPrice: false,
        createdAt,
      },
      {
        id: 'preview-item-2',
        saleId: 'preview-sale',
        productId: 'p2',
        productName: '185',
        price: 185,
        quantity: 1,
        subtotal: 185,
        discountAmount: 0,
        discountPercent: 0,
        total: 185,
        isOpenPrice: false,
        createdAt,
      },
      {
        id: 'preview-item-3',
        saleId: 'preview-sale',
        productId: 'p3',
        productName: 'หมูกระทะชุดใหญ่',
        price: 90,
        quantity: 1,
        subtotal: 90,
        discountAmount: 0,
        discountPercent: 0,
        total: 90,
        isOpenPrice: false,
        createdAt,
      },
    ],
    payments: [
      {
        id: 'preview-payment',
        saleId: 'preview-sale',
        method: 'cash',
        amount: 330,
        receivedAmount: 500,
        changeAmount: 170,
        createdAt,
      },
    ],
    discounts: [],
  };
}

function normalizedFontSize(value: string): ProductFontSize {
  return (value === 'small' || value === 'large' ? value : 'medium') as ProductFontSize;
}

function readFontPx(value: string | undefined, target: FontTarget, fallbackSize: string) {
  const numberValue = Number(value);
  if (Number.isFinite(numberValue) && numberValue > 0) return numberValue;
  return fontPresetPx[target][normalizedFontSize(fallbackSize)];
}

function SegmentedControl({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="grid grid-cols-3 gap-1 rounded-md bg-slate-100 p-1">
      {sizeOptions.map((option) => (
        <button
          key={option.value}
          className={`rounded-md px-3 py-2 text-sm font-bold ${value === option.value ? 'bg-primary-600 text-white shadow-sm' : 'text-slate-600 hover:bg-white'}`}
          onClick={() => onChange(option.value)}
        >
          {option.title}
        </button>
      ))}
    </div>
  );
}

function FontResizeControl({
  title,
  target,
  value,
  onChange,
}: {
  title: string;
  target: FontTarget;
  value: number;
  onChange: (value: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const limit = fontLimits[target];
  const percent = ((value - limit.min) / (limit.max - limit.min)) * 100;
  const setFromClientX = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    onChange(Math.round(limit.min + ratio * (limit.max - limit.min)));
  };

  return (
    <div className="mt-3 rounded-md border border-slate-200 bg-white p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-xs font-black text-slate-700">{title}</div>
        <div className="flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs font-black text-slate-700">
          <input
            type="number"
            min={limit.min}
            max={limit.max}
            value={value}
            onChange={(event) => onChange(Math.min(limit.max, Math.max(limit.min, Number(event.target.value) || limit.min)))}
            className="h-6 w-12 border-0 bg-transparent p-0 text-center text-xs font-black focus:ring-0"
          />
          px
        </div>
      </div>
      <div
        ref={trackRef}
        className="relative h-10 rounded-md bg-slate-100"
        onPointerDown={(event) => setFromClientX(event.clientX)}
      >
        <div className="absolute left-0 top-0 h-full rounded-md bg-primary-100" style={{ width: `${percent}%` }} />
        <div
          className="absolute top-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none items-center justify-center rounded-md border border-primary-500 bg-white shadow-md"
          style={{ left: `${percent}%` }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            setFromClientX(event.clientX);
          }}
          onPointerMove={(event) => {
            if (event.buttons === 1) setFromClientX(event.clientX);
          }}
        >
          <span className="h-5 w-1 rounded bg-primary-500" />
        </div>
      </div>
      <div className="mt-2 flex justify-between text-[11px] font-bold text-slate-400">
        <span>{limit.min}px</span>
        <span>ลาก handle เพื่อปรับขนาด</span>
        <span>{limit.max}px</span>
      </div>
    </div>
  );
}

export function SettingsPage() {
  const location = useLocation();
  const { data: settings, reload } = useAsync(() => SettingsRepository.getAll(), []);
  const { data: previewProducts } = useAsync(() => ProductRepository.getProducts(), []);
  const { data: savedPrinterSettings, reload: reloadPrinterSettings } = useAsync(() => PrinterRepository.getSettings(), []);
  const [activeTab, setActiveTab] = useState<SettingsTab>('sale');
  const [activePrinterTab, setActivePrinterTab] = useState<PrinterSubTab>('connection');
  const [draftPrinterSettings, setDraftPrinterSettings] = useState<PrinterSettings>(defaultPrinterSettings);
  const [detectedPrinterDevices, setDetectedPrinterDevices] = useState<PrinterDeviceCandidate[]>([]);
  const [printerScanMessage, setPrinterScanMessage] = useState('');
  const [isScanningPrinter, setIsScanningPrinter] = useState(false);
  const [draftProductSize, setDraftProductSize] = useState('medium');
  const [draftDisplayFontSize, setDraftDisplayFontSize] = useState('medium');
  const [draftNameFontSize, setDraftNameFontSize] = useState('medium');
  const [draftPriceFontSize, setDraftPriceFontSize] = useState('medium');
  const [draftDisplayFontPx, setDraftDisplayFontPx] = useState(30);
  const [draftNameFontPx, setDraftNameFontPx] = useState(14);
  const [draftPriceFontPx, setDraftPriceFontPx] = useState(14);
  const [draftAutoCloseReceiptEnabled, setDraftAutoCloseReceiptEnabled] = useState(false);
  const [draftAutoCloseReceiptSeconds, setDraftAutoCloseReceiptSeconds] = useState('5');
  const [draftAllowSalePriceEdit, setDraftAllowSalePriceEdit] = useState(false);
  const [previewProductId, setPreviewProductId] = useState('');
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [calibResult, setCalibResult] = useState<'cut' | 'ok' | 'space' | null>(null);
  const [calibLastVisible, setCalibLastVisible] = useState('');
  const toast = useToast();
  const user = useAuthStore((state) => state.user);
  const printerLiveStatus = usePrinterLiveStatus();
  const { can, positions } = usePermissions();

  // --- Payment tab state ---
  const { data: savedPaymentSetting, reload: reloadPaymentSetting } = useAsync(() => SettingsRepository.getSetting(PAYMENT_METHODS_SETTING_KEY), []);
  const [enabledPayments, setEnabledPayments] = useState<Set<PaymentMethodId>>(new Set(ALL_PAYMENT_METHODS.map((m) => m.id)));
  const [isPaymentDirty, setIsPaymentDirty] = useState(false);

  // --- General tab state ---
  const [showResetCatalogConfirm, setShowResetCatalogConfirm] = useState(false);
  const [isResettingCatalog, setIsResettingCatalog] = useState(false);
  const [isSavingDiscountApproval, setIsSavingDiscountApproval] = useState(false);
  const savedLoginSecurityConfig = useMemo(
    () => parseLoginSecurityConfig(settings?.find((setting) => setting.key === LOGIN_SECURITY_CONFIG_KEY)?.value),
    [settings],
  );
  const [draftPasswordMaxAttempts, setDraftPasswordMaxAttempts] = useState(String(defaultLoginSecurityConfig.passwordMaxAttempts));
  const [draftPinMaxAttempts, setDraftPinMaxAttempts] = useState(String(defaultLoginSecurityConfig.pinMaxAttempts));

  const savedProductSize = useMemo(() => settings?.find((setting) => setting.key === 'productButtonSize')?.value ?? 'medium', [settings]);
  const savedDisplayFontSize = useMemo(() => settings?.find((setting) => setting.key === 'productButtonDisplayFontSize')?.value ?? 'medium', [settings]);
  const savedNameFontSize = useMemo(() => settings?.find((setting) => setting.key === 'productButtonNameFontSize')?.value ?? 'medium', [settings]);
  const savedPriceFontSize = useMemo(() => settings?.find((setting) => setting.key === 'productButtonPriceFontSize')?.value ?? 'medium', [settings]);
  const savedDisplayFontPx = useMemo(() => readFontPx(settings?.find((setting) => setting.key === 'productButtonDisplayFontPx')?.value, 'display', savedDisplayFontSize), [settings, savedDisplayFontSize]);
  const savedNameFontPx = useMemo(() => readFontPx(settings?.find((setting) => setting.key === 'productButtonNameFontPx')?.value, 'name', savedNameFontSize), [settings, savedNameFontSize]);
  const savedPriceFontPx = useMemo(() => readFontPx(settings?.find((setting) => setting.key === 'productButtonPriceFontPx')?.value, 'price', savedPriceFontSize), [settings, savedPriceFontSize]);
  const savedAutoCloseReceiptEnabled = useMemo(() => (settings?.find((setting) => setting.key === 'autoCloseReceiptEnabled')?.value ?? 'false') === 'true', [settings]);
  const savedAutoCloseReceiptSeconds = useMemo(() => settings?.find((setting) => setting.key === 'autoCloseReceiptSeconds')?.value ?? '5', [settings]);
  const savedAllowSalePriceEdit = useMemo(() => (settings?.find((setting) => setting.key === 'allowSalePriceEdit')?.value ?? 'false') === 'true', [settings]);
  const isLoginSecurityDirty = Number(draftPasswordMaxAttempts) !== savedLoginSecurityConfig.passwordMaxAttempts
    || Number(draftPinMaxAttempts) !== savedLoginSecurityConfig.pinMaxAttempts;
  const discountApprovalRequired = useMemo(() => (settings?.find((setting) => setting.key === DISCOUNT_APPROVAL_REQUIRED_KEY)?.value ?? 'false') === 'true', [settings]);
  const discountApproverPositions = useMemo(
    () => positions.filter((position) => position.name === 'Admin' || position.permissions.includes('apply_discount')),
    [positions],
  );
  const nonAdminDiscountApproverPositions = useMemo(
    () => positions.filter((position) => position.name !== 'Admin' && position.permissions.includes('apply_discount')),
    [positions],
  );
  const hasPrinterSettingsChange = JSON.stringify(draftPrinterSettings) !== JSON.stringify(savedPrinterSettings ?? defaultPrinterSettings);
  const printerControlsDisabled = !draftPrinterSettings.enabled;
  const printerStatus = PrinterRepository.getStatus(draftPrinterSettings);
  const activeReceiptPaperSize = getReceiptPaperSize(draftPrinterSettings);
  const activeReceiptPaperConfig = receiptPaperConfigs[activeReceiptPaperSize];
  const activeReceiptCharsPerLine = draftPrinterSettings[activeReceiptPaperConfig.charsKey];
  const activeReceiptWidthDots = draftPrinterSettings[activeReceiptPaperConfig.widthKey];
  const activeReceiptFontSizePx = draftPrinterSettings[activeReceiptPaperConfig.fontKey];
  const billResetRule = (settings?.find((s) => s.key === 'billNumberResetRule')?.value ?? 'daily') === 'daily' ? 'daily' : 'continuous';
  const receiptContentSettings = useMemo(() => ({
    storeName: settings?.find((setting) => setting.key === 'storeName')?.value ?? 'Cal POS Store',
    branchName: settings?.find((setting) => setting.key === 'branchName')?.value ?? 'สาขาหลัก',
    taxId: settings?.find((setting) => setting.key === 'taxId')?.value ?? '',
    receiptFooter: settings?.find((setting) => setting.key === 'receiptFooter')?.value ?? 'ขอบคุณที่ใช้บริการ',
    currencySymbol: settings?.find((setting) => setting.key === 'currencySymbol')?.value ?? '฿',
  }), [settings]);
  const receiptRenderConfig = getReceiptRenderConfig(draftPrinterSettings);
  const receiptPreviewText = useMemo(
    () => formatReceiptText(createReceiptPreviewDetail(), receiptRenderConfig.charsPerLine, receiptContentSettings),
    [receiptContentSettings, receiptRenderConfig.charsPerLine],
  );
  const calibRulerWidth = Math.min(46, Math.max(30, Number(activeReceiptCharsPerLine) || 42));
  const calibSuggestion = useMemo(() => {
    const currentDots = Number(activeReceiptWidthDots);
    const currentChars = Number(activeReceiptCharsPerLine);
    if (calibResult === 'ok') return { status: 'ok' as const };
    if (calibResult === 'space') return { status: 'space' as const };
    if (calibResult === 'cut') {
      const last = Number(calibLastVisible);
      if (!last || last <= 0 || last >= currentChars) return null;
      const rawDots = Math.round((last * currentDots) / currentChars);
      const newDots = Math.round(rawDots / 8) * 8;
      const minDots = activeReceiptPaperSize === '58mm' ? 320 : 480;
      const maxDots = activeReceiptPaperSize === '58mm' ? 420 : 576;
      return {
        status: 'cut' as const,
        newDots: Math.min(maxDots, Math.max(minDots, newDots)),
        newChars: last,
      };
    }
    return null;
  }, [calibResult, calibLastVisible, activeReceiptWidthDots, activeReceiptCharsPerLine, activeReceiptPaperSize]);
  const hasSaleSettingsChange = draftProductSize !== savedProductSize
    || draftDisplayFontSize !== savedDisplayFontSize
    || draftNameFontSize !== savedNameFontSize
    || draftPriceFontSize !== savedPriceFontSize
    || draftDisplayFontPx !== savedDisplayFontPx
    || draftNameFontPx !== savedNameFontPx
    || draftPriceFontPx !== savedPriceFontPx
    || draftAutoCloseReceiptEnabled !== savedAutoCloseReceiptEnabled
    || draftAutoCloseReceiptSeconds !== savedAutoCloseReceiptSeconds
    || draftAllowSalePriceEdit !== savedAllowSalePriceEdit;
  const hasUnsavedSettingsChange = hasSaleSettingsChange || hasPrinterSettingsChange || isLoginSecurityDirty;
  const previewProduct = useMemo(() => {
    return previewProducts?.find((product) => product.id === previewProductId) ?? previewProducts?.find((product) => !product.isOpenPrice) ?? previewProducts?.[0] ?? null;
  }, [previewProducts, previewProductId]);
  const normalizedDraftProductSize = (draftProductSize === 'small' || draftProductSize === 'large' ? draftProductSize : 'medium') as ProductButtonSize;
  const navigationBlocker = useBlocker(hasUnsavedSettingsChange);

  const resetSaleDraftToSaved = useCallback(() => {
    setDraftProductSize(savedProductSize);
    setDraftDisplayFontSize(savedDisplayFontSize);
    setDraftNameFontSize(savedNameFontSize);
    setDraftPriceFontSize(savedPriceFontSize);
    setDraftDisplayFontPx(savedDisplayFontPx);
    setDraftNameFontPx(savedNameFontPx);
    setDraftPriceFontPx(savedPriceFontPx);
    setDraftAutoCloseReceiptEnabled(savedAutoCloseReceiptEnabled);
    setDraftAutoCloseReceiptSeconds(savedAutoCloseReceiptSeconds);
    setDraftAllowSalePriceEdit(savedAllowSalePriceEdit);
  }, [savedProductSize, savedDisplayFontSize, savedNameFontSize, savedPriceFontSize, savedDisplayFontPx, savedNameFontPx, savedPriceFontPx, savedAutoCloseReceiptEnabled, savedAutoCloseReceiptSeconds, savedAllowSalePriceEdit]);

  const resetPrinterDraftToSaved = useCallback(() => {
    setDraftPrinterSettings(savedPrinterSettings ?? defaultPrinterSettings);
  }, [savedPrinterSettings]);

  const resetAllDraftsToSaved = useCallback(() => {
    resetSaleDraftToSaved();
    resetPrinterDraftToSaved();
    setDraftPasswordMaxAttempts(String(savedLoginSecurityConfig.passwordMaxAttempts));
    setDraftPinMaxAttempts(String(savedLoginSecurityConfig.pinMaxAttempts));
  }, [resetSaleDraftToSaved, resetPrinterDraftToSaved, savedLoginSecurityConfig.passwordMaxAttempts, savedLoginSecurityConfig.pinMaxAttempts]);

  const applyDefaultProductCardSettings = () => {
    setDraftProductSize(defaultProductCardSettings.productSize);
    setDraftDisplayFontSize(defaultProductCardSettings.displayFontSize);
    setDraftNameFontSize(defaultProductCardSettings.nameFontSize);
    setDraftPriceFontSize(defaultProductCardSettings.priceFontSize);
    setDraftDisplayFontPx(defaultProductCardSettings.displayFontPx);
    setDraftNameFontPx(defaultProductCardSettings.nameFontPx);
    setDraftPriceFontPx(defaultProductCardSettings.priceFontPx);
  };

  const closeConfirmDialog = () => {
    if (navigationBlocker.state === 'blocked') navigationBlocker.reset();
    setConfirmDialog(null);
  };

  const confirmDiscardSettings = (onConfirm: () => void, message = 'ต้องการละทิ้งการตั้งค่าที่ยังไม่ได้บันทึกหรือไม่?') => {
    setConfirmDialog({
      title: 'มีการตั้งค่าที่ยังไม่ได้บันทึก',
      message,
      confirmText: 'ละทิ้งการตั้งค่า',
      onConfirm: () => {
        resetAllDraftsToSaved();
        setConfirmDialog(null);
        onConfirm();
      },
    });
  };

  const changeTab = (nextTab: SettingsTab) => {
    if (nextTab === activeTab) return;
    if (hasUnsavedSettingsChange) {
      confirmDiscardSettings(() => setActiveTab(nextTab), 'ต้องการเปลี่ยน tab และละทิ้งการตั้งค่าที่ยังไม่ได้บันทึกหรือไม่?');
      return;
    }
    setActiveTab(nextTab);
  };

  const changePrinterTab = (nextTab: PrinterSubTab) => {
    if (nextTab === activePrinterTab) return;
    if (hasPrinterSettingsChange) {
      confirmDiscardSettings(() => setActivePrinterTab(nextTab), 'ต้องการเปลี่ยนหน้าเครื่องพิมพ์และละทิ้งการตั้งค่าที่ยังไม่ได้บันทึกหรือไม่?');
      return;
    }
    setActivePrinterTab(nextTab);
  };

  useEffect(() => {
    setDraftProductSize(savedProductSize);
    setDraftDisplayFontSize(savedDisplayFontSize);
    setDraftNameFontSize(savedNameFontSize);
    setDraftPriceFontSize(savedPriceFontSize);
    setDraftDisplayFontPx(savedDisplayFontPx);
    setDraftNameFontPx(savedNameFontPx);
    setDraftPriceFontPx(savedPriceFontPx);
    setDraftAutoCloseReceiptEnabled(savedAutoCloseReceiptEnabled);
    setDraftAutoCloseReceiptSeconds(savedAutoCloseReceiptSeconds);
    setDraftAllowSalePriceEdit(savedAllowSalePriceEdit);
  }, [savedProductSize, savedDisplayFontSize, savedNameFontSize, savedPriceFontSize, savedDisplayFontPx, savedNameFontPx, savedPriceFontPx, savedAutoCloseReceiptEnabled, savedAutoCloseReceiptSeconds, savedAllowSalePriceEdit]);

  useEffect(() => {
    if (savedPrinterSettings) setDraftPrinterSettings(savedPrinterSettings);
  }, [savedPrinterSettings]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tab = params.get('tab');
    if (tab === 'printer') { setActiveTab('printer'); setActivePrinterTab('connection'); }
    else if (tab === 'general') setActiveTab('general');
    else if (tab === 'payment') setActiveTab('payment');
    else if (tab === 'login') setActiveTab('login');
  }, [location.search]);

  useEffect(() => {
    setDraftPasswordMaxAttempts(String(savedLoginSecurityConfig.passwordMaxAttempts));
    setDraftPinMaxAttempts(String(savedLoginSecurityConfig.pinMaxAttempts));
  }, [savedLoginSecurityConfig.passwordMaxAttempts, savedLoginSecurityConfig.pinMaxAttempts]);

  useEffect(() => {
    if (savedPaymentSetting !== null) {
      setEnabledPayments(new Set(parseEnabledPaymentMethods(savedPaymentSetting)));
      setIsPaymentDirty(false);
    }
  }, [savedPaymentSetting]);

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedSettingsChange) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [hasUnsavedSettingsChange]);

  useEffect(() => {
    if (navigationBlocker.state !== 'blocked') return;
    setConfirmDialog({
      title: 'มีการตั้งค่าที่ยังไม่ได้บันทึก',
      message: 'ต้องการละทิ้งการตั้งค่าหน้าขายและออกจากหน้านี้หรือไม่?',
      confirmText: 'ละทิ้งการตั้งค่า',
      onConfirm: () => {
        resetAllDraftsToSaved();
        setConfirmDialog(null);
        navigationBlocker.proceed();
      },
    });
  }, [navigationBlocker, resetAllDraftsToSaved]);

  const togglePayment = (id: PaymentMethodId) => {
    setEnabledPayments((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        if (next.size <= 1) { toast('ต้องเปิดอย่างน้อย 1 ช่องทางชำระเงิน', 'error'); return prev; }
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    setIsPaymentDirty(true);
  };

  const savePaymentSettings = async () => {
    const value = JSON.stringify(ALL_PAYMENT_METHODS.map((m) => m.id).filter((id) => enabledPayments.has(id)));
    await SettingsRepository.setSetting(PAYMENT_METHODS_SETTING_KEY, value);
    toast('บันทึกการตั้งค่าการชำระเงินแล้ว', 'success');
    reloadPaymentSetting();
    setIsPaymentDirty(false);
  };

  const toggleDiscountApprovalRequired = async () => {
    const next = !discountApprovalRequired;
    if (next && nonAdminDiscountApproverPositions.length === 0) {
      toast('กรุณาเปิดสิทธิ์ “ใส่ PIN ส่วนลดรายการ/ท้ายบิล” ให้ตำแหน่งอื่นก่อน จึงจะเปิดการอนุมัติส่วนลดได้', 'error');
      return;
    }
    setIsSavingDiscountApproval(true);
    try {
      await SettingsRepository.setSetting(DISCOUNT_APPROVAL_REQUIRED_KEY, String(next), { sync: true });
      toast(next ? 'เปิดการอนุมัติส่วนลดด้วย PIN แล้ว' : 'ปิดการอนุมัติส่วนลดด้วย PIN แล้ว', 'success');
      reload();
    } finally {
      setIsSavingDiscountApproval(false);
    }
  };

  const saveLoginSecuritySettings = async () => {
    const passwordMaxAttempts = Math.max(1, Math.floor(Number(draftPasswordMaxAttempts || 1)));
    const pinMaxAttempts = Math.max(1, Math.floor(Number(draftPinMaxAttempts || 1)));
    await SettingsRepository.setSetting(LOGIN_SECURITY_CONFIG_KEY, JSON.stringify({ passwordMaxAttempts, pinMaxAttempts }), { sync: true });
    toast('บันทึกการตั้งค่าการลงชื่อเข้าใช้แล้ว', 'success');
    reload();
  };

  const handleResetCatalog = async () => {
    setIsResettingCatalog(true);
    try {
      await CatalogDefaultRepository.resetToDefaultCatalog();
      toast('Reset รายการสินค้าและหมวดหมู่เป็นค่าเริ่มต้นแล้ว', 'success');
      setShowResetCatalogConfirm(false);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Reset ไม่สำเร็จ', 'error');
    } finally {
      setIsResettingCatalog(false);
    }
  };

  const save = async (key: string, value: string) => {
    await SettingsRepository.setSetting(key, value);
    toast('บันทึกการตั้งค่าแล้ว', 'success');
    reload();
    if (['storeName', 'branchName', 'taxId', 'currencySymbol', 'receiptFooter'].includes(key)) {
      notifyReceiptSettingsUpdated();
    }
  };

  const saveSaleSettings = async () => {
    await Promise.all([
      SettingsRepository.setSetting('productButtonSize', draftProductSize),
      SettingsRepository.setSetting('productButtonDisplayFontSize', draftDisplayFontSize),
      SettingsRepository.setSetting('productButtonNameFontSize', draftNameFontSize),
      SettingsRepository.setSetting('productButtonPriceFontSize', draftPriceFontSize),
      SettingsRepository.setSetting('productButtonDisplayFontPx', String(draftDisplayFontPx)),
      SettingsRepository.setSetting('productButtonNameFontPx', String(draftNameFontPx)),
      SettingsRepository.setSetting('productButtonPriceFontPx', String(draftPriceFontPx)),
      SettingsRepository.setSetting('autoCloseReceiptEnabled', String(draftAutoCloseReceiptEnabled)),
      SettingsRepository.setSetting('autoCloseReceiptSeconds', String(Math.max(1, Number(draftAutoCloseReceiptSeconds || 1)))),
      SettingsRepository.setSetting('allowSalePriceEdit', String(draftAllowSalePriceEdit)),
    ]);
    toast('บันทึกการตั้งค่าหน้าขายแล้ว', 'success');
    reload();
  };

  const updatePrinterDraft = <K extends keyof PrinterSettings>(key: K, value: PrinterSettings[K]) => {
    setDraftPrinterSettings((current) => ({ ...current, [key]: value }));
  };

  const updateActiveReceiptDraft = (key: 'charsKey' | 'widthKey' | 'fontKey', value: string) => {
    const settingKey = activeReceiptPaperConfig[key];
    setDraftPrinterSettings((current) => ({ ...current, [settingKey]: value }));
  };

  const resetActiveReceiptDefaults = () => {
    setDraftPrinterSettings((current) => ({
      ...current,
      [activeReceiptPaperConfig.charsKey]: activeReceiptPaperConfig.defaultChars,
      [activeReceiptPaperConfig.widthKey]: activeReceiptPaperConfig.defaultWidthDots,
      [activeReceiptPaperConfig.fontKey]: activeReceiptPaperConfig.defaultFontSizePx,
    }));
  };

  const applyCalibSuggestion = () => {
    if (!calibSuggestion || calibSuggestion.status !== 'cut') return;
    updateActiveReceiptDraft('widthKey', String(calibSuggestion.newDots));
    updateActiveReceiptDraft('charsKey', String(calibSuggestion.newChars));
    setCalibResult(null);
    setCalibLastVisible('');
    toast('นำค่า calibrate ไปใช้แล้ว — อย่าลืมกดบันทึกการตั้งค่า', 'success');
  };

  const selectConnectionType = (connectionType: PrinterSettings['connectionType']) => {
    setDetectedPrinterDevices([]);
    setPrinterScanMessage('');
    setDraftPrinterSettings((current) => ({ ...current, connectionType }));
  };

  const scanPrinterDevices = async () => {
    setDetectedPrinterDevices([]);
    if (draftPrinterSettings.connectionType === 'lan') {
      toast('LAN ต้องกรอก IP และ Port ของเครื่องพิมพ์เอง', 'info');
      return;
    }
    if (draftPrinterSettings.connectionType === 'usb') {
      const usb = (navigator as Navigator & {
        usb?: {
          requestDevice: (options: { filters: Array<Record<string, unknown>> }) => Promise<{
            productName?: string;
            manufacturerName?: string;
            vendorId: number;
            productId: number;
          }>;
        };
      }).usb;
      if (!usb) {
        toast('Browser นี้ยังไม่รองรับ WebUSB ให้ใช้ Chrome/Edge บน HTTPS หรือ localhost', 'error');
        return;
      }
      try {
        const device = await usb.requestDevice({ filters: [] });
        const vendorId = device.vendorId.toString(16).padStart(4, '0');
        const productId = device.productId.toString(16).padStart(4, '0');
        const name = device.productName || device.manufacturerName || `USB ${vendorId}:${productId}`;
        setDetectedPrinterDevices([{ id: `${vendorId}:${productId}`, name, meta: `Vendor ${vendorId} / Product ${productId}`, type: 'usb' }]);
        setDraftPrinterSettings((current) => ({ ...current, printerName: name, usbVendorId: vendorId, usbProductId: productId, enabled: true }));
        toast('พบเครื่องพิมพ์ USB แล้ว อย่าลืมกดบันทึกการตั้งค่า', 'success');
      } catch {
        toast('ยกเลิกการเลือก USB หรือไม่พบอุปกรณ์', 'info');
      }
      return;
    }
    const bluetooth = (navigator as Navigator & {
      bluetooth?: {
        requestDevice: (options: { acceptAllDevices: boolean; optionalServices?: string[] }) => Promise<{ id: string; name?: string }>;
      };
    }).bluetooth;
    if (!bluetooth) {
      toast('Browser นี้ยังไม่รองรับ Web Bluetooth หรือเครื่องพิมพ์เป็น Bluetooth Classic', 'error');
      return;
    }
    try {
      const device = await bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: ['battery_service'] });
      const name = device.name || 'Bluetooth printer';
      setDetectedPrinterDevices([{ id: device.id, name, meta: device.id, type: 'bluetooth' }]);
      setDraftPrinterSettings((current) => ({ ...current, printerName: name, bluetoothAddress: device.id, enabled: true }));
      toast('พบอุปกรณ์ Bluetooth แล้ว อย่าลืมกดบันทึกการตั้งค่า', 'success');
    } catch {
      toast('ยกเลิกการเลือก Bluetooth หรือไม่พบอุปกรณ์', 'info');
    }
  };

  const applyPrinterDevice = (device: PrinterDeviceCandidate) => {
    setDraftPrinterSettings((current) => ({
      ...current,
      enabled: true,
      printerName: device.name,
      usbVendorId: device.type === 'usb' ? device.vendorId ?? device.id.split(':')[0] ?? '' : current.usbVendorId,
      usbProductId: device.type === 'usb' ? device.productId ?? device.id.split(':')[1] ?? '' : current.usbProductId,
      usbDeviceName: device.type === 'usb' ? device.deviceName ?? '' : current.usbDeviceName,
      bluetoothAddress: device.type === 'bluetooth' ? device.bluetoothAddress ?? device.id : current.bluetoothAddress,
    }));
  };

  const selectPrinterDevice = async (device: PrinterDeviceCandidate) => {
    try {
      const authorizedDevice = await PrinterDeviceService.authorize(device);
      applyPrinterDevice(authorizedDevice);
      setDetectedPrinterDevices((current) => current.map((item) => (item.id === device.id ? authorizedDevice : item)));
      toast(authorizedDevice.hasPermission === false ? 'เลือกเครื่องพิมพ์แล้ว แต่ Android ยังไม่อนุญาต USB' : 'เลือกเครื่องพิมพ์แล้ว อย่าลืมกดบันทึกการตั้งค่า', authorizedDevice.hasPermission === false ? 'error' : 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'เชื่อมต่อเครื่องพิมพ์ไม่สำเร็จ', 'error');
    }
  };

  const scanPrinterDevicesForCurrentPlatform = async () => {
    if (isScanningPrinter) return;
    setPrinterScanMessage('');
    setDetectedPrinterDevices([]);
    try {
      setIsScanningPrinter(true);
      const result = await PrinterDeviceService.scan(draftPrinterSettings.connectionType);
      if (result.message) {
        setPrinterScanMessage(result.message);
        toast(result.message, 'info');
      }
      setDetectedPrinterDevices(result.devices);
      if (result.devices.length === 1) {
        await selectPrinterDevice(result.devices[0]);
      } else if (result.devices.length > 1) {
        toast('พบอุปกรณ์หลายรายการ กรุณาเลือกเครื่องพิมพ์ที่ต้องการ', 'success');
      } else if (!result.message) {
        toast('ไม่พบเครื่องพิมพ์ที่เชื่อมต่อได้', 'info');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ค้นหาเครื่องพิมพ์ไม่สำเร็จ';
      setPrinterScanMessage(message);
      toast(message, 'error');
    } finally {
      setIsScanningPrinter(false);
    }
  };

  const savePrinterSettings = async () => {
    await PrinterRepository.setSettings(draftPrinterSettings);
    toast('บันทึกการตั้งค่าเครื่องพิมพ์แล้ว', 'success');
    reload();
    reloadPrinterSettings();
    notifyReceiptSettingsUpdated();
    window.dispatchEvent(new CustomEvent('calpos:printer-settings-updated'));
  };

  const browserTestPrint = () => {
    const testNode = document.createElement('div');
    testNode.className = 'print-printer-test';
    testNode.innerHTML = '<div>Cal POS</div>';
    document.body.appendChild(testNode);
    document.body.dataset.printMode = 'printer-test';
    const cleanup = () => {
      testNode.remove();
      delete document.body.dataset.printMode;
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.setTimeout(() => {
      window.print();
      window.setTimeout(cleanup, 800);
    }, 50);
  };

  const testPrinterPrint = async () => {
    try {
      const result = await PrinterOutputService.printTest(draftPrinterSettings);
      if (result === 'browser') browserTestPrint();
      else toast('ส่งคำสั่งทดสอบพิมพ์แล้ว', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'ทดสอบพิมพ์ไม่สำเร็จ', 'error');
    }
  };

  const testCashDrawer = async () => {
    if (!user) {
      toast('ไม่พบผู้ใช้งานปัจจุบัน', 'error');
      return;
    }
    const log = await PrinterRepository.openDrawer({
      user,
      action: 'open_only',
      amount: 0,
      note: 'Test cash drawer from printer settings',
      settings: draftPrinterSettings,
    });
    toast(log.status === 'success' ? 'ส่งคำสั่งทดสอบเปิดลิ้นชักแล้ว' : log.error ?? 'เปิดลิ้นชักไม่สำเร็จ', log.status === 'success' ? 'success' : 'error');
  };

  const testReceiptCalibration = async () => {
    try {
      const result = await PrinterOutputService.printReceiptCalibration(draftPrinterSettings);
      if (result === 'native') toast('ส่งพิมพ์ใบ calibrate แล้ว', 'success');
      else toast('การ calibrate ต้องพิมพ์จากเครื่องพิมพ์ Android USB', 'info');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'พิมพ์ใบ calibrate ไม่สำเร็จ', 'error');
    }
  };

  const printReceiptPreview = async () => {
    try {
      const result = await PrinterOutputService.printText(receiptPreviewText, draftPrinterSettings);
      if (result === 'native') toast('ส่งพิมพ์ใบเสร็จตัวอย่างแล้ว', 'success');
      else toast('การพิมพ์ตรงต้องใช้งานผ่าน Android', 'info');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'พิมพ์ไม่สำเร็จ', 'error');
    }
  };

  return (
    <div className="p-4 md:p-6">
      <PageHeader title="ตั้งค่า" subtitle="การตั้งค่าหน้าขาย ข้อมูลใบเสร็จ และเครื่องพิมพ์" />

      <div className="mb-4 flex flex-wrap gap-1 rounded-lg bg-white p-1 shadow-sm">
        <button className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-black ${activeTab === 'sale' ? 'bg-primary-600 text-white' : 'text-slate-600'}`} onClick={() => changeTab('sale')}>
          <MonitorCog size={17} /> การตั้งค่าหน้าขาย
        </button>
        <button className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-black ${activeTab === 'printer' ? 'bg-primary-600 text-white' : 'text-slate-600'}`} onClick={() => changeTab('printer')}>
          <Printer size={17} /> ตั้งค่าเครื่องพิมพ์
        </button>
        <button className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-black ${activeTab === 'payment' ? 'bg-primary-600 text-white' : 'text-slate-600'}`} onClick={() => changeTab('payment')}>
          <CreditCard size={17} /> การชำระเงิน
        </button>
        <button className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-black ${activeTab === 'login' ? 'bg-primary-600 text-white' : 'text-slate-600'}`} onClick={() => changeTab('login')}>
          <KeyRound size={17} /> การลงชื่อเข้าใช้
        </button>
        <button className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-black ${activeTab === 'general' ? 'bg-primary-600 text-white' : 'text-slate-600'}`} onClick={() => changeTab('general')}>
          <SlidersHorizontal size={17} /> ตั้งค่าทั่วไป
        </button>
      </div>

      {activeTab === 'sale' && (
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-base font-black text-slate-950">การตั้งค่าหน้าขาย</h2>
              <p className="mt-1 text-xs text-slate-500">ปรับขนาดกล่องและฟอนต์ ปุ่มบันทึกเท่านั้นจึงจะมีผลกับหน้าขายจริง</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <button
                type="button"
                className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-700 shadow-sm hover:bg-slate-50"
                onClick={applyDefaultProductCardSettings}
              >
                <RotateCcw size={16} /> รีเซ็ตกล่องสินค้า
              </button>
              <button
                className={`inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-black text-white shadow-sm ${hasSaleSettingsChange ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-slate-400'}`}
                onClick={saveSaleSettings}
                disabled={!hasSaleSettingsChange}
              >
                <Save size={16} /> บันทึกการตั้งค่า
              </button>
            </div>
          </div>

          <div className="grid gap-6 p-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-4">
              <section>
                <h3 className="mb-2 text-sm font-black text-slate-800">ขนาดกล่องรายการสินค้า</h3>
                <SegmentedControl value={draftProductSize} onChange={setDraftProductSize} />
              </section>

              <section>
                <h3 className="mb-2 text-sm font-black text-slate-800">ขนาดฟอนต์</h3>
                <div className="grid gap-3 lg:grid-cols-3">
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <div className="mb-2 text-xs font-black text-slate-600">Display name</div>
                    <SegmentedControl
                      value={draftDisplayFontSize}
                      onChange={(value) => {
                        const size = normalizedFontSize(value);
                        setDraftDisplayFontSize(size);
                        setDraftDisplayFontPx(fontPresetPx.display[size]);
                      }}
                    />
                    <FontResizeControl title="Manual resize" target="display" value={draftDisplayFontPx} onChange={setDraftDisplayFontPx} />
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <div className="mb-2 text-xs font-black text-slate-600">Product name</div>
                    <SegmentedControl
                      value={draftNameFontSize}
                      onChange={(value) => {
                        const size = normalizedFontSize(value);
                        setDraftNameFontSize(size);
                        setDraftNameFontPx(fontPresetPx.name[size]);
                      }}
                    />
                    <FontResizeControl title="Manual resize" target="name" value={draftNameFontPx} onChange={setDraftNameFontPx} />
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <div className="mb-2 text-xs font-black text-slate-600">ราคา</div>
                    <SegmentedControl
                      value={draftPriceFontSize}
                      onChange={(value) => {
                        const size = normalizedFontSize(value);
                        setDraftPriceFontSize(size);
                        setDraftPriceFontPx(fontPresetPx.price[size]);
                      }}
                    />
                    <FontResizeControl title="Manual resize" target="price" value={draftPriceFontPx} onChange={setDraftPriceFontPx} />
                  </div>
                </div>
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-sm font-black text-slate-800">แก้ไขราคาหน้าขาย</h3>
                    <p className="mt-1 text-xs font-medium text-slate-500">เปิดให้ผู้ใช้ที่มีสิทธิ์เห็นเมนูแก้ไขราคาขายต่อชิ้นในตะกร้า ส่วนลดบาทและส่วนลด % ยังใช้งานได้แยกตามปกติ</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDraftAllowSalePriceEdit((value) => !value)}
                    className={`relative h-8 w-14 shrink-0 rounded-full transition ${draftAllowSalePriceEdit ? 'bg-primary-600' : 'bg-slate-300'}`}
                    aria-pressed={draftAllowSalePriceEdit}
                  >
                    <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition ${draftAllowSalePriceEdit ? 'left-7' : 'left-1'}`} />
                  </button>
                </div>
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-sm font-black text-slate-800">การปิดบิลอัตโนมัติ</h3>
                    <p className="mt-1 text-xs font-medium text-slate-500">เมื่อบันทึกการขายสำเร็จ ระบบจะปิดหน้าบิลให้อัตโนมัติหลังครบเวลาที่ตั้งไว้</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDraftAutoCloseReceiptEnabled((value) => !value)}
                    className={`relative h-8 w-14 shrink-0 rounded-full transition ${draftAutoCloseReceiptEnabled ? 'bg-primary-600' : 'bg-slate-300'}`}
                    aria-pressed={draftAutoCloseReceiptEnabled}
                  >
                    <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition ${draftAutoCloseReceiptEnabled ? 'left-7' : 'left-1'}`} />
                  </button>
                </div>
                <div className={`mt-4 grid gap-2 sm:grid-cols-[180px_1fr] sm:items-center ${draftAutoCloseReceiptEnabled ? '' : 'opacity-50'}`}>
                  <label className="text-sm font-bold text-slate-700">เวลาปิดบิลอัตโนมัติ</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={300}
                      className="w-32 rounded-md border-slate-300 font-black"
                      value={draftAutoCloseReceiptSeconds}
                      onChange={(event) => setDraftAutoCloseReceiptSeconds(event.target.value)}
                      disabled={!draftAutoCloseReceiptEnabled}
                    />
                    <span className="text-sm font-bold text-slate-500">วินาที</span>
                  </div>
                </div>
              </section>

              {hasSaleSettingsChange && <div className="rounded-md bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก</div>}
            </div>

            <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-black text-slate-800">ตัวอย่างกล่องสินค้า 1:1</h3>
                <select
                  className="max-w-44 rounded-md border-slate-300 bg-white py-1.5 text-xs font-bold text-slate-700"
                  value={previewProduct?.id ?? ''}
                  onChange={(event) => setPreviewProductId(event.target.value)}
                >
                  {(previewProducts ?? []).slice(0, 120).map((product) => (
                    <option key={product.id} value={product.id}>{product.name}</option>
                  ))}
                </select>
              </div>
              <div className="min-h-52 overflow-auto rounded-md bg-white p-4">
                <div className={`grid justify-start gap-3 ${productGridClasses[normalizedDraftProductSize]}`}>
                  {previewProduct && (
                    <ProductButton
                      product={previewProduct}
                      quantity={0}
                      onClick={() => undefined}
                      size={normalizedDraftProductSize}
                      displayFontSize={(draftDisplayFontSize === 'small' || draftDisplayFontSize === 'large' ? draftDisplayFontSize : 'medium') as ProductFontSize}
                      nameFontSize={(draftNameFontSize === 'small' || draftNameFontSize === 'large' ? draftNameFontSize : 'medium') as ProductFontSize}
                      priceFontSize={(draftPriceFontSize === 'small' || draftPriceFontSize === 'large' ? draftPriceFontSize : 'medium') as ProductFontSize}
                      displayFontPx={draftDisplayFontPx}
                      nameFontPx={draftNameFontPx}
                      priceFontPx={draftPriceFontPx}
                    />
                  )}
                </div>
              </div>
            </section>
          </div>
        </Card>
      )}
      {activeTab === 'printer' && (
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-base font-black text-slate-950">ตั้งค่าเครื่องพิมพ์</h2>
              <p className="mt-1 text-xs text-slate-500">ตั้งค่า LAN, USB และ Bluetooth พร้อมทดสอบพิมพ์ โดยใช้ข้อมูลใบเสร็จชุดเดียวกัน</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                className={`inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-black text-white shadow-sm ${hasPrinterSettingsChange ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-slate-400'}`}
                onClick={savePrinterSettings}
                disabled={!hasPrinterSettingsChange}
              >
                <Save size={16} /> บันทึกการตั้งค่า
              </button>
              <button
                type="button"
                className={`inline-flex items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-black shadow-sm ${draftPrinterSettings.enabled ? 'border-primary-200 bg-primary-50 text-primary-700 hover:bg-primary-100' : 'border-slate-200 bg-slate-100 text-slate-400'}`}
                onClick={() => void testPrinterPrint()}
                disabled={!draftPrinterSettings.enabled}
              >
                <Printer size={16} /> ทดสอบพิมพ์
              </button>
            </div>
          </div>

          <div className="border-b border-slate-200 bg-white p-3">
            <div className="inline-grid grid-cols-2 rounded-lg bg-slate-100 p-1">
              <button className={`rounded-md px-4 py-2 text-sm font-black ${activePrinterTab === 'connection' ? 'bg-primary-600 text-white' : 'text-slate-600'}`} onClick={() => changePrinterTab('connection')}>
                การตั้งค่าเครื่องพิมพ์
              </button>
              <button className={`rounded-md px-4 py-2 text-sm font-black ${activePrinterTab === 'receipt' ? 'bg-primary-600 text-white' : 'text-slate-600'}`} onClick={() => changePrinterTab('receipt')}>
                ตั้งค่าใบเสร็จ
              </button>
            </div>
          </div>

          {activePrinterTab === 'connection' && (
            <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="space-y-4">
                <section className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-sm font-black text-slate-900">เปิดใช้งานเครื่องพิมพ์</h3>
                      <p className="mt-1 text-xs font-medium text-slate-500">เมื่อปิดใช้งาน ระบบจะยังพิมพ์ผ่าน browser print ได้จากปุ่มเดิม แต่สถานะเครื่องพิมพ์จะแสดงว่าไม่ได้เชื่อมต่อ</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => updatePrinterDraft('enabled', !draftPrinterSettings.enabled)}
                      className={`relative h-8 w-14 shrink-0 rounded-full transition ${draftPrinterSettings.enabled ? 'bg-primary-600' : 'bg-slate-300'}`}
                    >
                      <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition ${draftPrinterSettings.enabled ? 'left-7' : 'left-1'}`} />
                    </button>
                  </div>
                </section>

                <fieldset disabled={printerControlsDisabled} className={`space-y-4 ${printerControlsDisabled ? 'pointer-events-none opacity-45 grayscale' : ''}`}>
                <section className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-2">
                  <label className="block text-sm font-bold text-slate-700">
                    ประเภทการเชื่อมต่อ
                    <select
                      className="mt-1 h-10 w-full rounded-md border-slate-300 py-1.5 text-sm"
                      value={draftPrinterSettings.connectionType}
                      onChange={(event) => selectConnectionType(event.target.value as PrinterSettings['connectionType'])}
                    >
                      <option value="lan">LAN / Network ESC/POS</option>
                      <option value="usb">USB ESC/POS</option>
                      <option value="bluetooth">Bluetooth ESC/POS</option>
                    </select>
                  </label>
                  <label className="block text-sm font-bold text-slate-700">
                    ชื่อเครื่องพิมพ์
                    <input className="mt-1 w-full rounded-md border-slate-300" value={draftPrinterSettings.printerName} onChange={(event) => updatePrinterDraft('printerName', event.target.value)} placeholder="เช่น Epson TM-T82, SUNMI Built-in" />
                  </label>
                  {draftPrinterSettings.connectionType === 'lan' && (
                    <>
                      <label className="block text-sm font-bold text-slate-700">
                        IP Address สำหรับ LAN
                        <input className="mt-1 w-full rounded-md border-slate-300" value={draftPrinterSettings.ipAddress} onChange={(event) => updatePrinterDraft('ipAddress', event.target.value)} placeholder="192.168.1.50" />
                      </label>
                      <label className="block text-sm font-bold text-slate-700">
                        Port
                        <input className="mt-1 w-full rounded-md border-slate-300" value={draftPrinterSettings.port} onChange={(event) => updatePrinterDraft('port', event.target.value)} placeholder="9100" />
                      </label>
                    </>
                  )}
                  {draftPrinterSettings.connectionType === 'usb' && (
                    <>
                      <label className="block text-sm font-bold text-slate-700">
                        USB Vendor ID
                        <input className="mt-1 w-full rounded-md border-slate-300" value={draftPrinterSettings.usbVendorId} onChange={(event) => updatePrinterDraft('usbVendorId', event.target.value)} placeholder="กดสแกนเพื่อเลือกอุปกรณ์" />
                      </label>
                      <label className="block text-sm font-bold text-slate-700">
                        USB Product ID
                        <input className="mt-1 w-full rounded-md border-slate-300" value={draftPrinterSettings.usbProductId} onChange={(event) => updatePrinterDraft('usbProductId', event.target.value)} placeholder="กดสแกนเพื่อเลือกอุปกรณ์" />
                      </label>
                    </>
                  )}
                  {draftPrinterSettings.connectionType === 'bluetooth' && (
                    <label className="block text-sm font-bold text-slate-700 md:col-span-2">
                      Bluetooth Device ID / Name
                      <input className="mt-1 w-full rounded-md border-slate-300" value={draftPrinterSettings.bluetoothAddress} onChange={(event) => updatePrinterDraft('bluetoothAddress', event.target.value)} placeholder="กดสแกนเพื่อเลือกอุปกรณ์" />
                    </label>
                  )}
                </section>

                <section className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h3 className="text-sm font-black text-slate-900">ค้นหาเครื่องพิมพ์</h3>
                      <p className="mt-1 text-xs font-medium text-slate-500">
                        {draftPrinterSettings.connectionType === 'lan' ? 'เครื่องพิมพ์ LAN ต้องกรอก IP/Port เอง Browser ไม่อนุญาตให้สแกน network ตรง ๆ' : 'กดสแกนเพื่อให้ Browser แสดงรายการอุปกรณ์ที่เชื่อมต่อหรือจับคู่ได้'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={scanPrinterDevicesForCurrentPlatform}
                      disabled={printerControlsDisabled || isScanningPrinter}
                      className={`rounded-md px-4 py-2 text-sm font-black text-white shadow-sm ${printerControlsDisabled || isScanningPrinter ? 'bg-slate-400' : 'bg-primary-600 hover:bg-primary-700'}`}
                    >
                      สแกนเครื่องพิมพ์
                    </button>
                  </div>
                  {printerScanMessage && (
                    <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold leading-5 text-amber-800">
                      {printerScanMessage}
                    </div>
                  )}
                  {detectedPrinterDevices.length > 0 && (
                    <div className="mt-4 space-y-2">
                      {detectedPrinterDevices.map((device) => (
                        <button
                          type="button"
                          key={device.id}
                          className="flex w-full items-center justify-between rounded-md border border-primary-200 bg-primary-50 px-3 py-2 text-left"
                          onClick={() => void selectPrinterDevice(device)}
                        >
                          <span>
                            <span className="block font-black text-slate-900">{device.name}</span>
                            <span className="text-xs font-bold text-slate-500">{device.meta}{device.hasPermission ? ' / อนุญาตแล้ว' : ''}</span>
                          </span>
                          <span className="text-sm font-black text-primary-700">เลือก</span>
                        </button>
                      ))}
                    </div>
                  )}
                </section>

                <section className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-sm font-black text-slate-900">ลิ้นชักเก็บเงิน</h3>
                      <p className="mt-1 text-xs font-medium text-slate-500">สั่งเปิดผ่านช่อง drawer kick ของเครื่องพิมพ์ใบเสร็จ โดยบันทึกจำนวนเงินและหมายเหตุทุกครั้งที่กดเปิด</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={testCashDrawer}
                        disabled={!draftPrinterSettings.drawerEnabled}
                        className={`rounded-md px-3 py-2 text-sm font-black ${draftPrinterSettings.drawerEnabled ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-slate-200 text-slate-400'}`}
                      >
                        ทดสอบเปิด
                      </button>
                      <button
                        type="button"
                        onClick={() => updatePrinterDraft('drawerEnabled', !draftPrinterSettings.drawerEnabled)}
                        className={`relative h-8 w-14 shrink-0 rounded-full transition ${draftPrinterSettings.drawerEnabled ? 'bg-primary-600' : 'bg-slate-300'}`}
                      >
                        <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition ${draftPrinterSettings.drawerEnabled ? 'left-7' : 'left-1'}`} />
                      </button>
                    </div>
                  </div>
                  <div className={`mt-4 grid gap-3 md:grid-cols-4 ${draftPrinterSettings.drawerEnabled ? '' : 'opacity-50'}`}>
                    <label className="block text-sm font-bold text-slate-700">
                      Pin
                      <select disabled={!draftPrinterSettings.drawerEnabled} className="mt-1 w-full rounded-md border-slate-300" value={draftPrinterSettings.drawerKickPin} onChange={(event) => updatePrinterDraft('drawerKickPin', event.target.value as '2' | '5')}>
                        <option value="2">Pin 2</option>
                        <option value="5">Pin 5</option>
                      </select>
                    </label>
                    <label className="block text-sm font-bold text-slate-700">
                      Pulse ON ms
                      <input disabled={!draftPrinterSettings.drawerEnabled} className="mt-1 w-full rounded-md border-slate-300" value={draftPrinterSettings.drawerPulseOnMs} onChange={(event) => updatePrinterDraft('drawerPulseOnMs', event.target.value)} />
                    </label>
                    <label className="block text-sm font-bold text-slate-700">
                      Pulse OFF ms
                      <input disabled={!draftPrinterSettings.drawerEnabled} className="mt-1 w-full rounded-md border-slate-300" value={draftPrinterSettings.drawerPulseOffMs} onChange={(event) => updatePrinterDraft('drawerPulseOffMs', event.target.value)} />
                    </label>
                    <label className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700">
                      <input type="checkbox" checked={draftPrinterSettings.openDrawerAfterCashPayment} disabled={!draftPrinterSettings.drawerEnabled} onChange={(event) => updatePrinterDraft('openDrawerAfterCashPayment', event.target.checked)} />
                      เปิดหลังรับเงินสด
                    </label>
                  </div>
                </section>
                </fieldset>
              </div>

              <aside className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <h3 className="text-sm font-black text-slate-900">สถานะและแนวทางเชื่อมต่อ</h3>
                <div className={`mt-3 rounded-md p-3 text-sm font-black ${printerLiveStatus === 'connected' ? 'bg-emerald-50 text-emerald-700' : printerLiveStatus === 'not_configured' ? 'bg-slate-100 text-slate-500' : 'bg-red-50 text-red-700'}`}>
                  {printerLiveStatus === 'connected' ? 'เชื่อมต่อแล้ว' : printerLiveStatus === 'not_configured' ? 'ยังไม่ได้เปิดใช้งาน' : 'ไม่ได้เชื่อมต่อ'}
                </div>
                {hasPrinterSettingsChange && (
                  <p className="mt-2 text-xs font-bold text-amber-700">มีการตั้งค่าที่ยังไม่ได้บันทึก สถานะแสดงตามค่าที่บันทึกล่าสุด</p>
                )}
                <div className="mt-4 space-y-3 text-xs font-medium leading-6 text-slate-600">
                  <p><b>LAN:</b> ใส่ IP/Port ของเครื่องพิมพ์ ปกติ ESC/POS ใช้ RAW port 9100</p>
                  <p><b>USB:</b> WebUSB แสดง device picker ได้บน Chrome/Edge แต่ต้องกดยืนยันจากผู้ใช้</p>
                  <p><b>Bluetooth:</b> Web Bluetooth รองรับอุปกรณ์ BLE เป็นหลัก เครื่องพิมพ์ Bluetooth Classic บางรุ่นอาจไม่ขึ้นใน browser</p>
                  <p><b>ตัดกระดาษ:</b> ใช้คำสั่ง ESC/POS เฉพาะเครื่องที่มี autocutter</p>
                  <p><b>เปิดลิ้นชัก:</b> ใช้ pulse ที่ drawer kick connector ของเครื่องพิมพ์ ไม่ใช่เปิดจากลิ้นชักโดยตรง</p>
                </div>
              </aside>
            </div>
          )}


          {activePrinterTab === 'receipt' && (
            <div className="grid h-[calc(100dvh-220px)] min-h-[560px] gap-4 overflow-hidden p-4 lg:grid-cols-[minmax(0,1fr)_430px]">
              <div className="min-h-0 space-y-3 overflow-y-auto pr-1">
                <section className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <h3 className="text-sm font-black text-slate-800">ข้อมูลร้าน</h3>
                    <p className="mt-0.5 text-xs font-medium text-slate-500">แสดงในส่วนหัวของใบเสร็จ</p>
                  </div>
                  <label className="block text-sm font-bold text-slate-700">
                    ชื่อร้าน
                    {settings !== null && (
                      <input
                        className="mt-1 w-full rounded-md border-slate-300"
                        defaultValue={settings.find((s) => s.key === 'storeName')?.value ?? 'Cal POS Store'}
                        onBlur={(event) => save('storeName', event.target.value)}
                      />
                    )}
                  </label>
                  <label className="block text-sm font-bold text-slate-700">
                    ชื่อสาขา
                    {settings !== null && (
                      <input
                        className="mt-1 w-full rounded-md border-slate-300"
                        defaultValue={settings.find((s) => s.key === 'branchName')?.value ?? 'สาขาหลัก'}
                        onBlur={(event) => save('branchName', event.target.value)}
                      />
                    )}
                  </label>
                  <label className="block text-sm font-bold text-slate-700 sm:col-span-2">
                    เลขประจำตัวผู้เสียภาษี
                    <span className="ml-1 text-xs font-medium text-slate-400">(ไม่บังคับ)</span>
                    {settings !== null && (
                      <input
                        className="mt-1 w-full rounded-md border-slate-300"
                        defaultValue={settings.find((s) => s.key === 'taxId')?.value ?? ''}
                        placeholder="เช่น 0-1234-56789-12-3"
                        onBlur={(event) => save('taxId', event.target.value)}
                      />
                    )}
                  </label>
                </section>

                <section className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <h3 className="text-sm font-black text-slate-800">การแสดงผลใบเสร็จ</h3>
                    <p className="mt-0.5 text-xs font-medium text-slate-500">สัญลักษณ์เงิน ข้อความท้ายบิล และรูปแบบการนับเลขบิล</p>
                  </div>
                  <label className="block text-sm font-bold text-slate-700">
                    สัญลักษณ์สกุลเงิน
                    {settings !== null && (
                      <input
                        className="mt-1 w-full rounded-md border-slate-300"
                        defaultValue={settings.find((s) => s.key === 'currencySymbol')?.value ?? '฿'}
                        onBlur={(event) => save('currencySymbol', event.target.value)}
                      />
                    )}
                  </label>
                  <label className="block text-sm font-bold text-slate-700">
                    รูปแบบเลขบิล
                    <select
                      className="mt-1 h-10 w-full rounded-md border-slate-300 py-1.5 text-sm"
                      value={billResetRule}
                      onChange={(event) => void save('billNumberResetRule', event.target.value)}
                    >
                      <option value="daily">รีเซ็ตทุกวัน</option>
                      <option value="continuous">นับต่อเนื่อง</option>
                    </select>
                  </label>
                  <label className="block text-sm font-bold text-slate-700">
                    รหัสเครื่อง (ขึ้นต้นเลขบิล)
                    <input
                      className="mt-1 w-full rounded-md border-slate-300 uppercase tracking-widest"
                      defaultValue={getDeviceCode()}
                      maxLength={DEVICE_CODE_MAX_LEN}
                      placeholder="เช่น POS1"
                      onBlur={(event) => {
                        const saved = setDeviceCode(event.target.value);
                        event.target.value = saved;
                        toast(`ตั้งรหัสเครื่องเป็น "${saved}" — บิลถัดไปจะขึ้นต้นด้วย ${saved}-`, 'success');
                      }}
                    />
                    <span className="mt-1 block text-xs font-medium text-slate-500">
                      ใช้แยกว่าบิลออกจากเครื่องไหน เครื่องละรหัสไม่ซ้ำกัน (A–Z, 0–9)
                    </span>
                  </label>
                  <label className="block text-sm font-bold text-slate-700 sm:col-span-2">
                    ข้อความท้ายใบเสร็จ
                    {settings !== null && (
                      <input
                        className="mt-1 w-full rounded-md border-slate-300"
                        defaultValue={settings.find((s) => s.key === 'receiptFooter')?.value ?? 'ขอบคุณที่ใช้บริการ'}
                        onBlur={(event) => save('receiptFooter', event.target.value)}
                      />
                    )}
                  </label>
                </section>

                <fieldset disabled={printerControlsDisabled} className={`space-y-3 ${printerControlsDisabled ? 'pointer-events-none opacity-45 grayscale' : ''}`}>
                <section className="grid gap-2 rounded-lg border border-slate-200 bg-white p-3 md:grid-cols-2 xl:grid-cols-4">
                  <label className="block text-sm font-bold text-slate-700">
                    ขนาดกระดาษ
                    <select
                      className="mt-1 h-10 w-full rounded-md border-slate-300 py-1.5 text-sm"
                      value={draftPrinterSettings.paperSize}
                      onChange={(event) => updatePrinterDraft('paperSize', event.target.value as PrinterSettings['paperSize'])}
                    >
                      <option value="58mm">Thermal 58mm</option>
                      <option value="80mm">Thermal 80mm</option>
                    </select>
                  </label>
                  <label className="block text-sm font-bold text-slate-700">
                    ความกว้างพิมพ์จริง (dots)
                    <input
                      type="number"
                      min={activeReceiptPaperSize === '58mm' ? 320 : 480}
                      max={activeReceiptPaperSize === '58mm' ? 420 : 576}
                      className="mt-1 h-10 w-full rounded-md border-slate-300 py-1.5 text-sm"
                      value={activeReceiptWidthDots}
                      onChange={(event) => updateActiveReceiptDraft('widthKey', event.target.value)}
                    />
                  </label>
                  <label className="block text-sm font-bold text-slate-700">
                    ตัวอักษรต่อบรรทัด
                    <input
                      type="number"
                      min={activeReceiptPaperSize === '58mm' ? 28 : 36}
                      max={activeReceiptPaperSize === '58mm' ? 36 : 46}
                      className="mt-1 h-10 w-full rounded-md border-slate-300 py-1.5 text-sm"
                      value={activeReceiptCharsPerLine}
                      onChange={(event) => updateActiveReceiptDraft('charsKey', event.target.value)}
                    />
                  </label>
                  <label className="block text-sm font-bold text-slate-700">
                    ขนาดตัวอักษรพิมพ์จริง (px)
                    <input
                      type="number"
                      min={18}
                      max={42}
                      className="mt-1 w-full rounded-md border-slate-300"
                      value={activeReceiptFontSizePx}
                      onChange={(event) => updateActiveReceiptDraft('fontKey', event.target.value)}
                    />
                  </label>
                  <label className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700">
                    <input type="checkbox" checked={draftPrinterSettings.autoPrintReceipt} onChange={(event) => updatePrinterDraft('autoPrintReceipt', event.target.checked)} />
                    พิมพ์ใบเสร็จอัตโนมัติหลังปิดบิล
                  </label>
                  <label className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700">
                    <input type="checkbox" checked={draftPrinterSettings.autoCut} onChange={(event) => updatePrinterDraft('autoCut', event.target.checked)} />
                    ตัดกระดาษอัตโนมัติ
                  </label>
                  <label className="block text-sm font-bold text-slate-700">
                    รูปแบบการตัด
                    <select disabled={!draftPrinterSettings.autoCut} className="mt-1 h-10 w-full rounded-md border-slate-300 py-1.5 text-sm" value={draftPrinterSettings.cutMode} onChange={(event) => updatePrinterDraft('cutMode', event.target.value as PrinterSettings['cutMode'])}>
                      <option value="partial">Partial cut</option>
                      <option value="full">Full cut</option>
                    </select>
                  </label>
                  <div className="flex items-end">
                    <button
                      type="button"
                      className="w-full rounded-md bg-slate-100 px-4 py-2 text-sm font-black text-slate-700 hover:bg-slate-200"
                      onClick={resetActiveReceiptDefaults}
                    >
                      รีเซ็ตค่า {activeReceiptPaperConfig.label}
                    </button>
                  </div>
                </section>

                <section className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <h3 className="text-sm font-black text-slate-900">Calibrate ขอบกระดาษจริง</h3>
                      <p className="mt-1 text-xs font-bold leading-5 text-slate-500">
                        พิมพ์ ruler เพื่อตรวจ dots หรือพิมพ์ใบเสร็จตัวอย่างเพื่อเทียบกับภาพในจอ 1:1
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                      <button type="button" className="rounded-md border border-primary-300 bg-white px-4 py-2 text-sm font-black text-primary-700 hover:bg-primary-50" onClick={testReceiptCalibration}>
                        พิมพ์ ruler calibrate
                      </button>
                      <button type="button" className="rounded-md bg-primary-600 px-4 py-2 text-sm font-black text-white hover:bg-primary-700" onClick={() => void printReceiptPreview()}>
                        พิมพ์ใบเสร็จตัวอย่าง
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                    <p className="mb-2 text-xs font-black text-slate-700">
                      ผลที่เห็นจากใบที่พิมพ์ออกมา
                      <span className="ml-1 font-medium text-slate-400">(ruler {calibRulerWidth} ตัวอักษร)</span>
                    </p>
                    <div className="space-y-1">
                      {(
                        [
                          { value: 'cut', label: 'ruler ถูกตัดขอบขวา — มีตัวเลขหาย' },
                          { value: 'ok', label: 'ruler พอดีกับขอบกระดาษ ✓' },
                          { value: 'space', label: 'ruler จบก่อนถึงขอบ — มีพื้นที่ว่างทางขวา' },
                        ] as const
                      ).map((option) => (
                        <label key={option.value} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-slate-50">
                          <input
                            type="radio"
                            name="calibResult"
                            value={option.value}
                            checked={calibResult === option.value}
                            onChange={() => { setCalibResult(option.value); setCalibLastVisible(''); }}
                            className="text-primary-600"
                          />
                          <span className="text-xs font-bold text-slate-700">{option.label}</span>
                        </label>
                      ))}
                    </div>

                    {calibResult === 'cut' && (
                      <div className="mt-3 rounded-md border border-red-100 bg-red-50 p-3">
                        <label className="block text-xs font-black text-red-800">
                          ตัวอักษรสุดท้ายที่มองเห็นก่อนถูกตัด
                          <div className="mt-1.5 flex items-center gap-2">
                            <input
                              type="number"
                              min={1}
                              max={calibRulerWidth - 1}
                              value={calibLastVisible}
                              onChange={(event) => setCalibLastVisible(event.target.value)}
                              placeholder="เช่น 35"
                              className="w-24 rounded-md border-red-200 bg-white text-center text-sm font-black focus:ring-red-400"
                            />
                            <span className="text-xs font-bold text-red-700">จาก {calibRulerWidth} ตัวอักษร</span>
                          </div>
                        </label>

                        {calibLastVisible && Number(calibLastVisible) >= Number(activeReceiptCharsPerLine) && (
                          <p className="mt-2 text-xs font-bold text-amber-700">
                            ค่าที่ป้อนต้องน้อยกว่า {activeReceiptCharsPerLine} ถ้า ruler ถูกตัดจริง
                          </p>
                        )}

                        {calibSuggestion?.status === 'cut' && (
                          <div className="mt-3 space-y-2">
                            <p className="text-xs font-black text-red-800">ผลการคำนวณที่แนะนำ:</p>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div className="rounded-md bg-white p-2 text-center">
                                <div className="font-bold text-slate-400">ค่าปัจจุบัน</div>
                                <div className="mt-0.5 font-black text-slate-700">{activeReceiptWidthDots} dots</div>
                                <div className="font-black text-slate-700">{activeReceiptCharsPerLine} ตัว/บรรทัด</div>
                              </div>
                              <div className="rounded-md bg-emerald-50 p-2 text-center">
                                <div className="font-bold text-emerald-600">แนะนำ</div>
                                <div className="mt-0.5 font-black text-emerald-800">{calibSuggestion.newDots} dots</div>
                                <div className="font-black text-emerald-800">{calibSuggestion.newChars} ตัว/บรรทัด</div>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={applyCalibSuggestion}
                              className="w-full rounded-md bg-emerald-600 py-2 text-sm font-black text-white hover:bg-emerald-700"
                            >
                              นำค่านี้ไปใช้ (ยังต้องกดบันทึก)
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {calibResult === 'ok' && (
                      <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs font-bold text-emerald-800">
                        ค่าตั้งค่าปัจจุบัน ({activeReceiptWidthDots} dots / {activeReceiptCharsPerLine} ตัว/บรรทัด) ตรงกับใบเสร็จที่พิมพ์จริงแล้ว
                      </div>
                    )}

                    {calibResult === 'space' && (
                      <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs font-bold leading-5 text-amber-800">
                        ลองเพิ่ม dots ขึ้นครั้งละ 8–16 และ/หรือเพิ่มตัวอักษรต่อบรรทัด แล้วพิมพ์ calibrate ใหม่จนพอดี
                      </div>
                    )}
                  </div>
                </section>

                </fieldset>
              </div>

              <section className="sticky top-0 h-full overflow-hidden rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-black text-slate-900">ตัวอย่างใบเสร็จ 1:1</h3>
                    <p className="text-xs font-bold text-slate-500">{activeReceiptPaperConfig.label} / {activeReceiptCharsPerLine} ตัวอักษรต่อบรรทัด</p>
                  </div>
                </div>
                <div className="h-[calc(100%-3.75rem)] overflow-auto rounded-lg bg-slate-200 p-4">
                  <ReceiptCanvasPreview
                    text={receiptPreviewText}
                    config={receiptRenderConfig}
                    scale={0.5}
                  />
                </div>
              </section>
            </div>
          )}
        </Card>
      )}
      {activeTab === 'payment' && (
        <div className="max-w-2xl">
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-4">
              <div>
                <h2 className="font-black text-slate-900">ช่องทางการชำระเงิน</h2>
                <p className="mt-0.5 text-xs font-medium text-slate-500">เปิด/ปิดช่องทางที่ต้องการให้แสดงในหน้ารับเงิน</p>
              </div>
              <button
                onClick={savePaymentSettings}
                disabled={!isPaymentDirty}
                className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-black text-white ${isPaymentDirty ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-slate-300'}`}
              >
                <Save size={16} /> บันทึก
              </button>
            </div>
            <div className="divide-y divide-slate-100">
              {ALL_PAYMENT_METHODS.map((method) => (
                <div key={method.id} className="flex items-center justify-between px-5 py-4">
                  <div>
                    <div className="font-black text-slate-900">{method.label}</div>
                    <div className="text-xs font-medium text-slate-500">{method.description}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => togglePayment(method.id)}
                    className={`relative h-8 w-14 shrink-0 rounded-full transition ${enabledPayments.has(method.id) ? 'bg-primary-600' : 'bg-slate-300'}`}
                    aria-pressed={enabledPayments.has(method.id)}
                  >
                    <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${enabledPayments.has(method.id) ? 'left-7' : 'left-1'}`} />
                  </button>
                </div>
              ))}
            </div>
            {isPaymentDirty && (
              <div className="border-t border-amber-200 bg-amber-50 px-5 py-3 text-xs font-bold text-amber-700">
                มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก
              </div>
            )}
          </Card>
        </div>
      )}

      {activeTab === 'login' && (
        <div className="max-w-2xl">
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-4">
              <div>
                <h2 className="font-black text-slate-900">การลงชื่อเข้าใช้</h2>
                <p className="mt-0.5 text-xs font-medium text-slate-500">กำหนดจำนวนครั้งที่ใส่รหัสผิดก่อนระบบบล็อกการใช้งาน</p>
              </div>
              <button
                onClick={saveLoginSecuritySettings}
                disabled={!isLoginSecurityDirty}
                className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-black text-white ${isLoginSecurityDirty ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-slate-300'}`}
              >
                <Save size={16} /> บันทึก
              </button>
            </div>
            <div className="space-y-4 p-5">
              <label className="block rounded-lg border border-slate-200 p-4">
                <span className="text-sm font-black text-slate-800">จำนวนครั้งที่ใส่ชื่อผู้ใช้/รหัสผ่านผิด</span>
                <span className="mt-1 block text-xs font-medium text-slate-500">ผิดครบจำนวนนี้ บัญชีผู้ใช้จะถูกบล็อกและต้องปลดล็อกจากหน้าผู้ใช้</span>
                <input
                  type="number"
                  min={1}
                  className="mt-3 w-full rounded-md border-slate-300 text-lg font-black"
                  value={draftPasswordMaxAttempts}
                  onChange={(event) => setDraftPasswordMaxAttempts(event.target.value)}
                />
              </label>
              <label className="block rounded-lg border border-slate-200 p-4">
                <span className="text-sm font-black text-slate-800">จำนวนครั้งที่ใส่ PIN ผิด</span>
                <span className="mt-1 block text-xs font-medium text-slate-500">ผิดครบจำนวนนี้ ระบบจะบล็อก PIN และให้เข้าใช้งานด้วยชื่อผู้ใช้/รหัสผ่านเท่านั้น</span>
                <input
                  type="number"
                  min={1}
                  className="mt-3 w-full rounded-md border-slate-300 text-lg font-black"
                  value={draftPinMaxAttempts}
                  onChange={(event) => setDraftPinMaxAttempts(event.target.value)}
                />
              </label>
              {isLoginSecurityDirty && (
                <div className="rounded-md bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก</div>
              )}
            </div>
          </Card>
        </div>
      )}

      {activeTab === 'general' && (
        <div className="max-w-2xl space-y-4">
          <Card className="overflow-hidden">
            <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
              <h2 className="font-black text-slate-900">การอนุมัติส่วนลด</h2>
              <p className="mt-0.5 text-xs font-medium text-slate-500">กำหนดว่าการใส่ส่วนลดในหน้าขายต้องใช้ PIN ของตำแหน่งที่ได้รับสิทธิ์หรือไม่</p>
            </div>
            <div className="space-y-4 p-5">
              <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 p-4">
                <div>
                  <h3 className="text-sm font-black text-slate-800">การใส่ส่วนลดต้องได้รับอนุญาติ</h3>
                  <p className="mt-1 text-xs font-medium text-slate-500">เมื่อเปิดใช้งาน ต้องใส่ PIN ผู้ที่มีสิทธิ์ “ใส่ PIN ส่วนลดรายการ/ท้ายบิล” ทุกครั้งที่บันทึกส่วนลด</p>
                </div>
                <button
                  type="button"
                  onClick={toggleDiscountApprovalRequired}
                  disabled={isSavingDiscountApproval}
                  className={`relative h-8 w-14 shrink-0 rounded-full transition ${discountApprovalRequired ? 'bg-primary-600' : 'bg-slate-300'} disabled:opacity-60`}
                  aria-pressed={discountApprovalRequired}
                >
                  <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${discountApprovalRequired ? 'left-7' : 'left-1'}`} />
                </button>
              </div>

              <div className="rounded-lg border border-slate-200 p-4">
                <h3 className="text-sm font-black text-slate-800">ตำแหน่งที่อนุมัติส่วนลดได้</h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  {discountApproverPositions.length > 0 ? (
                    discountApproverPositions.map((position) => (
                      <span key={position.name} className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">
                        {position.name}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm font-bold text-slate-400">ยังไม่มีตำแหน่งที่ได้รับสิทธิ์ใส่ PIN ส่วนลดรายการ/ท้ายบิล</span>
                  )}
                </div>
              </div>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
              <h2 className="font-black text-slate-900">รายการสินค้าและหมวดหมู่</h2>
              <p className="mt-0.5 text-xs font-medium text-slate-500">จัดการข้อมูลเริ่มต้นของสินค้าและหมวดหมู่</p>
            </div>
            <div className="p-5">
              <div className="rounded-lg border border-slate-200 p-4">
                <h3 className="mb-1 text-sm font-black text-slate-800">Reset ค่าเริ่มต้นรายการสินค้าและหมวดหมู่</h3>
                <p className="mb-4 text-xs font-medium text-slate-500">
                  รีเซ็ตรายการสินค้าและหมวดหมู่ทั้งหมดกลับเป็นค่าเริ่มต้นที่บันทึกไว้ รายการที่เพิ่ม/แก้ไขภายหลังจะถูกแทนที่
                </p>
                <button
                  type="button"
                  onClick={() => setShowResetCatalogConfirm(true)}
                  disabled={!can('products')}
                  className="inline-flex items-center gap-2 rounded-md bg-slate-800 px-4 py-2 font-black text-white hover:bg-slate-900 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  <RotateCcw size={17} /> Reset ค่าเริ่มต้น
                </button>
                {!can('products') && (
                  <p className="mt-2 text-xs font-bold text-amber-700">ไม่มีสิทธิ์จัดการสินค้า/หมวดหมู่</p>
                )}
              </div>
            </div>
          </Card>
        </div>
      )}

      {showResetCatalogConfirm && (
        <Modal title="Reset ค่าเริ่มต้นรายการสินค้าและหมวดหมู่" onClose={() => setShowResetCatalogConfirm(false)}>
          <div className="space-y-4">
            <p className="text-sm font-medium leading-6 text-slate-700">
              ต้องการ reset รายการสินค้าและหมวดหมู่ทั้งหมดกลับเป็นค่าเริ่มต้นที่บันทึกไว้หรือไม่?<br />
              <span className="font-bold text-red-600">รายการปัจจุบันที่เพิ่ม/แก้ไขภายหลังจะถูกแทนที่</span>
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button className="rounded-md bg-slate-100 py-2.5 font-bold text-slate-700 hover:bg-slate-200" onClick={() => setShowResetCatalogConfirm(false)} disabled={isResettingCatalog}>ยกเลิก</button>
              <button className="rounded-md bg-slate-800 py-2.5 font-black text-white hover:bg-slate-900 disabled:opacity-60" onClick={handleResetCatalog} disabled={isResettingCatalog}>
                {isResettingCatalog ? 'กำลัง Reset...' : 'Reset ค่าเริ่มต้น'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {confirmDialog && (
        <Modal title={confirmDialog.title} onClose={closeConfirmDialog}>
          <div className="space-y-5">
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-bold leading-6 text-amber-900">{confirmDialog.message}</p>
              <p className="mt-2 text-xs font-medium text-amber-700">หากละทิ้ง ค่าในหน้านี้จะย้อนกลับไปเป็นค่าที่บันทึกล่าสุด</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <button className="rounded-md bg-slate-100 py-3 font-bold text-slate-700 hover:bg-slate-200" onClick={closeConfirmDialog}>
                กลับไปแก้ไขต่อ
              </button>
              <button className="rounded-md bg-red-600 py-3 font-black text-white hover:bg-red-700" onClick={confirmDialog.onConfirm}>
                {confirmDialog.confirmText}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
