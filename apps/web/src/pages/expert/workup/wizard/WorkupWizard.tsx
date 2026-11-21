import { WORKUP_STEPS, workupStepsDone } from '@genyun/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from 'antd';
import { useCallback, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { workupKey, type Workup } from '../../../../api/workup';
import { ActionBar } from '../../../../components/ActionBar';
import { linkButton } from '../../../../components/ui';
import { WizardLayout } from '../../../../layouts/WizardLayout';
import { gy, layout, type, weight } from '../../../../theme/tokens';
import { BasicStep } from './BasicStep';
import { OrganizationStep } from './OrganizationStep';
import { clockOf, MAIN_WIDTH, SIDE_WIDTH } from './parts';
import { PlaceholderStep } from './PlaceholderStep';
import { ProductionStep } from './ProductionStep';
import { ResourcesStep } from './ResourcesStep';
import type { StepFrame, StepProps } from './types';
import { useAutosave } from './useAutosave';

/** ?view=workup 时打开第几步：带了 step 就用它，否则接着上次走到的下一步 */
export function wizardStepOf(param: string | null, workup: Workup): number {
  const n = Number(param);
  if (Number.isInteger(n) && n >= 1 && n <= 5) return n;
  return Math.min(workupStepsDone(workup.data) + 1, 5);
}

// 资料核对向导（13 页 E2）：铺满整个窗口，盖住工作台的侧栏和顶栏；
// 顶栏是五步阶段条、保存状态和「返回任务中心」，底栏是这一步的说明和按钮。
// 自动保存在外壳里，各步共用；别人刚改过（409）时重新读取并重置当前这一步
export function WorkupWizard({ taskId, enterpriseName, workup }: { taskId: string; enterpriseName: string; workup: Workup }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [resetKey, setResetKey] = useState(0);
  const scroller = useRef<HTMLDivElement | null>(null);
  const step = wizardStepOf(params.get('step'), workup);
  const page = step === 3 && params.get('page') === '2' ? 2 : 1;

  const onStale = useCallback(async () => {
    await client.invalidateQueries({ queryKey: workupKey(taskId) });
    setResetKey((k) => k + 1);
  }, [client, taskId]);
  const autosave = useAutosave({ onStale });
  const latestVersion = useCallback(() => client.getQueryData<Workup>(workupKey(taskId))?.version ?? workup.version, [client, taskId, workup.version]);

  const onGo = (n: number, p?: number) => {
    if (n > 5) setParams({ view: 'confirm' });
    else setParams({ view: 'workup', step: String(n), ...(p && p > 1 ? { page: String(p) } : {}) });
    scroller.current?.scrollTo({ top: 0 });
  };
  const leave = async () => {
    await autosave.flush();
    navigate('/expert');
  };

  const status = autosave.status;
  const failed = status.kind === 'failed';
  const statusText =
    status.kind === 'saving'
      ? '保存中…'
      : status.kind === 'saved'
        ? `已自动保存 ${clockOf(status.at)}`
        : failed
          ? '没保存上，网络断了'
          : workup.updatedByName
            ? `已自动保存 ${clockOf(workup.updatedAt)}`
            : '还没有修改';

  const headerExtra = (
    <>
      <span role="status" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, ...type.caption, color: failed ? gy.error : gy.tertiary, whiteSpace: 'nowrap' }}>
        {failed && <span aria-hidden style={{ width: 6, height: 6, borderRadius: 3, background: gy.error }} />}
        {statusText}
        {failed && (
          <button type="button" style={{ ...linkButton, ...type.caption }} onClick={autosave.retry}>
            重试
          </button>
        )}
      </span>
      <Button onClick={() => void leave()}>返回任务中心</Button>
    </>
  );

  const frame = ({ main, side, note, actions }: StepFrame) => (
    <div ref={scroller} style={{ position: 'fixed', inset: 0, zIndex: 100, overflow: 'auto', background: gy.canvas }}>
      <WizardLayout
        title="资料核对"
        enterpriseName={enterpriseName}
        stages={WORKUP_STEPS}
        current={step - 1}
        headerExtra={headerExtra}
        paddingTop={24}
        paddingBottom={32}
        sideWidth={280}
        footer={
          // 设计稿里这一步的说明靠左、按钮靠右：放进操作栏最左的位置
          <ActionBar danger={<span style={{ ...type.body, color: gy.secondary }}>{note}</span>} width={layout.wizard}>
            {actions}
          </ActionBar>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {failed && (
            <div
              role="alert"
              style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 16px', borderRadius: 8, background: gy.errorBg, border: `1px solid #FDA29B` }}
            >
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ ...type.body, fontWeight: weight.strong, color: gy.error }}>{clockOf(status.since)} 以后的改动还没保存</span>
                <span style={{ ...type.caption, color: gy.secondary }}>先别关页面。网络恢复后会自动补存，也可以点「重试」。</span>
              </div>
              <Button onClick={autosave.retry}>重试</Button>
            </div>
          )}
          <div style={{ display: 'flex', gap: 32, alignItems: 'flex-start' }}>
            <div style={{ width: MAIN_WIDTH, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>{main}</div>
            <aside aria-label="参考" style={{ width: SIDE_WIDTH, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 16, position: 'sticky', top: 88 }}>
              {side}
            </aside>
          </div>
        </div>
      </WizardLayout>
    </div>
  );

  const props: StepProps = {
    taskId,
    workup,
    autosave,
    customerText: workup.flow === 'intake' ? '客户表格' : '客户填写',
    frame,
    onGo,
    latestVersion,
    page,
  };
  const key = `${step}-${resetKey}`;
  if (step === 1) return <BasicStep key={key} {...props} />;
  if (step === 2) return <OrganizationStep key={key} {...props} />;
  // 第 3 步两页共用一份本地状态（翻页不重置），所以 key 不带页码
  if (step === 3) return <ProductionStep key={key} {...props} />;
  if (step === 4) return <ResourcesStep key={key} {...props} />;
  return <PlaceholderStep key={key} {...props} step={5} />;
}
