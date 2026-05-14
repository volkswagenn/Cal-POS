import { LogOut, Store, Warehouse } from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useTapCounter } from '../hooks/useTapCounter';
import { enableMirrorMode } from '../stores/mirrorStore';

export function FrontPosLayout() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user)!;
  const { tap: tapLogo, count: tapLogoCount } = useTapCounter(4, () => {
    enableMirrorMode();
    navigate('/mirror-pos');
  }, 2000);

  return (
    <div className="min-h-[100dvh] bg-slate-100">
      <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-primary-700 bg-primary-600 px-2 text-white shadow-sm lg:h-16 lg:px-3">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={tapLogo}
            className="hidden select-none rounded px-1 text-lg font-black sm:block"
            aria-label="Cal POS"
          >
            Cal POS
          </button>
          <div className="truncate text-xs font-bold opacity-90 sm:text-sm">{user.displayName}</div>
        </div>
        <div className="flex h-full shrink-0 items-stretch gap-1">
          <button
            type="button"
            onClick={() => navigate('/select')}
            className="flex min-w-16 flex-col items-center justify-center gap-0.5 rounded-md px-3 text-xs font-black hover:bg-primary-700 sm:min-w-20"
          >
            <LogOut size={18} /> ออก
          </button>
          <NavLink
            to="/front-pos"
            className={({ isActive }) => `flex min-w-20 flex-col items-center justify-center gap-0.5 rounded-md px-3 text-xs font-black ${isActive ? 'bg-white text-primary-700' : 'hover:bg-primary-700'}`}
          >
            <Store size={18} /> หน้าขาย
          </NavLink>
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            className="flex min-w-20 flex-col items-center justify-center gap-0.5 rounded-md px-3 text-xs font-black hover:bg-primary-700"
          >
            <Warehouse size={18} /> หลังบ้าน
          </button>
        </div>
      </header>
      <main className="pt-14 lg:pt-16">
        <Outlet />
      </main>
    </div>
  );
}
