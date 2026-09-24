import { useEffect, useState } from 'react';

/** Seconds remaining until `expiresAt`, ticking once a second. Never negative. */
export function useCountdown(expiresAt: number | null): number {
  const [left, setLeft] = useState(() =>
    expiresAt ? Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)) : 0
  );

  useEffect(() => {
    if (!expiresAt) return;

    const tick = () => setLeft(Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  return left;
}

export function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
