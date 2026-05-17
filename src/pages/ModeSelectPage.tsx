import { LogOut, Store, Warehouse } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { usePermissions } from '../hooks/usePermissions';

export function ModeSelectPage() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user)!;
  const logout = useAuthStore((state) => state.logout);
  const { can, loading } = usePermissions();
  const canOpenFrontPos = loading || can('pos');
  const canOpenBackOffice = loading || can('dashboard');

  const onLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <main className="relative grid min-h-[100dvh] place-items-center overflow-hidden bg-[#d8f0fb] px-4 py-8">
      <div className="absolute inset-x-0 top-0 h-28 bg-[repeating-linear-gradient(90deg,#7dbce3_0_76px,#eaf6ff_76px_152px)] shadow-[0_12px_0_rgba(44,132,151,0.18)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_24%,rgba(255,255,255,0.55)_0_2px,transparent_3px),radial-gradient(circle_at_72%_32%,rgba(255,255,255,0.55)_0_3px,transparent_4px)] bg-[length:120px_120px,180px_180px]" />
      <div className="relative z-10 w-full max-w-5xl">
        <div className="mb-8 flex items-center justify-between gap-3">
          <div>
            <div className="text-3xl font-black text-primary-900">Cal POS</div>
            <div className="text-sm font-bold text-slate-600">{user.displayName} / {user.role}</div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="flex items-center gap-2 rounded-md bg-white/90 px-4 py-3 font-black text-red-600 shadow-sm hover:bg-red-50"
          >
            <LogOut size={20} /> ออกจากระบบ
          </button>
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          <button
            type="button"
            onClick={() => navigate('/front-pos')}
            disabled={!canOpenFrontPos}
            className="group flex min-h-72 flex-col items-center justify-center rounded-lg border border-white/80 bg-white/85 p-8 text-center shadow-panel transition hover:-translate-y-1 hover:bg-white hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0 disabled:hover:shadow-panel"
          >
            <Store className="mb-6 text-primary-600 transition group-hover:scale-105" size={108} strokeWidth={1.7} />
            <span className="text-4xl font-black text-slate-950">หน้าขาย</span>
          </button>
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            disabled={!canOpenBackOffice}
            className="group flex min-h-72 flex-col items-center justify-center rounded-lg border border-white/80 bg-white/85 p-8 text-center shadow-panel transition hover:-translate-y-1 hover:bg-white hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0 disabled:hover:shadow-panel"
          >
            <Warehouse className="mb-6 text-amber-600 transition group-hover:scale-105" size={108} strokeWidth={1.7} />
            <span className="text-4xl font-black text-slate-950">หลังบ้าน</span>
          </button>
        </div>
      </div>
    </main>
  );
}
