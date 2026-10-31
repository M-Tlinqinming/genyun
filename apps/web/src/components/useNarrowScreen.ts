import { useSyncExternalStore } from 'react';

// 屏幕不足 1440（如 1366×768）：和 global.css 里三栏工作台收窄的断点一致
const QUERY = '(max-width: 1439.98px)';

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

export function useNarrowScreen(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches);
}
