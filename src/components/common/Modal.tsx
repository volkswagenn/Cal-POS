import { X } from 'lucide-react';

export function Modal({
  title,
  children,
  onClose,
  wide = false,
  panelClassName = '',
  bodyClassName = 'p-5',
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
  panelClassName?: string;
  bodyClassName?: string;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/45 p-4">
      <section className={`max-h-[92vh] overflow-auto rounded-lg bg-white shadow-panel ${wide ? 'w-full max-w-4xl' : 'w-full max-w-lg'} ${panelClassName}`}>
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-lg font-bold">{title}</h2>
          <button className="rounded-md p-2 text-slate-500 hover:bg-slate-100" onClick={onClose} aria-label="ปิด">
            <X size={20} />
          </button>
        </header>
        <div className={bodyClassName}>{children}</div>
      </section>
    </div>
  );
}
