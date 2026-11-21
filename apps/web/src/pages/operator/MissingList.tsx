import type { ReactNode } from 'react';
import { gy, type, weight } from '../../theme/tokens';

// 抽屉里「等客户补资料」的缺项清单（Paper 16 页 I04b）。
// 现在只有个数（任务上的 awaitingCustomerItems）；逐项内容、「复制缺项清单」按钮和下面那句提示以后再接：
// 新开一个运营接口（如 GET /api/operator/tasks/:id/missing-list）读核对数据里专家列出的缺项，
// 取到后把每项渲染成 items 传进来，把按钮放进 action，这个组件的外形不用再动。
export function MissingList({
  count,
  items,
  action,
  hint,
}: {
  /** 还缺几项 */
  count: number | null;
  /** 逐项内容（以后接缺项接口后传入）；不传就不画清单框 */
  items?: ReactNode;
  /** 标题右边的按钮（以后放「复制缺项清单」） */
  action?: ReactNode;
  /** 清单下面一句 12 号提示 */
  hint?: ReactNode;
}) {
  return (
    <section aria-label="缺项清单" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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
