/**
 * Tiny decoupled pub/sub so the low-level sync queue can announce "something
 * local changed" without importing the scheduler (which would create a cycle:
 * scheduler → syncApi → syncQueue → scheduler).
 *
 * The queue calls emitLocalChange() after enqueue(); the scheduler subscribes
 * and runs a (debounced) sync so a sale on THIS device is pushed to the cloud
 * immediately instead of waiting for a reload or another device's activity.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

export function onLocalChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitLocalChange() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // a bad listener must not break enqueue()
    }
  }
}
