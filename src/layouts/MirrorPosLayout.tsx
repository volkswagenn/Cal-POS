import { useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Delete, LockOpen } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { disableMirrorMode } from '../stores/mirrorStore';
import { useTapCounter } from '../hooks/useTapCounter';
import { UserRepository } from '../db/repositories/UserRepository';
import { useToast } from '../components/common/Toast';
import { hasPermission, parsePositions } from '../utils/permissions';
import { SettingsRepository } from '../db/repositories/SettingsRepository';
import { useAsync } from '../hooks/useAsync';
import { positionSettingKey } from '../utils/permissions';

const MIN_PIN_LENGTH = 4;
const MAX_PIN_LENGTH = 6;

export function MirrorPosLayout() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user)!;
  const toast = useToast();
  const [showExitModal, setShowExitModal] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [isChecking, setIsChecking] = useState(false);
  const { data: positionSetting } = useAsync(() => SettingsRepository.getSetting(positionSettingKey), []);
  const positions = parsePositions(positionSetting);

  const openExitModal = () => {
    setPin('');
    setError('');
    setShowExitModal(true);
  };

  const { tap: tapLogo } = useTapCounter(10, openExitModal, 2000);

  const pressDigit = (digit: string) => {
    if (pin.length >= MAX_PIN_LENGTH) return;
    const next = pin + digit;
    setPin(next);
    setError('');
    if (next.length >= MIN_PIN_LENGTH) verifyPin(next);
  };

  const deleteLast = () => {
    setPin((p) => p.slice(0, -1));
    setError('');
  };

  const verifyPin = async (enteredPin: string) => {
    setIsChecking(true);
    try {
      const matched = await UserRepository.loginByPin(enteredPin);
      if (!matched) {
        if (enteredPin.length >= MAX_PIN_LENGTH) {
          setError('PIN ไม่ถูกต้อง');
          setPin('');
        }
        return;
      }
      if (!hasPermission(matched.role, positions, 'unlock_mirror')) {
        setError(`${matched.displayName} ไม่มีสิทธิ์ปลด Mirror POS`);
        setPin('');
        return;
      }
      disableMirrorMode();
      setShowExitModal(false);
      toast('ออกจาก Mirror POS แล้ว', 'success');
      navigate('/select', { replace: true });
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-slate-100">
      {/* Mirror header */}
      <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-primary-700 bg-primary-600 px-3 text-white shadow-sm lg:h-16 lg:px-4">
        <button
          type="button"
          onClick={tapLogo}
          className="select-none rounded-md px-2 py-1 text-xl font-black tracking-tight lg:text-2xl"
          aria-label="Cal POS"
        >
          Cal POS
        </button>
      </header>

      <main className="pt-14 lg:pt-16">
        <Outlet />
      </main>

      {/* Exit PIN modal */}
      {showExitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-xs overflow-hidden rounded-2xl bg-white shadow-xl">
            <div className="bg-primary-600 px-5 py-4 text-center text-white">
              <LockOpen size={28} className="mx-auto mb-1" />
              <h2 className="text-lg font-black">ปลด Mirror POS</h2>
              <p className="text-xs font-medium opacity-80">ใส่ PIN ของผู้ที่มีสิทธิ์ปลดระบบ</p>
            </div>

            {/* PIN dots */}
            <div className="flex justify-center gap-4 py-6">
              {Array.from({ length: MAX_PIN_LENGTH }).map((_, i) => (
                <div
                  key={i}
                  className={`h-4 w-4 rounded-full border-2 transition-all ${
                    i < pin.length
                      ? 'border-primary-600 bg-primary-600 scale-110'
                      : 'border-slate-300 bg-transparent'
                  }`}
                />
              ))}
            </div>

            {error && (
              <p className="mb-2 text-center text-sm font-bold text-red-600">{error}</p>
            )}

            {/* Numpad */}
            <div className="grid grid-cols-3 gap-px bg-slate-200 border-t border-slate-200">
              {['1','2','3','4','5','6','7','8','9'].map((d) => (
                <button
                  key={d}
                  onClick={() => pressDigit(d)}
                  disabled={isChecking}
                  className="bg-white py-5 text-xl font-black text-slate-800 active:bg-slate-100 disabled:opacity-50"
                >
                  {d}
                </button>
              ))}
              <button
                onClick={() => { setShowExitModal(false); setPin(''); setError(''); }}
                disabled={isChecking}
                className="bg-white py-5 text-sm font-bold text-slate-500 active:bg-slate-100 disabled:opacity-50"
              >
                ยกเลิก
              </button>
              <button
                onClick={() => pressDigit('0')}
                disabled={isChecking}
                className="bg-white py-5 text-xl font-black text-slate-800 active:bg-slate-100 disabled:opacity-50"
              >
                0
              </button>
              <button
                onClick={deleteLast}
                disabled={isChecking || pin.length === 0}
                className="flex items-center justify-center bg-white py-5 active:bg-slate-100 disabled:opacity-30"
              >
                <Delete size={22} className="text-slate-600" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
