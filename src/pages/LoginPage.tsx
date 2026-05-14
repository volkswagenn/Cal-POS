import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Delete, Eye, EyeOff, LockKeyhole, RotateCcw, UserRound } from 'lucide-react';
import { UserRepository, ADMIN_RESET_PIN } from '../db/repositories/UserRepository';
import { useAuthStore } from '../stores/authStore';
import { useToast } from '../components/common/Toast';
import { authApi } from '../services/api/authApi';
import { hasApiBaseUrl } from '../services/api/client';
import type { AuthTokens, User } from '../types';

const RESET_PIN_LENGTH = 6;

export function LoginPage() {
  const [mode, setMode] = useState<'password' | 'pin'>('password');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pin, setPin] = useState('');
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetPin, setResetPin] = useState('');
  const [resetError, setResetError] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const setSession = useAuthStore((state) => state.setSession);
  const navigate = useNavigate();
  const toast = useToast();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (mode === 'password' && username.trim().toLowerCase() === 'reset' && password.trim().toLowerCase() === 'reset') {
      setResetPin('');
      setResetError('');
      setShowResetModal(true);
      return;
    }
    let user: User | null = null;
    let tokens: AuthTokens | undefined;

    if (hasApiBaseUrl) {
      try {
        const result = mode === 'password'
          ? await authApi.login(username, password)
          : await authApi.loginWithPin(pin);
        user = result.user;
        tokens = result.tokens;
      } catch {
        user = null;
      }
    }

    if (!user) {
      user = mode === 'password'
        ? await UserRepository.loginByUsername(username, password)
        : await UserRepository.loginByPin(pin);
    }

    if (!user) {
      toast('เข้าสู่ระบบไม่สำเร็จ กรุณาตรวจสอบข้อมูล', 'error');
      return;
    }
    setSession(user, tokens);
    toast(`ยินดีต้อนรับ ${user.displayName}`, 'success');
    navigate('/select');
  };

  const pressResetDigit = (digit: string) => {
    if (resetPin.length >= RESET_PIN_LENGTH) return;
    const next = resetPin + digit;
    setResetPin(next);
    setResetError('');
    if (next.length === RESET_PIN_LENGTH) confirmReset(next);
  };

  const confirmReset = async (enteredPin: string) => {
    if (enteredPin !== ADMIN_RESET_PIN) {
      setResetError('PIN ไม่ถูกต้อง');
      setResetPin('');
      return;
    }
    setIsResetting(true);
    try {
      await UserRepository.resetAdminToDefault();
      setShowResetModal(false);
      setUsername('');
      setPassword('');
      toast('Reset สำเร็จ — เข้าสู่ระบบด้วย username: admin / รหัสผ่าน: admin', 'success');
    } catch {
      setResetError('Reset ไม่สำเร็จ กรุณาลองใหม่');
      setResetPin('');
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <main className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top_left,#dff0ff,transparent_36%),linear-gradient(135deg,#f8fbff,#eaf3fb)] p-4">
      <form onSubmit={submit} className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-panel">
        <div className="mb-6">
          <div className="text-3xl font-black text-primary-700">Cal POS</div>
          <p className="mt-2 text-sm text-slate-500">เข้าสู่ระบบขายหน้าร้าน</p>
        </div>
        <div className="mb-5 grid grid-cols-2 rounded-md bg-slate-100 p-1">
          <button type="button" onClick={() => setMode('password')} className={`rounded-md py-2 font-bold ${mode === 'password' ? 'bg-white text-primary-700 shadow-sm' : 'text-slate-500'}`}>รหัสผ่าน</button>
          <button type="button" onClick={() => setMode('pin')} className={`rounded-md py-2 font-bold ${mode === 'pin' ? 'bg-white text-primary-700 shadow-sm' : 'text-slate-500'}`}>PIN</button>
        </div>
        {mode === 'password' ? (
          <div className="space-y-4">
            <label className="block text-sm font-bold text-slate-700">ชื่อผู้ใช้
              <div className="mt-1 flex items-center gap-2 rounded-md border border-slate-300 px-3">
                <UserRound size={18} className="text-slate-400" />
                <input className="w-full border-0 focus:ring-0" value={username} onChange={(event) => setUsername(event.target.value)} />
              </div>
            </label>
            <label className="block text-sm font-bold text-slate-700">รหัสผ่าน
              <div className="mt-1 flex items-center gap-2 rounded-md border border-slate-300 px-3">
                <LockKeyhole size={18} className="text-slate-400" />
                <input type={showPassword ? 'text' : 'password'} className="w-full border-0 focus:ring-0" value={password} onChange={(event) => setPassword(event.target.value)} />
                <button type="button" className="rounded-md p-1 text-slate-500 hover:bg-slate-100" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}>
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>
          </div>
        ) : (
          <label className="block text-sm font-bold text-slate-700">PIN 4-6 หลัก
            <input inputMode="numeric" maxLength={6} className="mt-1 w-full rounded-md border-slate-300 text-center text-3xl font-black tracking-widest" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))} autoFocus />
          </label>
        )}
        <button className="mt-6 w-full rounded-md bg-primary-600 py-3 text-lg font-black text-white hover:bg-primary-700">เข้าสู่ระบบ</button>
      </form>

      {/* Reset Admin PIN Modal */}
      {showResetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-xs overflow-hidden rounded-2xl bg-white shadow-xl">
            <div className="bg-amber-500 px-5 py-4 text-center text-white">
              <RotateCcw size={28} className="mx-auto mb-1" />
              <h2 className="text-lg font-black">Reset Admin</h2>
              <p className="text-xs font-medium opacity-90">ใส่ PIN 6 หลักเพื่อยืนยันการ Reset</p>
            </div>

            <div className="flex justify-center gap-3 py-6">
              {Array.from({ length: RESET_PIN_LENGTH }).map((_, i) => (
                <div
                  key={i}
                  className={`h-3.5 w-3.5 rounded-full border-2 transition-all ${
                    i < resetPin.length ? 'scale-110 border-amber-500 bg-amber-500' : 'border-slate-300 bg-transparent'
                  }`}
                />
              ))}
            </div>

            {resetError && <p className="mb-2 text-center text-sm font-bold text-red-600">{resetError}</p>}

            <div className="grid grid-cols-3 gap-px border-t border-slate-200 bg-slate-200">
              {['1','2','3','4','5','6','7','8','9'].map((d) => (
                <button key={d} type="button" onClick={() => pressResetDigit(d)} disabled={isResetting}
                  className="bg-white py-5 text-xl font-black text-slate-800 active:bg-slate-100 disabled:opacity-50">
                  {d}
                </button>
              ))}
              <button type="button" onClick={() => { setShowResetModal(false); setResetPin(''); setResetError(''); }} disabled={isResetting}
                className="bg-white py-5 text-sm font-bold text-slate-500 active:bg-slate-100 disabled:opacity-50">
                ยกเลิก
              </button>
              <button type="button" onClick={() => pressResetDigit('0')} disabled={isResetting}
                className="bg-white py-5 text-xl font-black text-slate-800 active:bg-slate-100 disabled:opacity-50">
                0
              </button>
              <button type="button" onClick={() => { setResetPin((p) => p.slice(0, -1)); setResetError(''); }} disabled={isResetting || resetPin.length === 0}
                className="flex items-center justify-center bg-white py-5 active:bg-slate-100 disabled:opacity-30">
                <Delete size={22} className="text-slate-600" />
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
