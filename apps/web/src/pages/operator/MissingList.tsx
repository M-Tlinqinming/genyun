import { monthDay, type MissingItem } from '@genyun/shared';
import { Button, Skeleton } from 'antd';
import type { ReactNode } from 'react';
import { useOperatorMissingList, type OperatorTaskDetail } from '../../api/operator';
import { linkButton } from '../../components/ui';
import { useMissingCopy } from '../../components/useMissingCopy';
import { gy, type, weight } from '../../theme/tokens';

// 抽屉里「等客户补资料」的缺项清单（Paper 16 页 I04b）：外形
export function MissingList({
  count,
  items,
  action,
  hint,
}: {
  /** 还缺几项 */
  count: number | null;
  /** 逐项内容；不传就不画清单框 */
  items?: ReactNode;
  /** 标题右边的按钮（「复制缺项清单」） */
  action?: ReactNode;
  /** 清单下面一句 12 号提示 */
  hint?: ReactNode;
}) {
  return (
    <section aria-label="缺项清单" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <h3 style={{ ...type.subtitle, fontWeight: weight.strong, color: gy.text, margin: 0 }}>
          {count && count > 0 ? `还缺 ${count} 项` : '缺项清单'}
        </h3>
        {action}
      </div>
      {items && (
        <div style={{ display: 'flex', flexDirection: 'column', border: `1px solid ${gy.split}`, borderRadius: 8 }}>{items}</div>
      )}
      {hint && <div style={{ ...type.caption, color: gy.tertiary }}>{hint}</div>}
    </section>
  );
}

// 一项：没补上的加粗（必备的带红底标签），补上的划掉、三级色
function Row({ item, last }: { item: MissingItem; last: boolean }) {
  const filled = !!item.filledAt;
  return (
    <div
      role="listitem"
      data-filled={filled ? 'true' : undefined}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: '12px 16px',
        borderBottom: last ? undefined : `1px solid ${gy.split}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            ...type.body,
            fontWeight: filled ? weight.normal : weight.strong,
            color: filled ? gy.tertiary : gy.text,
            textDecoration: filled ? 'line-through' : undefined,
          }}
        >
          {item.label}
        </span>
        {!filled && item.required && (
          <span
            style={{
              ...type.caption,
              display: 'inline-flex',
              alignItems: 'center',
              height: 20,
              padding: '0 8px',
              borderRadius: 4,
              background: gy.errorBg,
              color: gy.error,
              flexShrink: 0,
            }}
          >
            必备
          </span>
        )}
      </div>
      <span style={{ ...type.body, color: gy.secondary }}>
        {item.filledAt ? `${monthDay(item.filledAt)}已补上` : item.required ? '没有这一项不能生成。' : '不补会在预案里标「待补充」。'}
      </span>
    </div>
  );
}

/** 「等客户补资料」抽屉里的缺项清单：专家列出的项和补上情况，可以复制（运营复制不留记录、不改任务） */
export function OperatorMissingList({ t }: { t: OperatorTaskDetail }) {
  const view = useOperatorMissingList(t.id);
  const { copy, node } = useMissingCopy();

  if (view.isPending) {
    return (
      <MissingList
        count={t.awaitingCustomerItems}
        items={<Skeleton active paragraph={{ rows: 2 }} title={false} style={{ padding: '12px 16px' }} />}
      />
    );
  }
  if (view.isError) {
    return (
      <MissingList
        count={t.awaitingCustomerItems}
        hint={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            缺项清单没有取到
            <button type="button" style={{ ...linkButton, ...type.caption, color: gy.primary }} onClick={() => void view.refetch()}>
              重新加载
            </button>
          </span>
        }
      />
    );
  }
  const data = view.data;
  const list = data.list;
  // 逐项填写的老任务、没复制过清单的：只有个数
  if (!list) return <MissingList count={t.awaitingCustomerItems} hint="这个任务没有留下逐项清单。" />;

  const open = list.items.filter((i) => !i.filledAt);
  const doCopy = () =>
    void copy(
      {
        companyName: data.companyName ?? t.enterpriseName,
        addresses: data.addresses,
        contact: data.contact ?? undefined,
        expertName: list.byName,
        items: open,
      },
      `已复制 ${open.length} 项缺项，粘贴到企业微信发给客户`,
    );

  return (
    <>
      <MissingList
        count={open.length}
        action={
          <Button type="primary" disabled={open.length === 0} onClick={doCopy} style={{ flexShrink: 0, paddingInline: 16 }}>
            复制缺项清单
          </Button>
        }
        items={
          <div role="list" aria-label="缺项" style={{ display: 'flex', flexDirection: 'column' }}>
            {list.items.map((i, n) => (
              <Row key={i.key} item={i} last={n === list.items.length - 1} />
            ))}
          </div>
        }
        hint="清单由专家列出，这里只能看和复制。复制后粘贴到企业微信发给客户。"
      />
      {node}
    </>
  );
}
