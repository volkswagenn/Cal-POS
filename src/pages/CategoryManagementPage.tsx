import { FormEvent, useState } from 'react';
import { Eye, EyeOff, Plus } from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { Card } from '../components/common/Card';
import { CategoryRepository } from '../db/repositories/CategoryRepository';
import { useAsync } from '../hooks/useAsync';
import { useToast } from '../components/common/Toast';

export function CategoryManagementPage() {
  const { data: categories, reload } = useAsync(() => CategoryRepository.getCategories(true), []);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#1687e8');
  const toast = useToast();
  const create = async (event: FormEvent) => {
    event.preventDefault();
    await CategoryRepository.createCategory({ name, color });
    setName('');
    toast('เพิ่มหมวดหมู่แล้ว', 'success');
    reload();
  };
  return (
    <div className="p-4 md:p-6">
      <PageHeader title="จัดการหมวดหมู่" subtitle="สร้าง แก้ไข ซ่อน/แสดง เปลี่ยนสี และเรียงลำดับหมวดสินค้า" />
      <Card className="mb-4 p-4">
        <form onSubmit={create} className="grid gap-2 md:grid-cols-[1fr_90px_auto]">
          <input className="rounded-md border-slate-300" placeholder="ชื่อหมวดหมู่" value={name} onChange={(event) => setName(event.target.value)} required />
          <input type="color" className="h-11 w-full rounded-md border-slate-300" value={color} onChange={(event) => setColor(event.target.value)} />
          <button className="rounded-md bg-primary-600 px-4 font-bold text-white"><Plus className="inline" size={18} /> เพิ่ม</button>
        </form>
      </Card>
      <Card className="p-2">
        {(categories ?? []).map((category) => (
          <div key={category.id} className="grid gap-2 border-b border-slate-100 p-3 md:grid-cols-[1fr_90px_100px_90px_auto]">
            <input className="rounded-md border-slate-300" defaultValue={category.name} onBlur={(event) => CategoryRepository.updateCategory(category.id, { name: event.target.value }).then(reload)} />
            <input type="color" className="h-11 w-full rounded-md border-slate-300" defaultValue={category.color} onBlur={(event) => CategoryRepository.updateCategory(category.id, { color: event.currentTarget.value }).then(reload)} />
            <input type="number" className="rounded-md border-slate-300" defaultValue={category.sortOrder} onBlur={(event) => CategoryRepository.updateCategory(category.id, { sortOrder: Number(event.target.value) }).then(reload)} />
            <span className="py-2 text-sm font-bold">{category.isActive ? 'แสดง' : 'ซ่อน'}</span>
            <button className="rounded-md bg-slate-100 p-2" onClick={() => CategoryRepository.updateCategory(category.id, { isActive: !category.isActive }).then(reload)}>{category.isActive ? <Eye size={18} /> : <EyeOff size={18} />}</button>
          </div>
        ))}
      </Card>
    </div>
  );
}
