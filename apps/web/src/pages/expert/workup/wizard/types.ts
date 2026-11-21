import type { ReactElement, ReactNode } from 'react';
import type { Workup } from '../../../../api/workup';
import type { Autosave } from './useAutosave';

// 每一步交给外壳排版的几块：左栏（728）、右栏（320）、底栏说明和按钮
export interface StepFrame {
  main: ReactNode;
  side: ReactNode;
  note: ReactNode;
  actions: ReactNode;
}

export interface StepProps {
  taskId: string;
  workup: Workup;
  autosave: Autosave;
  /** 来源标签上客户那份的叫法：新流程「客户表格」，老流程「客户填写」 */
  customerText: string;
  frame: (f: StepFrame) => ReactElement;
  /** 去第几步（1–5）；第 3 步分两页，page 为第几页 */
  onGo: (step: number, page?: number) => void;
  /** 第 3 步当前第几页（地址栏 page，默认第 1 页） */
  page: number;
  /** 存的时候用的版本号：取缓存里最新的（同一步连着存好几次） */
  latestVersion: () => number;
}
