import { useState } from 'react';
import { Modal } from '../common/Modal';
import type { Product } from '../../types';

export function OpenPriceModal({ product, onClose, onConfirm }: { product: Product; onClose: () => void; onConfirm: (price: number, note?: string) => void }) {
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '0', '.', 'ลบ'];
  const press = (key: string) => setPrice((value) => key === 'ลบ' ? value.slice(0, -1) : `${value}${key}`);
  return (
    <Modal title="กำหนดราคาเอง" onClose={onClose}>
      <div className="mb-4 rounded-md bg-slate-100 p-4 text-right text-4xl font-black">{price || '0'}</div>
      <div className="grid grid-cols-3 gap-2">
        {keys.map((key) => <button key={key} onClick={() => press(key)} className="rounded-md bg-slate-100 py-4 text-xl font-black hover:bg-slate-200">{key}</button>)}
      </div>
      <textarea className="mt-4 w-full rounded-md border-slate-300" rows={2} placeholder="หมายเหตุ (ไม่บังคับ)" value={note} onChange={(event) => setNote(event.target.value)} />
      <button className="mt-4 w-full rounded-md bg-primary-600 py-3 font-black text-white" onClick={() => Number(price) > 0 && onConfirm(Number(price), note)}>
        เพิ่ม {product.displayName}
      </button>
    </Modal>
  );
}
