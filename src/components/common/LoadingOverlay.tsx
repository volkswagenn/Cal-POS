import { Loader2 } from 'lucide-react';

/**
 * Full-area loading spinner. Render conditionally with a page's `loading`
 * flag (e.g. from useAsync). Covers its nearest positioned ancestor, so wrap
 * the page content in a `relative` container or use `fullscreen`.
 */
export function LoadingOverlay({
  show,
  label = 'กำลังโหลดข้อมูล...',
  fullscreen = false,
}: {
  show: boolean;
  label?: string;
  fullscreen?: boolean;
}) {
  if (!show) return null;
  return (
    <div
      className={`${fullscreen ? 'fixed' : 'absolute'} inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-white/70 backdrop-blur-[1px]`}
      role="status"
      aria-live="polite"
    >
      <Loader2 size={40} className="animate-spin text-primary-600" />
      <span className="text-sm font-bold text-slate-600">{label}</span>
    </div>
  );
}
