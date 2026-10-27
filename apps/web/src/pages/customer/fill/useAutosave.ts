import { useCallback, useEffect, useRef, useState } from 'react';

export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

const RETRY_MS = 5000;

/**
 * 停止输入一段时间后自动保存。同一时间只发一次请求，保存期间又有改动就接着再存一次；
 * 失败后隔几秒重试。onError 返回 true 表示已处理（如别人刚改过、页面已重新读取），不再重试。
 */
export function useAutosave<T>(save: (data: T) => Promise<void>, onError: (err: unknown) => boolean, delay = 1000) {
  const [state, setState] = useState<SaveState>('idle');
  const [savedAt, setSavedAt] = useState<Date>();
  const latest = useRef<{ data: T } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const inFlight = useRef<Promise<void> | null>(null);
  const saveRef = useRef(save);
  const onErrorRef = useRef(onError);
  saveRef.current = save;
  onErrorRef.current = onError;

  const run = useCallback(async (): Promise<void> => {
    clearTimeout(timer.current);
    if (inFlight.current) await inFlight.current;
    const next = latest.current;
    if (!next) return;
    latest.current = null;
    setState('saving');
    let failed = false;
    const attempt = (async () => {
      try {
        await saveRef.current(next.data);
        setSavedAt(new Date());
        setState(latest.current ? 'pending' : 'saved');
      } catch (err) {
        if (onErrorRef.current(err)) {
          latest.current = null;
          setState('idle');
          return;
        }
        // 没有更新的改动时，把这次的内容放回去等重试
        latest.current ??= next;
        failed = true;
        setState('error');
      }
    })();
    inFlight.current = attempt;
    await attempt;
    inFlight.current = null;
    if (latest.current) timer.current = setTimeout(() => void run(), failed ? RETRY_MS : delay);
  }, [delay]);

  const schedule = useCallback(
    (data: T) => {
      latest.current = { data };
      setState((s) => (s === 'saving' ? s : 'pending'));
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void run(), delay);
    },
    [delay, run],
  );

  // 离开页面、上传执照前先把没存的存掉
  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (latest.current) await run();
    else if (inFlight.current) await inFlight.current;
  }, [run]);

  // 放弃没存的改动（页面已按最新内容重新显示时）
  const discard = useCallback(() => {
    clearTimeout(timer.current);
    latest.current = null;
  }, []);

  const dirty = state === 'pending' || state === 'saving' || state === 'error';
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return { state, savedAt, schedule, flush, discard };
}
