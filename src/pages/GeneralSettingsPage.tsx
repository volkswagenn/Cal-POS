import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { Card } from '../components/common/Card';
import { Modal } from '../components/common/Modal';
import { CatalogDefaultRepository } from '../db/repositories/CatalogDefaultRepository';
import { useToast } from '../components/common/Toast';
import { usePermissions } from '../hooks/usePermissions';

export function GeneralSettingsPage() {
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const toast = useToast();
  const { can } = usePermissions();
  const canManageCatalog = can('products');

  const handleReset = async () => {
    setIsResetting(true);
    try {
      await CatalogDefaultRepository.resetToDefaultCatalog();
      toast('Reset รายการสินค้าและหมวดหมู่เป็นค่าเริ่มต้นแล้ว', 'success');
      setShowResetConfirm(false);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Reset ไม่สำเร็จ', 'error');
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="p-4 md:p-6">
      <PageHeader title="ตั้งค่าทั่วไป" subtitle="จัดการข้อมูลเริ่มต้นของระบบ" />

      <div className="max-w-2xl space-y-4">
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
                onClick={() => setShowResetConfirm(true)}
                disabled={!canManageCatalog}
                className="inline-flex items-center gap-2 rounded-md bg-slate-800 px-4 py-2 font-black text-white hover:bg-slate-900 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                <RotateCcw size={17} /> Reset ค่าเริ่มต้น
              </button>
              {!canManageCatalog && (
                <p className="mt-2 text-xs font-bold text-amber-700">ไม่มีสิทธิ์จัดการสินค้า/หมวดหมู่</p>
              )}
            </div>
          </div>
        </Card>
      </div>

      {showResetConfirm && (
        <Modal title="Reset ค่าเริ่มต้นรายการสินค้าและหมวดหมู่" onClose={() => setShowResetConfirm(false)}>
          <div className="space-y-4">
            <p className="text-sm font-medium leading-6 text-slate-700">
              ต้องการ reset รายการสินค้าและหมวดหมู่ทั้งหมดกลับเป็นค่าเริ่มต้นที่บันทึกไว้หรือไม่?<br />
              <span className="font-bold text-red-600">รายการปัจจุบันที่เพิ่ม/แก้ไขภายหลังจะถูกแทนที่</span>
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button
                className="rounded-md bg-slate-100 py-2.5 font-bold text-slate-700 hover:bg-slate-200"
                onClick={() => setShowResetConfirm(false)}
                disabled={isResetting}
              >
                ยกเลิก
              </button>
              <button
                className="rounded-md bg-slate-800 py-2.5 font-black text-white hover:bg-slate-900 disabled:opacity-60"
                onClick={handleReset}
                disabled={isResetting}
              >
                {isResetting ? 'กำลัง Reset...' : 'Reset ค่าเริ่มต้น'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
