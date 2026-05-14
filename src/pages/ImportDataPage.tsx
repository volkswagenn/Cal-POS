import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { Card } from '../components/common/Card';

type ImportTab = 'create-products' | 'edit-products';

export function ImportDataPage() {
  const [activeTab, setActiveTab] = useState<ImportTab>('create-products');

  return (
    <div className="p-4 md:p-6">
      <PageHeader title="นำเข้าข้อมูล" subtitle="เตรียมพื้นที่สำหรับนำเข้าข้อมูลสินค้า" />

      <div className="mb-4 inline-grid grid-cols-2 rounded-lg bg-white p-1 shadow-sm">
        <button
          className={`flex items-center gap-2 rounded-md px-4 py-2 font-black ${activeTab === 'create-products' ? 'bg-primary-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
          onClick={() => setActiveTab('create-products')}
        >
          <Plus size={18} /> เพิ่มสินค้าใหม่
        </button>
        <button
          className={`flex items-center gap-2 rounded-md px-4 py-2 font-black ${activeTab === 'edit-products' ? 'bg-primary-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
          onClick={() => setActiveTab('edit-products')}
        >
          <Pencil size={18} /> แก้ไขสินค้าเดิม
        </button>
      </div>

      <Card className="min-h-[420px] p-4">{null}</Card>
    </div>
  );
}
