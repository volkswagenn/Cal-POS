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
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-950/45 p-0 sm:items-center sm:p-4">
      <section className={`max-h-[92dvh] w-full overflow-auto rounded-t-2xl bg-white shadow-panel sm:rounded-lg ${wide ? 'sm:max-w-4xl' : 'sm:max-w-lg'} ${panelClassName}`}>
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-5 sm:py-4">
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
