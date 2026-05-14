import { useCallback, useRef, useState } from 'react';

export function useTapCounter(target: number, onTarget: () => void, timeoutMs = 2000) {
  const [count, setCount] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const tap = useCallback(() => {
    clearTimeout(timer.current);
    setCount((prev) => {
      const next = prev + 1;
      if (next >= target) {
        onTarget();
        return 0;
      }
      timer.current = setTimeout(() => setCount(0), timeoutMs);
      return next;
    });
  }, [target, onTarget, timeoutMs]);

  const reset = useCallback(() => {
    clearTimeout(timer.current);
    setCount(0);
  }, []);

  return { tap, count, reset };
}
