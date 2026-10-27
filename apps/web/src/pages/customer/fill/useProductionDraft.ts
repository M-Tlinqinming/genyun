import { productionStepSchema, type ChecklistItemKey, type ProductionStep } from '@genyun/shared';
import { useQueryClient } from '@tanstack/react-query';
import { App } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  isStale,
  linkItemFile,
  productionStepKey,
  saveProductionStep,
  unlinkItemFile,
  uploadFile,
  useProductionStep,
  type ProductionStepView,
} from '../../../api/profile';
import type { Task } from '../../../api/tasks';
import { useAutosave } from './useAutosave';

interface Options {
  // 读到内容后整理成页面用的样子（如设备表至少留一行空白）
  normalize?: (step: ProductionStep) => ProductionStep;
  // 每次改动前再调整一次（如填进空压机后预选压力容器「有」）
  adjust?: (prev: ProductionStep | null, next: ProductionStep) => ProductionStep;
}

// 第 3 步两页共用：读取、边填边自动保存、版本冲突时换成最新内容、逐份上传文件、离开前保存完
export function useProductionDraft(task: Task, options: Options = {}) {
  const query = useProductionStep(task.enterpriseId);
  const client = useQueryClient();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const opts = useRef(options);
  opts.current = options;

  const [step, setStep] = useState<ProductionStep | null>(null);
  const [fileNames, setFileNames] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const saved = useRef<ProductionStepView | null>(null);
  const current = useRef<ProductionStep | null>(null);

  const remember = useCallback(
    (view: ProductionStepView) => {
      saved.current = view;
      setFileNames((names) => ({ ...names, ...view.fileNames }));
      client.setQueryData(productionStepKey(view.enterpriseId), view);
    },
    [client],
  );

  const apply = useCallback(
    (view: ProductionStepView) => {
      remember(view);
      const next = opts.current.normalize?.(view.step) ?? view.step;
      current.current = next;
      setStep(next);
    },
    [remember],
  );

  useEffect(() => {
    if (!query.data || saved.current) return;
    apply(query.data);
  }, [query.data, apply]);

  const autosave = useAutosave<ProductionStep>(
    async (data) => {
      remember(await saveProductionStep(task.enterpriseId, { version: saved.current!.version, step: data }));
    },
    (err) => {
      if (!isStale(err)) return false;
      message.warning(err.message);
      void query.refetch().then((r) => r.data && apply(r.data));
      return true;
    },
  );

  const update = (next: ProductionStep) => {
    next = opts.current.adjust?.(current.current, next) ?? next;
    current.current = next;
    setStep(next);
    if (productionStepSchema.safeParse(next).success) autosave.schedule(next);
  };

  const leave = async (to: string) => {
    setLeaving(true);
    try {
      await autosave.flush();
      navigate(to);
    } catch {
      message.error('还有内容没保存成功，请稍后再试');
    } finally {
      setLeaving(false);
    }
  };

  // 逐份上传（每次保存版本加 1，同时发会互相冲突）：传完把文件 ID 写进内容并立即保存；
  // 给了资料项的同时挂到任务对应的资料项上
  const uploads = useRef(Promise.resolve());
  const upload = (
    key: string,
    file: File,
    rule: 'material' | 'image_or_pdf',
    attach: (s: ProductionStep, fileId: string) => ProductionStep,
    itemKey?: ChecklistItemKey,
  ) => {
    setUploading(key);
    const next = uploads.current.then(async () => {
      try {
        await autosave.flush();
        const fileId = await uploadFile(task.orgId, file, rule);
        if (itemKey) await linkItemFile(task.id, itemKey, fileId);
        setFileNames((names) => ({ ...names, [fileId]: file.name }));
        update(attach(current.current!, fileId));
        await autosave.flush();
      } catch (err) {
        message.error(err instanceof Error ? `${file.name}：${err.message}` : '上传失败，请稍后重试');
      }
    });
    uploads.current = next;
    void next.then(() => {
      if (uploads.current === next) setUploading(null);
    });
  };

  // 从资料项上取下文件，再从内容里去掉
  const removeLinked = async (
    itemKey: ChecklistItemKey,
    fileId: string,
    detach: (s: ProductionStep, fileId: string) => ProductionStep,
  ) => {
    try {
      await autosave.flush();
      await unlinkItemFile(task.id, itemKey, fileId);
      update(detach(current.current!, fileId));
      await autosave.flush();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '移除失败，请稍后重试');
    }
  };

  return {
    step,
    // 最近一次保存后的服务端内容（经营范围等）
    saved,
    fileNames,
    uploading,
    leaving,
    autosave,
    update,
    leave,
    upload,
    removeLinked,
  };
}
