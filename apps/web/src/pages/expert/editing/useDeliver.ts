import type { DraftKind, PublishView } from '@genyun/shared';
import { useQueryClient } from '@tanstack/react-query';
import { App } from 'antd';
import { useEffect, useState } from 'react';
import { publicationKey, publish, queryPublication, usePublication } from '../../../api/publish';
import { ApiError } from '../../../api/request';
import { reviewKey } from '../../../api/review';

// 定稿并交付的逻辑（审核结论页签和已交付页共用）。
// 每次交付带页面生成的 publishId（存在 sessionStorage，按任务和这一批分开存，刷新页面也还在）：
// 连接中断、超时时不知道后台有没有交付成功，只给「查询交付结果」，不直接重发；
// 查到后台没收到过，才用同一个 publishId 重新交付（后台按 publishId 只算一次）

interface Pending {
  publishId: string;
  at: string;
}
export const deliverStorageKey = (taskId: string, batchId: string) => `genyun.publish.${taskId}.${batchId}`;
function readPending(key: string): Pending | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Pending) : null;
  } catch {
    return null;
  }
}
function writePending(key: string, p: Pending | null) {
  try {
    if (p) sessionStorage.setItem(key, JSON.stringify(p));
    else sessionStorage.removeItem(key);
  } catch {
    // 无痕模式等存不了：只是刷新后不能接着查询，不影响交付本身
  }
}

/** 交付请求没收到回复（断网、超时、网关出错）：结果不确定 */
export const uncertain = (err: unknown) => !(err instanceof ApiError) || err.status === 0 || err.status >= 500;

/**
 * idle = 可以交付；sending = 请求还没回来；unknown = 没收到回复，结果没确认；
 * publishing = 后台正在交付；failed = 最近一次（重新打开之后的）没有成功；done = 已交付
 */
export type DeliverStatus = 'idle' | 'sending' | 'unknown' | 'publishing' | 'failed' | 'done';
/** 一次交付请求的结果 */
export type DeliverOutcome = 'done' | 'refused' | 'unknown' | 'publishing';

export function deliverStatusOf(view: PublishView | undefined, phase: 'idle' | 'sending' | 'unknown'): DeliverStatus {
  if (phase !== 'idle') return phase;
  const a = view?.attempt;
  if (view?.delivered) return 'done';
  if (a?.status === 'publishing') return 'publishing';
  if (a?.status === 'failed') return 'failed';
  return 'idle';
}

export function useDeliver(taskId: string) {
  const publication = usePublication(taskId);
  const client = useQueryClient();
  const { message } = App.useApp();
  const [phase, setPhase] = useState<'idle' | 'sending' | 'unknown'>('idle');
  const [pending, setPending] = useState<Pending | null>(null);
  const [querying, setQuerying] = useState(false);
  const view = publication.data;
  const key = view ? deliverStorageKey(taskId, view.batchId) : null;

  // 上次交付没收到结果就离开了：回来时接着按同一次交付查询
  useEffect(() => {
    if (!key || !view) return;
    const saved = readPending(key);
    if (!saved) return;
    if (view.attempt?.publishId === saved.publishId) {
      // 后台有这一次的记录：按后台结果显示，不用再记着
      writePending(key, null);
      return;
    }
    setPending(saved);
    setPhase((p) => (p === 'idle' ? 'unknown' : p));
    // 只在进页面时看一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const set = (next: PublishView) => {
    client.setQueryData(publicationKey(taskId), next);
    void client.invalidateQueries({ queryKey: reviewKey(taskId) });
  };

  /** 交付：publishId 用新的（重新交付）或结果没确认时的那一个 */
  const deliver = async (input: { publishId: string; versions: Record<DraftKind, number>; updateNote?: string }): Promise<DeliverOutcome> => {
    if (!view || !key) return 'refused';
    const p = { publishId: input.publishId, at: pending?.publishId === input.publishId ? pending.at : new Date().toISOString() };
    writePending(key, p);
    setPending(p);
    setPhase('sending');
    try {
      const next = await publish(taskId, {
        publishId: input.publishId,
        batchId: view.batchId,
        versions: input.versions,
        ...(input.updateNote !== undefined ? { updateNote: input.updateNote } : {}),
      });
      writePending(key, null);
      set(next);
      setPhase('idle');
      return next.attempt?.status === 'publishing' ? 'publishing' : 'done';
    } catch (err) {
      if (uncertain(err)) {
        setPhase('unknown');
        return 'unknown';
      }
      // 后台明确拒绝了：这一次没有交付
      writePending(key, null);
      setPhase('idle');
      const body = (err as ApiError).body as { view?: PublishView; reason?: string } | null;
      if (body?.view) set(body.view);
      else void client.invalidateQueries({ queryKey: publicationKey(taskId) });
      if (body?.view?.attempt?.status === 'publishing') return 'publishing';
      message.warning((err as Error).message);
      return 'refused';
    }
  };

  /** 结果没确认时：按同一个 publishId 查询 */
  const check = async () => {
    if (!pending || !key) return;
    setQuerying(true);
    try {
      const next = await queryPublication(taskId, pending.publishId);
      writePending(key, null);
      set(next);
      setPhase('idle');
      if (next.attempt?.publishId !== pending.publishId) {
        // 后台没收到过这一次：可以放心重新交付（仍用同一个 publishId）
        message.info('后台没有收到这次交付，三份文稿还没有交付，可以重新交付');
      } else {
        setPending(null);
      }
    } catch {
      message.error('还是连不上耕云，暂时查不到交付结果，请稍后再查询');
    } finally {
      setQuerying(false);
    }
  };

  return {
    publication,
    view,
    status: deliverStatusOf(view, phase),
    /** 结果没确认、后台又没收到过的那一次：重新交付时用同一个 publishId */
    pendingId: pending?.publishId ?? null,
    querying,
    deliver,
    check,
  };
}
