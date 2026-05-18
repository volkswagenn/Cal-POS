import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { Card } from '../components/common/Card';
import { SettingsRepository } from '../db/repositories/SettingsRepository';
import { useAsync } from '../hooks/useAsync';
import { useToast } from '../components/common/Toast';

export type PaymentMethodId = 'cash' | 'transfer' | 'qr' | 'credit' | 'mixed';

export const PAYMENT_METHODS_SETTING_KEY = 'enabledPaymentMethods';

export const ALL_PAYMENT_METHODS: Array<{ id: PaymentMethodId; label: string; description: string }> = [
  { id: 'cash', label: 'เงินสด', description: 'รับชำระด้วยเงินสด คำนวณเงินทอนอัตโนมัติ' },
  { id: 'transfer', label: 'โอนเงิน', description: 'รับชำระผ่านการโอนเงินธนาคาร' },
  { id: 'qr', label: 'QR Code', description: 'รับชำระผ่าน QR Payment' },
  { id: 'credit', label: 'บัตรเครดิต', description: 'รับชำระด้วยบัตรเครดิต/เดบิต' },
  { id: 'mixed', label: 'หลายช่องทาง', description: 'รับชำระผสมได้สูงสุด 2 ช่องทาง' },
];

export function parseEnabledPaymentMethods(value: string | null | undefined): PaymentMethodId[] {
  try {
    const parsed = value ? JSON.parse(value) : null;
    if (Array.isArray(parsed)) {
      const valid = parsed.filter((id): id is PaymentMethodId =>
        ALL_PAYMENT_METHODS.some((m) => m.id === id)
      );
      if (valid.length > 0) return valid;
    }
  } catch { /* ignore */ }
  return ALL_PAYMENT_METHODS.map((m) => m.id);
}

export function PaymentSettingsPage() {
  const { data: savedSetting, reload } = useAsync(() => SettingsRepository.getSetting(PAYMENT_METHODS_SETTING_KEY), []);
  const [enabled, setEnabled] = useState<Set<PaymentMethodId>>(new Set(ALL_PAYMENT_METHODS.map((m) => m.id)));
  const [isDirty, setIsDirty] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (savedSetting !== null) {
      setEnabled(new Set(parseEnabledPaymentMethods(savedSetting)));
      setIsDirty(false);
    }
  }, [savedSetting]);

  const toggle = (id: PaymentMethodId) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        if (next.size <= 1) { toast('ต้องเปิดอย่างน้อย 1 ช่องทางชำระเงิน', 'error'); return prev; }
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    setIsDirty(true);
  };

  const save = async () => {
    const value = JSON.stringify(ALL_PAYMENT_METHODS.map((m) => m.id).filter((id) => enabled.has(id)));
    await SettingsRepository.setSetting(PAYMENT_METHODS_SETTING_KEY, value);
    toast('บันทึกการตั้งค่าการชำระเงินแล้ว', 'success');
    reload();
    setIsDirty(false);
  };

  return (
    <div className="p-4 md:p-6">
      <PageHeader title="การชำระเงิน" subtitle="เลือกช่องทางการชำระเงินที่ต้องการแสดงในหน้ารับชำระ" />

      <div className="max-w-2xl">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-4">
            <div>
              <h2 className="font-black text-slate-900">ช่องทางการชำระเงิน</h2>
              <p className="mt-0.5 text-xs font-medium text-slate-500">เปิด/ปิดช่องทางที่ต้องการให้แสดงในหน้ารับเงิน</p>
            </div>
            <button
              onClick={save}
              disabled={!isDirty}
              className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-black text-white ${isDirty ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-slate-300'}`}
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
                  onClick={() => toggle(method.id)}
                  className={`relative h-8 w-14 shrink-0 rounded-full transition ${enabled.has(method.id) ? 'bg-primary-600' : 'bg-slate-300'}`}
                  aria-pressed={enabled.has(method.id)}
                >
                  <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${enabled.has(method.id) ? 'left-7' : 'left-1'}`} />
                </button>
              </div>
            ))}
          </div>

          {isDirty && (
            <div className="border-t border-amber-200 bg-amber-50 px-5 py-3 text-xs font-bold text-amber-700">
              มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
