import { X } from 'lucide-react';
import { createContext, useContext, useMemo, useState } from 'react';

type ToastType = 'success' | 'error' | 'info';
interface ToastItem { id: number; message: string; type: ToastType }
const ToastContext = createContext<(message: string, type?: ToastType) => void>(() => undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const close = (id: number) => setItems((state) => state.filter((item) => item.id !== id));
  const show = useMemo(() => (message: string, type: ToastType = 'info') => {
    const id = Date.now();
    setItems((state) => [...state, { id, message, type }]);
    window.setTimeout(() => setItems((state) => state.filter((item) => item.id !== id)), 2800);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="fixed right-4 top-4 z-50 space-y-2 no-print">
        {items.map((item) => (
          <div key={item.id} className={`flex max-w-[calc(100vw-2rem)] items-start gap-3 rounded-md px-4 py-3 text-sm font-semibold text-white shadow-panel ${item.type === 'error' ? 'bg-red-600' : item.type === 'success' ? 'bg-emerald-600' : 'bg-slate-800'}`}>
            <span className="min-w-0 flex-1 break-words">{item.message}</span>
            <button type="button" className="-mr-1 rounded p-0.5 text-white/85 hover:bg-white/15 hover:text-white" onClick={() => close(item.id)} aria-label="ปิดการแจ้งเตือน">
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
