import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Delete, Eye, EyeOff, LockKeyhole, RotateCcw, UserRound } from 'lucide-react';
import { UserRepository, ADMIN_RESET_PIN } from '../db/repositories/UserRepository';
import { useAuthStore } from '../stores/authStore';
import { useToast } from '../components/common/Toast';
import { authApi } from '../services/api/authApi';
import { ApiError, hasApiBaseUrl } from '../services/api/client';
import type { AuthTokens, User } from '../types';
import { SettingsRepository } from '../db/repositories/SettingsRepository';
import { nowIso } from '../utils/date';
import { LOGIN_SECURITY_CONFIG_KEY, LOGIN_SECURITY_STATE_KEY, isUserLoginBlocked, parseLoginSecurityConfig, parseLoginSecurityState, type LoginSecurityState } from '../utils/loginSecurity';

const RESET_PIN_LENGTH = 6;
const LOGIN_PIN_LENGTH = 6;

export function LoginPage() {
  const [mode, setMode] = useState<'password' | 'pin'>('password');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pin, setPin] = useState('');
  const [pinShake, setPinShake] = useState(false);
  const [pinLoginBlocked, setPinLoginBlocked] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetPin, setResetPin] = useState('');
  const [resetError, setResetError] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const setSession = useAuthStore((state) => state.setSession);
  const navigate = useNavigate();
  const toast = useToast();

  const readLoginSecurity = async () => ({
    config: parseLoginSecurityConfig(await SettingsRepository.getSetting(LOGIN_SECURITY_CONFIG_KEY)),
    state: parseLoginSecurityState(await SettingsRepository.getSetting(LOGIN_SECURITY_STATE_KEY)),
  });

  const saveLoginSecurityState = async (state: LoginSecurityState) => {
    await SettingsRepository.setSetting(LOGIN_SECURITY_STATE_KEY, JSON.stringify(state), { sync: true });
  };

  useEffect(() => {
    let mounted = true;
    readLoginSecurity().then(({ state }) => {
      if (mounted) setPinLoginBlocked(state.pinBlocked);
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (mode !== 'pin' || !pinLoginBlocked) return;
    setPin('');
    toast('PIN ถูกบล็อก กรุณาเข้าสู่ระบบด้วยชื่อผู้ใช้/รหัสผ่าน', 'error');
  }, [mode, pinLoginBlocked, toast]);

  const recordPasswordFailure = async (targetUser?: User | null) => {
    if (!targetUser) return;
    const { config, state } = await readLoginSecurity();
    const attempts = (state.passwordFailuresByUserId[targetUser.id] ?? 0) + 1;
    const blocked = attempts >= config.passwordMaxAttempts;
    const blockedAtByUserId = { ...state.blockedAtByUserId };
    if (blocked) blockedAtByUserId[targetUser.id] = nowIso();
    await saveLoginSecurityState({
      ...state,
      passwordFailuresByUserId: { ...state.passwordFailuresByUserId, [targetUser.id]: attempts },
      blockedUserIds: blocked ? [...new Set([...state.blockedUserIds, targetUser.id])] : state.blockedUserIds,
      blockedAtByUserId,
    });
    if (blocked) toast(`บัญชี ${targetUser.displayName} ถูกบล็อกจากการใส่รหัสผ่านผิดครบ ${config.passwordMaxAttempts} ครั้ง`, 'error');
  };

  const clearLoginBlocksAfterPasswordLogin = async (targetUser: User) => {
    const { state } = await readLoginSecurity();
    const passwordFailuresByUserId = { ...state.passwordFailuresByUserId };
    delete passwordFailuresByUserId[targetUser.id];
    const blockedAtByUserId = { ...state.blockedAtByUserId };
    delete blockedAtByUserId[targetUser.id];
    await saveLoginSecurityState({
      ...state,
      passwordFailuresByUserId,
      blockedAtByUserId,
      blockedUserIds: state.blockedUserIds.filter((id) => id !== targetUser.id),
      pinFailures: 0,
      pinBlocked: false,
      pinBlockedAt: null,
    });
    setPinLoginBlocked(false);
  };

  const recordPinFailure = async () => {
    const { config, state } = await readLoginSecurity();
    const pinFailures = state.pinFailures + 1;
    const pinBlocked = pinFailures >= config.pinMaxAttempts;
    await saveLoginSecurityState({
      ...state,
      pinFailures,
      pinBlocked,
      pinBlockedAt: pinBlocked ? nowIso() : state.pinBlockedAt,
    });
    if (pinBlocked) {
      setPinLoginBlocked(true);
      setPin('');
      toast('PIN ถูกบล็อกแล้ว กรุณาเข้าสู่ระบบด้วยชื่อผู้ใช้/รหัสผ่าน', 'error');
    }
  };

  const clearPinFailures = async () => {
    const { state } = await readLoginSecurity();
    if (state.pinFailures === 0 && !state.pinBlocked) return;
    await saveLoginSecurityState({ ...state, pinFailures: 0, pinBlocked: false, pinBlockedAt: null });
  };

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
    let apiAuthRejected = false;
    const localUser = mode === 'password' ? await UserRepository.getUserByUsername(username) : null;
    const { state } = await readLoginSecurity();

    if (mode === 'password' && isUserLoginBlocked(localUser?.id, state)) {
      toast('บัญชีนี้ถูกบล็อก กรุณาให้ผู้ดูแลปลดล็อกในหน้าผู้ใช้', 'error');
      return;
    }
    if (mode === 'pin' && state.pinBlocked) {
      setPinLoginBlocked(true);
      setPin('');
      toast('PIN ถูกบล็อก กรุณาเข้าสู่ระบบด้วยชื่อผู้ใช้/รหัสผ่าน', 'error');
      return;
    }

    if (hasApiBaseUrl) {
      try {
        const result = mode === 'password'
          ? await authApi.login(username, password)
          : await authApi.loginWithPin(pin);
        user = result.user;
        tokens = result.tokens;
      } catch (error) {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
          apiAuthRejected = true;
        }
      }
    }

    if (!user && !apiAuthRejected) {
      user = mode === 'password'
        ? await UserRepository.loginByUsername(username, password)
        : await UserRepository.loginByPin(pin);
    }

    if (!user) {
      if (mode === 'password') await recordPasswordFailure(localUser);
      toast('เข้าสู่ระบบไม่สำเร็จ กรุณาตรวจสอบข้อมูล', 'error');
      return;
    }

    if (mode === 'password') await clearLoginBlocksAfterPasswordLogin(user);

    if (hasApiBaseUrl && !tokens) {
      toast('เซิร์ฟเวอร์ออฟไลน์ — ใช้งานแบบเครื่องเดียวชั่วคราว ข้อมูลจะไม่ sync', 'error');
    }
    setSession(user, tokens);
    toast(`ยินดีต้อนรับ ${user.displayName}`, 'success');
    navigate('/select');
  };

  const pressLoginPin = async (digit: string) => {
    if (pinLoginBlocked) {
      toast('PIN ถูกบล็อก กรุณาเข้าสู่ระบบด้วยชื่อผู้ใช้/รหัสผ่าน', 'error');
      return;
    }
    if (pin.length >= LOGIN_PIN_LENGTH) return;
    const next = pin + digit;
    setPin(next);
    if (next.length === LOGIN_PIN_LENGTH) {
      const { state } = await readLoginSecurity();
      if (state.pinBlocked) {
        setPinLoginBlocked(true);
        setPin('');
        toast('PIN ถูกบล็อก กรุณาเข้าสู่ระบบด้วยชื่อผู้ใช้/รหัสผ่าน', 'error');
        return;
      }
      // auto-submit
      let user: User | null = null;
      let tokens: AuthTokens | undefined;
      let apiAuthRejected = false;
      if (hasApiBaseUrl) {
        try {
          const result = await authApi.loginWithPin(next);
          user = result.user;
          tokens = result.tokens;
        } catch (error) {
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
            apiAuthRejected = true;
          }
        }
      }
      if (!user && !apiAuthRejected) {
        user = await UserRepository.loginByPin(next);
      }
      if (!user) {
        await recordPinFailure();
        setPinShake(true);
        setTimeout(() => { setPin(''); setPinShake(false); }, 600);
        toast('PIN ไม่ถูกต้อง', 'error');
        return;
      }
      if (hasApiBaseUrl && !tokens) {
        toast('เซิร์ฟเวอร์ออฟไลน์ — ใช้งานแบบเครื่องเดียวชั่วคราว ข้อมูลจะไม่ sync', 'error');
      }
      await clearPinFailures();
      setPinLoginBlocked(false);
      setSession(user, tokens);
      toast(`ยินดีต้อนรับ ${user.displayName}`, 'success');
      navigate('/select');
    }
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
      {/* Password mode */}
      {mode === 'pin' ? (
        <div className="w-full max-w-xs overflow-hidden rounded-2xl bg-white shadow-panel">
          {/* Header */}
          <div className={`${pinLoginBlocked ? 'bg-red-600' : 'bg-primary-600'} px-5 py-5 text-center text-white`}>
            <div className="text-2xl font-black">Cal POS</div>
            <p className="mt-0.5 text-sm font-medium opacity-90">ใส่ PIN เพื่อเข้าสู่ระบบ</p>
          </div>

          {/* Dot indicators */}
          <div className={`flex justify-center gap-4 py-6 ${pinShake ? 'animate-shake' : ''}`}>
            {Array.from({ length: LOGIN_PIN_LENGTH }).map((_, i) => (
              <div
                key={i}
                className={`h-4 w-4 rounded-full border-2 transition-all duration-150 ${
                  i < pin.length
                    ? 'scale-110 border-primary-600 bg-primary-600'
                    : 'border-slate-300 bg-transparent'
                }`}
              />
            ))}
          </div>

          {pinLoginBlocked && (
            <div className="mx-4 mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-center text-xs font-black text-red-700">
              PIN ถูกบล็อก
              <div className="mt-0.5 font-bold text-red-600">กรุณาเข้าสู่ระบบด้วยชื่อผู้ใช้/รหัสผ่านเพื่อปลดล็อก</div>
            </div>
          )}

          {/* Numpad */}
          <div className="grid grid-cols-3 gap-px border-t border-slate-200 bg-slate-200">
            {['1','2','3','4','5','6','7','8','9'].map((d) => (
              <button key={d} type="button" onClick={() => pressLoginPin(d)} disabled={pinLoginBlocked}
                className="bg-white py-5 text-2xl font-black text-slate-800 active:bg-primary-50 active:text-primary-700 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-300">
                {d}
              </button>
            ))}
            <button type="button" onClick={() => { setMode('password'); setPin(''); }}
              className="bg-white py-5 text-xs font-bold text-slate-400 active:bg-slate-50">
              รหัสผ่าน
            </button>
            <button type="button" onClick={() => pressLoginPin('0')} disabled={pinLoginBlocked}
              className="bg-white py-5 text-2xl font-black text-slate-800 active:bg-primary-50 active:text-primary-700 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-300">
              0
            </button>
            <button type="button" onClick={() => setPin((p) => p.slice(0, -1))} disabled={pinLoginBlocked || pin.length === 0}
              className="flex items-center justify-center bg-white py-5 active:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-30">
              <Delete size={22} className="text-slate-600" />
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-panel">
          <div className="mb-6">
            <div className="text-3xl font-black text-primary-700">Cal POS</div>
            <p className="mt-2 text-sm text-slate-500">เข้าสู่ระบบขายหน้าร้าน</p>
          </div>
          <div className="mb-5 grid grid-cols-2 rounded-md bg-slate-100 p-1">
            <button type="button" className="rounded-md bg-white py-2 font-bold text-primary-700 shadow-sm">รหัสผ่าน</button>
            <button type="button" onClick={() => { setMode('pin'); setUsername(''); setPassword(''); }} className="rounded-md py-2 font-bold text-slate-500">PIN</button>
          </div>
          <div className="space-y-4">
            <label className="block text-sm font-bold text-slate-700">ชื่อผู้ใช้
              <div className="mt-1 flex items-center gap-2 rounded-md border border-slate-300 px-3">
                <UserRound size={18} className="text-slate-400" />
                <input autoComplete="off" className="w-full border-0 focus:ring-0" value={username} onChange={(event) => setUsername(event.target.value)} autoFocus />
              </div>
            </label>
            <label className="block text-sm font-bold text-slate-700">รหัสผ่าน
              <div className="mt-1 flex items-center gap-2 rounded-md border border-slate-300 px-3">
                <LockKeyhole size={18} className="text-slate-400" />
                <input type={showPassword ? 'text' : 'password'} autoComplete="new-password" className="w-full border-0 focus:ring-0" value={password} onChange={(event) => setPassword(event.target.value)} />
                <button type="button" className="rounded-md p-1 text-slate-500 hover:bg-slate-100" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}>
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>
          </div>
          <button className="mt-6 w-full rounded-md bg-primary-600 py-3 text-lg font-black text-white hover:bg-primary-700">เข้าสู่ระบบ</button>
        </form>
      )}

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
