import { CheckOutlined } from '@ant-design/icons';
import { monthDay } from '@genyun/shared';
import { Button, Drawer, Skeleton } from 'antd';
import { type ReactNode } from 'react';
import { useMissingList } from '../../../api/workup';
import { linkButton } from '../../../components/ui';
import { useMissingCopy } from '../../../components/useMissingCopy';
import { gy, stage, type, weight } from '../../../theme/tokens';

// 缺项清单（Paper 13 页 E2-5b「复制缺项清单」、S02 查看缺项、S04 复制以后）。复制用 components/useMissingCopy。

/** 向导每一步顶上：已标成「等客户补资料」 */
export function AwaitingBanner({ since }: { since: string }) {
  return (
    <div role="note" aria-label="等客户补资料" style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '12px 16px', borderRadius: 8, background: stage.action.bg }}>
      <span style={{ ...type.body, fontWeight: weight.strong, color: stage.action.color }}>已标成「等客户补资料」· {dayTime(since)}</span>
      <span style={{ ...type.body, color: gy.secondary }}>
        客户发来后，您在对应那一步代客户填上或传上，清单里的都补上了标记就自动取消。这期间资料照样能核对和修改。
      </span>
    </div>
  );
}

// 「11 月 18 日 16:05」
function dayTime(iso: string): string {
  const clock = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  return `${monthDay(iso)} ${clock}`;
}

// 已等几天（按北京时间的日期算）
function waitedDays(iso: string): number {
  const day = (d: Date) => Math.floor((d.getTime() + 8 * 3600_000) / 86_400_000);
  return Math.max(0, day(new Date()) - day(new Date(iso)));
}

/** S02 查看缺项：任务中心「查看缺项」和第 5 步打开 */
export function MissingDrawer({
  taskId,
  enterpriseName,
  onClose,
  onOpenTask,
  onGoStep,
}: {
  taskId: string | null;
  enterpriseName?: string;
  onClose: () => void;
  onOpenTask?: () => void;
  // 去第 N 步（在向导里直接翻页；任务中心里打开任务的那一步）
  onGoStep: (step: number) => void;
}) {
  const view = useMissingList(taskId);
  const { copy, node } = useMissingCopy();
  const list = view.data?.list ?? null;
  const items = list?.items ?? [];
  const open = items.filter((i) => !i.filledAt);
  const filled = items.length - open.length;
  const name = enterpriseName ?? view.data?.companyName ?? '';

  const again = () =>
    void copy({
      companyName: view.data?.companyName ?? name,
      addresses: view.data?.addresses,
      contact: view.data?.contact ?? undefined,
      items: open,
    });

  let content: ReactNode;
  if (view.isPending) content = <Skeleton active paragraph={{ rows: 4 }} title={false} />;
  else if (!list) content = <span style={{ ...type.body, color: gy.secondary }}>这个任务还没有复制过缺项清单。</span>;
  else
    content = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {view.data?.awaitingSince && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '12px 16px', borderRadius: 8, background: stage.action.bg }}>
            <span style={{ ...type.body, fontWeight: weight.strong, color: stage.action.color }}>等客户补资料</span>
            <span style={{ ...type.body, color: gy.secondary }}>清单已交给客服联系客户。客户发来后，您在对应那一步代客户填上或传上，全部补齐后标记自动取消。</span>
          </div>
        )}
        <ul aria-label="缺项" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {items.map((i) => (
            <li
              key={i.key}
              data-filled={i.filledAt ? 'true' : undefined}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: `1px solid ${gy.split}` }}
            >
              <span
                aria-hidden
                style={{
                  width: 20,
                  height: 20,
                  flexShrink: 0,
                  borderRadius: 10,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  ...type.caption,
                  color: stage.done.color,
                  background: i.filledAt ? stage.done.bg : gy.surface,
                  border: i.filledAt ? 'none' : `1px solid ${gy.controlLine}`,
                }}
              >
                {i.filledAt && <CheckOutlined />}
              </span>
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <span style={{ ...type.body, color: i.filledAt ? gy.tertiary : gy.text, textDecoration: i.filledAt ? 'line-through' : undefined }}>{i.label}</span>
                <span style={{ ...type.caption, color: gy.tertiary }}>
                  第 {i.step} 步
                  {i.filledAt ? ` · ${monthDay(i.filledAt)}您已补上` : i.required ? ' · 必备，没有不能生成' : ''}
                </span>
              </span>
              {!i.filledAt && (
                <button type="button" style={{ ...linkButton, ...type.body }} onClick={() => onGoStep(i.step)}>
                  去第 {i.step} 步
                </button>
              )}
            </li>
          ))}
        </ul>
        <span style={{ ...type.caption, color: gy.tertiary }}>
          还差 {open.length} 项 · {filled} 项已补上
        </span>
      </div>
    );

  return (
    <Drawer
      open={taskId !== null}
      onClose={onClose}
      size={520}
      title={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ ...type.subtitle, fontWeight: weight.strong, color: gy.text }}>
            {name} · 缺 {items.length} 项
          </span>
          {list && (
            <span style={{ ...type.caption, fontWeight: weight.normal, color: gy.tertiary }}>
              {[view.data?.taskNumber, `${monthDay(list.at)}列出`, view.data?.awaitingSince ? `已等 ${waitedDays(view.data.awaitingSince)} 天` : '标记已取消']
                .filter(Boolean)
                .join(' · ')}
            </span>
          )}
        </div>
      }
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button disabled={!list || open.length === 0} onClick={again}>
            再复制一次清单
          </Button>
          {onOpenTask && (
            <Button type="primary" onClick={onOpenTask}>
              打开任务
            </Button>
          )}
        </div>
      }
    >
      {content}
      {node}
    </Drawer>
  );
}
