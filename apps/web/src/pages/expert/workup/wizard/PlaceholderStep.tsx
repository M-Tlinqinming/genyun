import { WORKUP_STEPS } from '@genyun/shared';
import { App, Button } from 'antd';
import { Link } from 'react-router';
import { ApiError } from '../../../../api/request';
import { useSaveStepsDone } from '../../../../api/workup';
import { gy, type, weight } from '../../../../theme/tokens';
import { Card, link14, UseCard } from './parts';
import type { StepProps } from './types';

// 第 5 步还没换新样式：先用原来的整理页，这里列出这一步要核对的几类，每类直达原来整理页的对应模块
const OLD_MODULES: Record<number, [module: string, label: string][]> = {
  3: [
    ['equipment', '设备清单'],
    ['special', '特种设备'],
    ['materials', '原辅材料'],
    ['buildings', '建构筑物'],
    ['process', '工艺流程'],
  ],
  4: [
    ['fire', '消防设施'],
    ['supplies', '应急物资'],
    ['firstAid', '急救药箱'],
    ['figures', '图件'],
  ],
  5: [
    ['risks', '危险源辨识'],
    ['scope', '适用范围'],
  ],
};

export function PlaceholderStep({ taskId, workup, frame, onGo, latestVersion, step }: StepProps & { step: 3 | 4 | 5 }) {
  const { message } = App.useApp();
  const saveDone = useSaveStepsDone(taskId);
  const modules = OLD_MODULES[step]!;

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
        <span style={{ ...type.body, color: gy.secondary }}>
          在原来的整理页里核对{modules.map(([, label]) => label).join('、')}。点下面任一类直接打开，核对完回到这里继续下一步。
        </span>
        <nav aria-label="打开原来的整理页" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 20px' }}>
          {modules.map(([module, label]) => (
            <Link key={module} to={`?view=workup-old&module=${module}`} style={link14}>
              {label}
            </Link>
          ))}
        </nav>
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
