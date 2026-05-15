import { useEffect, useState } from 'react';
import { syncApi, type PullResult } from './syncApi';
import { onLocalChange } from './syncSignal';

/**
 * Module-level sync orchestrator.
 *
 * Guarantees:
 *  - Single-flight: only ONE sync runs at a time. Calls during an in-flight
 *    sync are coalesced into a single trailing run.
 *  - Debounced: bursty triggers (WebSocket notifications, online events,
 *    rapid checkouts) collapse into one run within DEBOUNCE_MS.
 *  - Exponential backoff: consecutive failures back off up to MAX_BACKOFF_MS
 *    so a dead backend can't be hammered.
 *
 * This replaces per-hook scheduling, which historically leaked intervals and
 * caused the "tab open → API stampede → freeze" bug.
 */

const DEBOUNCE_MS = 800;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

type Listener = (state: SchedulerState) => void;

export interface SchedulerState {
  isSyncing: boolean;
  lastSyncError: string | null;
  lastConflicts: string[];
  lastSyncedAt: string | null;
}

let state: SchedulerState = {
  isSyncing: false,
  lastSyncError: null,
  lastConflicts: [],
  lastSyncedAt: null,
};

const listeners = new Set<Listener>();

let inFlight = false;
let pendingRun = false;
let pendingFull = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let backoffTimer: ReturnType<typeof setTimeout> | null = null;
let consecutiveFailures = 0;

function emit() {
  for (const listener of listeners) listener(state);
}

function setState(patch: Partial<SchedulerState>) {
  state = { ...state, ...patch };
  emit();
}

export function subscribeSync(listener: Listener): () => void {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

export function getSyncState(): SchedulerState {
  return state;
}

async function execute() {
  if (inFlight) {
    // A run is already happening — mark that another is wanted afterwards.
    pendingRun = true;
    return;
  }

  inFlight = true;
  const full = pendingFull;
  pendingFull = false;
  pendingRun = false;
  setState({ isSyncing: true, lastSyncError: null });

  try {
    const result: PullResult | null = full
      ? await syncApi.forceFullSync()
      : await syncApi.syncNow();

    consecutiveFailures = 0;
    setState({
      isSyncing: false,
      lastConflicts: result?.conflicts ?? [],
      lastSyncedAt: result?.syncedAt ?? state.lastSyncedAt,
    });
  } catch (error) {
    consecutiveFailures += 1;
    setState({
      isSyncing: false,
      lastSyncError: error instanceof Error ? error.message : 'Sync failed',
    });

    // Schedule a backed-off retry instead of spinning.
    const delay = Math.min(BASE_BACKOFF_MS * 2 ** (consecutiveFailures - 1), MAX_BACKOFF_MS);
    if (backoffTimer) clearTimeout(backoffTimer);
    backoffTimer = setTimeout(() => {
      backoffTimer = null;
      void execute();
    }, delay);
  } finally {
    inFlight = false;
    if (pendingRun) {
      pendingRun = false;
      void execute();
    }
  }
}

/**
 * Request a sync. Safe to call as often as you like — calls are debounced and
 * single-flighted. `full` forces a complete re-pull from cloud.
 */
export function requestSync(options: { full?: boolean; immediate?: boolean } = {}) {
  if (options.full) pendingFull = true;

  if (options.immediate) {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    void execute();
    return;
  }

  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void execute();
  }, DEBOUNCE_MS);
}

// Any local mutation (sale, product, category, ...) enqueues a sync item and
// emits this signal — push it to the cloud right away (debounced).
onLocalChange(() => requestSync());

/** Cancel any pending debounced/backoff sync (used on teardown). */
export function cancelScheduledSync() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (backoffTimer) {
    clearTimeout(backoffTimer);
    backoffTimer = null;
  }
}

/**
 * Lightweight React hook — reads scheduler state only.
 * Safe to call in any component without triggering a second boot sequence.
 * Does NOT create WebSockets, intervals, or call cancelScheduledSync on unmount.
 */
export function useSyncStatus(): SchedulerState & { isOnline: boolean } {
  const [sched, setSched] = useState<SchedulerState>(getSyncState);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const unsub = subscribeSync(setSched);
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      unsub();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return { ...sched, isOnline };
}
