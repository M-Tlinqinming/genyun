import { App } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../../../api/request';

// 资料核对向导的自动保存：改完停一会儿（800 毫秒）整步保存一次；正在保存时再改的，等这次存完接着存最新的。
// 网络断了（或服务出错）记下第一次没存上的时间，页头变红、内容上方出提示条，可以点「重试」，网络恢复时自动补存。
// 别人刚改过（409）：提示后由页面重新读取、重置这一步；后台说内容不对（其他 4xx）：直接提示后台的话。

export type SaveStatus =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: Date }
  | { kind: 'failed'; since: Date };

type Task = () => Promise<unknown>;

export interface Autosave {
  status: SaveStatus;
  /** 记下最新内容，停一会儿后保存 */
  schedule: (task: Task) => void;
  /** 立刻把没存的存掉（点「下一步」前）；存上了返回 true */
  flush: (task?: Task) => Promise<boolean>;
  /** 没存上时再试一次 */
  retry: () => void;
  /** 还有没存上的改动 */
  dirty: boolean;
  /** 别人刚改过（409）：重新读取并重置当前这一步 */
  stale: () => Promise<void>;
}

const DELAY = 800;

export function useAutosave({ onStale }: { onStale: () => Promise<void> | void }): Autosave {
  const { message } = App.useApp();
  const [status, setStatus] = useState<SaveStatus>({ kind: 'idle' });
  const [dirty, setDirty] = useState(false);
  const pending = useRef<Task | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const running = useRef<Promise<boolean> | null>(null);
  const failedSince = useRef<Date | null>(null);
  const staleRef = useRef(onStale);
  staleRef.current = onStale;

  const run = useCallback(async (): Promise<boolean> => {
    // 上一次还在存：等它存完再存最新的
    if (running.current) await running.current.catch(() => false);
    const task = pending.current;
    if (!task) return failedSince.current === null;
    pending.current = null;
    setStatus({ kind: 'saving' });
    const attempt = (async () => {
      try {
        await task();
        failedSince.current = null;
        if (!pending.current) setDirty(false);
        setStatus({ kind: 'saved', at: new Date() });
        return true;
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          message.warning(err.message);
          failedSince.current = null;
          setDirty(false);
          setStatus({ kind: 'idle' });
          await staleRef.current();
          return false;
        }
        if (err instanceof ApiError && err.status > 0 && err.status < 500) {
          message.error(err.message);
          failedSince.current = null;
          setDirty(false);
          setStatus({ kind: 'idle' });
          return false;
        }
        // 断网或服务出错：留着这次的内容，之后补存（期间又改过的以新的为准）
        if (!pending.current) pending.current = task;
        failedSince.current ??= new Date();
        setStatus({ kind: 'failed', since: failedSince.current });
        return false;
      }
    })();
    running.current = attempt;
    const ok = await attempt;
    if (running.current === attempt) running.current = null;
    return ok;
  }, [message]);

  const schedule = useCallback(
    (task: Task) => {
      pending.current = task;
      setDirty(true);
      if (timer.current) clearTimeout(timer.current);
      // 正在显示「没保存上」时不自动重试，等网络恢复或点「重试」
      if (failedSince.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        void run();
      }, DELAY);
    },
    [run],
  );

  const flush = useCallback(
    async (task?: Task) => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      if (task) pending.current = task;
      if (!pending.current) {
        if (running.current) return running.current.catch(() => false);
        return failedSince.current === null;
      }
      return run();
    },
    [run],
  );

  const retry = useCallback(() => void run(), [run]);

  // 网络恢复时自动补存
  useEffect(() => {
    const online = () => {
      if (failedSince.current) void run();
    };
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, [run]);

  // 有没存上的改动时，关页面前浏览器会问一句
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const stale = useCallback(async () => {
    await staleRef.current();
  }, []);
  return { status, schedule, flush, retry, dirty, stale };
}
