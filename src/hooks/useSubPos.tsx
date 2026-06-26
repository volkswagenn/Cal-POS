import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { hasApiBaseUrl } from '../services/api/client';
import { subposApi, type SubPosLinkRecord } from '../services/api/subposApi';
import { getDeviceCode } from '../utils/deviceCode';
import { PrinterRepository } from '../db/repositories/PrinterRepository';
import { PrinterOutputService } from '../services/printerOutputService';
import { useToast } from '../components/common/Toast';
import type { SaleDetail, User } from '../types';

export const SUBPOS_MAIN_CODE_KEY = 'subpos_main_code';
export const SUBPOS_LINK_ID_KEY = 'subpos_link_id';
export const SUBPOS_LINK_STATUS_KEY = 'subpos_link_status';
export const SUBPOS_USE_PRINTER_KEY = 'subpos_use_printer';
export const SUBPOS_USE_DRAWER_KEY = 'subpos_use_drawer';

export type PendingApproval = {
  linkId: string;
  subDeviceCode: string;
  subDeviceId: string;
};

type SubPosMsg = { type: string; [key: string]: unknown };

export type SubPosContextValue = {
  deviceCode: string;
  // This device acting as MainPOS
  linksAsMain: SubPosLinkRecord[];
  pendingApprovals: PendingApproval[];
  approveLink: (approval: PendingApproval) => Promise<void>;
  rejectLink: (approval: PendingApproval) => Promise<void>;
  revokeLink: (id: string) => Promise<void>;
  reloadLinks: () => void;
  // This device acting as SubPOS
  mainCode: string;
  linkStatus: 'none' | 'pending' | 'active';
  usePrinter: boolean;
  useDrawer: boolean;
  setUsePrinter: (v: boolean) => void;
  setUseDrawer: (v: boolean) => void;
  requestLink: (mainCode: string) => Promise<void>;
  clearSubLink: () => void;
};

const SubPosContext = createContext<SubPosContextValue | null>(null);

export function SubPosProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [deviceCode] = useState(getDeviceCode);
  const [linksAsMain, setLinksAsMain] = useState<SubPosLinkRecord[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [mainCode, setMainCode] = useState(() => localStorage.getItem(SUBPOS_MAIN_CODE_KEY) ?? '');
  const [linkStatus, setLinkStatus] = useState<'none' | 'pending' | 'active'>(() => {
    const v = localStorage.getItem(SUBPOS_LINK_STATUS_KEY);
    return v === 'pending' || v === 'active' ? v : 'none';
  });
  const [usePrinter, setUsePrinterState] = useState(
    () => localStorage.getItem(SUBPOS_USE_PRINTER_KEY) !== 'false',
  );
  const [useDrawer, setUseDrawerState] = useState(
    () => localStorage.getItem(SUBPOS_USE_DRAWER_KEY) !== 'false',
  );

  const loadLinks = useCallback(async () => {
    if (!hasApiBaseUrl) return;
    try {
      const links = await subposApi.getLinks();
      setLinksAsMain(links);
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => { void loadLinks(); }, [loadLinks]);

  // Handle all SubPOS WebSocket messages dispatched from syncWebSocket.ts
  useEffect(() => {
    const handler = async (e: Event) => {
      const msg = (e as CustomEvent<SubPosMsg>).detail;

      if (msg.type === 'subpos_link_request') {
        const { linkId, subDeviceCode, subDeviceId } = msg as {
          type: string; linkId: string; subDeviceCode: string; subDeviceId: string;
        };
        setPendingApprovals((prev) => {
          if (prev.some((a) => a.linkId === linkId)) return prev;
          return [...prev, { linkId, subDeviceCode, subDeviceId }];
        });
        toast(`SubPOS "${subDeviceCode}" ขอเชื่อมต่อ — ยืนยันได้ที่ตั้งค่า SubPOS`, 'info');
        return;
      }

      if (msg.type === 'subpos_link_approved') {
        const { linkId, mainDeviceCode } = msg as {
          type: string; linkId: string; mainDeviceCode: string;
        };
        localStorage.setItem(SUBPOS_LINK_ID_KEY, linkId);
        localStorage.setItem(SUBPOS_LINK_STATUS_KEY, 'active');
        const code = mainDeviceCode ?? localStorage.getItem(SUBPOS_MAIN_CODE_KEY) ?? '';
        if (mainDeviceCode) localStorage.setItem(SUBPOS_MAIN_CODE_KEY, code);
        setMainCode(code);
        setLinkStatus('active');
        toast(`เชื่อมต่อกับ MainPOS "${code}" สำเร็จ`, 'success');
        return;
      }

      if (msg.type === 'subpos_link_rejected') {
        localStorage.removeItem(SUBPOS_LINK_ID_KEY);
        localStorage.setItem(SUBPOS_LINK_STATUS_KEY, 'none');
        setLinkStatus('none');
        toast('MainPOS ปฏิเสธการเชื่อมต่อ', 'error');
        return;
      }

      if (msg.type === 'subpos_link_revoked') {
        localStorage.removeItem(SUBPOS_LINK_ID_KEY);
        localStorage.setItem(SUBPOS_LINK_STATUS_KEY, 'none');
        setLinkStatus('none');
        toast('MainPOS ยกเลิกการเชื่อมต่อแล้ว', 'info');
        return;
      }

      if (msg.type === 'subpos_command') {
        const { commandId, linkId, action, payload } = msg as {
          type: string;
          commandId: string;
          linkId: string;
          action: string;
          payload: { detail: SaleDetail };
        };
        let success = false;
        let error: string | undefined;
        try {
          if (action === 'print_receipt') {
            await PrinterOutputService.printReceipt(payload.detail);
            success = true;
          } else if (action === 'open_drawer') {
            const { detail } = payload;
            const cashAmount = detail.payments
              .filter((p) => p.method === 'cash')
              .reduce((sum, p) => sum + p.receivedAmount - p.changeAmount, 0);
            const log = await PrinterRepository.openDrawer({
              user: { id: detail.sale.cashierId, displayName: detail.sale.cashierName } as User,
              action: 'cash_in',
              amount: cashAmount,
              note: `SubPOS: ${detail.sale.billNo}`,
            });
            success = log.status !== 'failed';
            if (!success) error = log.error ?? 'เปิดลิ้นชักไม่สำเร็จ';
          }
        } catch (err) {
          error = err instanceof Error ? err.message : 'ดำเนินการไม่สำเร็จ';
        }
        void subposApi.sendCommandResult(commandId, linkId, success, error);
        return;
      }

      if (msg.type === 'subpos_command_result') {
        const { success, error: cmdError } = msg as {
          type: string; success: boolean; error?: string;
        };
        if (!success && cmdError) toast(`MainPOS: ${cmdError}`, 'error');
        return;
      }
    };

    window.addEventListener('calpos:ws-subpos', handler);
    return () => window.removeEventListener('calpos:ws-subpos', handler);
  }, [toast]);

  const requestLink = useCallback(async (code: string) => {
    const upper = code.toUpperCase().trim();
    const { linkId } = await subposApi.requestLink(upper);
    localStorage.setItem(SUBPOS_MAIN_CODE_KEY, upper);
    localStorage.setItem(SUBPOS_LINK_ID_KEY, linkId);
    localStorage.setItem(SUBPOS_LINK_STATUS_KEY, 'pending');
    setMainCode(upper);
    setLinkStatus('pending');
  }, []);

  const approveLink = useCallback(
    async (approval: PendingApproval) => {
      await subposApi.approveLink(approval.linkId);
      setPendingApprovals((prev) => prev.filter((a) => a.linkId !== approval.linkId));
      void loadLinks();
    },
    [loadLinks],
  );

  const rejectLink = useCallback(async (approval: PendingApproval) => {
    await subposApi.rejectLink(approval.linkId);
    setPendingApprovals((prev) => prev.filter((a) => a.linkId !== approval.linkId));
  }, []);

  const revokeLink = useCallback(async (id: string) => {
    await subposApi.revokeLink(id);
    setLinksAsMain((prev) => prev.filter((l) => l.id !== id));
  }, []);

  const clearSubLink = useCallback(() => {
    localStorage.removeItem(SUBPOS_MAIN_CODE_KEY);
    localStorage.removeItem(SUBPOS_LINK_ID_KEY);
    localStorage.setItem(SUBPOS_LINK_STATUS_KEY, 'none');
    setMainCode('');
    setLinkStatus('none');
  }, []);

  const setUsePrinter = useCallback((v: boolean) => {
    localStorage.setItem(SUBPOS_USE_PRINTER_KEY, String(v));
    setUsePrinterState(v);
  }, []);

  const setUseDrawer = useCallback((v: boolean) => {
    localStorage.setItem(SUBPOS_USE_DRAWER_KEY, String(v));
    setUseDrawerState(v);
  }, []);

  return (
    <SubPosContext.Provider
      value={{
        deviceCode,
        linksAsMain,
        pendingApprovals,
        approveLink,
        rejectLink,
        revokeLink,
        reloadLinks: loadLinks,
        mainCode,
        linkStatus,
        usePrinter,
        useDrawer,
        setUsePrinter,
        setUseDrawer,
        requestLink,
        clearSubLink,
      }}
    >
      {children}
    </SubPosContext.Provider>
  );
}

export function useSubPos(): SubPosContextValue {
  const ctx = useContext(SubPosContext);
  if (!ctx) throw new Error('useSubPos must be inside SubPosProvider');
  return ctx;
}
