import { UPLOAD_RULES, fileRejectionReason, type IntakeFileSlot, type IntakeView } from '@genyun/shared';
import { useQueryClient } from '@tanstack/react-query';
import { App } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { UploadAbortedError, intakeKey, uploadIntakeFile } from '../../../api/intake';
import { ApiError } from '../../../api/request';
import { taskKey } from '../../../api/tasks';

// 上传过程（12 页 S02）：每个文件一条，显示进度、可以取消；传完把新的资料状态放进缓存。
// 网络断了可以重试；服务端拒收（压缩包、格式、大小）只能移除。

export type UploadState =
  | { kind: 'uploading'; percent: number }
  | { kind: 'saving' }
  | { kind: 'failed'; message: string }
  | { kind: 'rejected'; message: string };

export interface UploadEntry {
  key: number;
  slot: IntakeFileSlot;
  file: File;
  state: UploadState;
}

export const NETWORK_FAILED = '没传上去，网络可能断了。请再试一次。';
/** 同一栏里传了内容完全一样的图：服务器没再存，提示 3 秒，不多出一行 */
export const DUPLICATE_NOTICE = '这张已经传过了';
export const SERVER_FAILED = '没传上去，耕云服务暂时出了问题，请稍后再试。';

/**
 * 上传出错时这一行怎么说（S02）：断网、超时说网络；服务器 5xx 说耕云服务的问题（都能重试）；
 * 4xx 是服务器拒收（压缩包、格式、大小），照旧显示服务器给的原因，只能移除
 */
export function uploadFailure(err: unknown): UploadState {
  if (err instanceof ApiError && err.status >= 400 && err.status < 500) return { kind: 'rejected', message: err.message };
  if (err instanceof ApiError && err.status >= 500) return { kind: 'failed', message: SERVER_FAILED };
  return { kind: 'failed', message: NETWORK_FAILED };
}

const ruleOf = (slot: IntakeFileSlot) => (slot === 'data_sheet' ? 'intake_sheet' : 'intake_drawing');

/** 先在浏览器里查一遍格式和大小，拒收的不用等传完 */
async function localRejection(slot: IntakeFileSlot, file: File): Promise<string | null> {
  const rule = ruleOf(slot);
  const max = UPLOAD_RULES[rule].maxBytes;
  if (file.size > max) {
    return `${file.name} 为 ${(file.size / 1024 / 1024).toFixed(1)} MB，超过单个文件 ${max / 1024 / 1024} MB 限制。请压缩后重新选择`;
  }
  try {
    return fileRejectionReason(rule, file.name, new Uint8Array(await file.arrayBuffer()));
  } catch {
    return null;
  }
}

export function useUploads(taskId: string) {
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const aborts = useRef(new Map<number, () => void>());
  const nextKey = useRef(1);

  useEffect(() => {
    const map = aborts.current;
    return () => map.forEach((abort) => abort());
  }, []);

  const patch = useCallback((key: number, state: UploadState | null) => {
    setEntries((list) =>
      state === null ? list.filter((e) => e.key !== key) : list.map((e) => (e.key === key ? { ...e, state } : e)),
    );
  }, []);

  const run = useCallback(
    async (key: number, slot: IntakeFileSlot, file: File) => {
      patch(key, { kind: 'uploading', percent: 0 });
      const rejected = await localRejection(slot, file);
      if (rejected) {
        patch(key, { kind: 'rejected', message: rejected });
        return;
      }
      const { done, abort } = uploadIntakeFile(
        taskId,
        slot,
        file,
        (percent) => patch(key, { kind: 'uploading', percent }),
        () => patch(key, { kind: 'saving' }),
      );
      aborts.current.set(key, abort);
      try {
        const { duplicate, ...view } = await done;
        queryClient.setQueryData<IntakeView>(intakeKey(taskId), view);
        patch(key, null);
        if (duplicate) void message.info(DUPLICATE_NOTICE, 3);
      } catch (err) {
        if (err instanceof UploadAbortedError) patch(key, null);
        else patch(key, uploadFailure(err));
      } finally {
        aborts.current.delete(key);
        // 资料表格可能按表格改了企业名称：连任务详情（页头的企业名）一起刷新
        void queryClient.invalidateQueries({ queryKey: slot === 'data_sheet' ? taskKey(taskId) : intakeKey(taskId) });
      }
    },
    [patch, queryClient, taskId, message],
  );

  const start = useCallback(
    (slot: IntakeFileSlot, files: File[]) => {
      for (const file of files) {
        const key = nextKey.current++;
        setEntries((list) => [...list, { key, slot, file, state: { kind: 'uploading', percent: 0 } }]);
        void run(key, slot, file);
      }
    },
    [run],
  );

  const cancel = useCallback((key: number) => aborts.current.get(key)?.(), []);
  const retry = useCallback(
    (entry: UploadEntry) => void run(entry.key, entry.slot, entry.file),
    [run],
  );
  const dismiss = useCallback((key: number) => patch(key, null), [patch]);

  return { entries, start, cancel, retry, dismiss };
}
