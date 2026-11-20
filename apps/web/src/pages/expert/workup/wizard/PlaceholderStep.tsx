import { WORKUP_STEPS } from '@genyun/shared';
import { App, Button } from 'antd';
import { Link } from 'react-router';
import { ApiError } from '../../../../api/request';
import { useSaveStepsDone } from '../../../../api/workup';
import { gy, type, weight } from '../../../../theme/tokens';
import { Card, link14, UseCard } from './parts';
import type { StepProps } from './types';

// 第 3–5 步还没换新样式：先用原来的整理页（对应模块），这里只管往下走
const OLD_MODULE: Record<number, { module: string; text: string }> = {
  3: { module: 'equipment', text: '生产设备、原辅材料、建构筑物和工艺流程' },
  4: { module: 'supplies', text: '消防设施、应急物资、急救药箱和客户图纸' },
  5: { module: 'risks', text: '危险源辨识、适用范围和预案附图' },
};

export function PlaceholderStep({ taskId, workup, frame, onGo, latestVersion, step }: StepProps & { step: 3 | 4 | 5 }) {
  const { message } = App.useApp();
  const saveDone = useSaveStepsDone(taskId);
  const old = OLD_MODULE[step]!;
  const oldUrl = `?view=workup-old&module=${old.module}`;

  const next = async () => {
    if (step === 5) {
      onGo(6);
      return;
    }
    try {
      if ((workup.data.stepsDone ?? 0) < step) await saveDone.mutateAsync({ version: latestVersion(), stepsDone: step });
      onGo(step + 1);
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : '保存失败，请检查网络后重试');
    }
  };

  const main = (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h1 style={{ margin: 0, ...type.pageTitle, fontWeight: weight.strong, color: gy.text }}>{WORKUP_STEPS[step - 1]}</h1>
      </div>
      <Card title="这一步正在换新样式，先用原来的整理页">
        <span style={{ ...type.body, color: gy.secondary }}>在原来的整理页里核对{old.text}。核对完回到这里继续下一步。</span>
        <Link to={oldUrl} style={{ ...link14, alignSelf: 'flex-start' }}>
          打开原来的整理页
        </Link>
      </Card>
    </>
  );

  return frame({
    main,
    side: <UseCard lines={['原来整理页里的改动和这里是同一份，不用重复核对。']} />,
    note: `第 ${step} 步，共 5 步`,
    actions: (
      <>
        <Button onClick={() => onGo(step - 1)}>上一步</Button>
        <Button type="primary" loading={saveDone.isPending} onClick={() => void next()}>
          {step === 5 ? '去确认并生成' : `下一步：${WORKUP_STEPS[step]}`}
        </Button>
      </>
    ),
  });
}
