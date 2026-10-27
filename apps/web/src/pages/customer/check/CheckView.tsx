import {
  CATEGORY_STATUS_LABELS,
  checkOverview,
  type Category,
  type CategoryCheck,
  type CategoryStatus,
} from '@genyun/shared';
import { App, Button, Result, Spin } from 'antd';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useTaskDocuments } from '../../../api/documents';
import { useTaskCheck, type Task, type TaskCheck } from '../../../api/tasks';
import { gy } from '../../../theme/tokens';
import { OnSiteDialog } from '../OnSiteVisit';
import { CheckDrawer } from './CheckDrawer';

const STATUS_COLOR: Record<CategoryStatus, string> = {
  done: gy.success,
  missing: gy.warning,
  verifying: gy.primary,
};

// 资料检查页（12 页 P05、P06）：两种开始方式共用。六类按资料项是否满足判断，不按文件数；
// 明细抽屉里逐项处理。「提交生成申请」在第 12 项接上
export function CheckView({ task, onBackToFiles }: { task: Task; onBackToFiles?: () => void }) {
  const check = useTaskCheck(task.id);
  const docs = useTaskDocuments(task.id);
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [openCategory, setOpenCategory] = useState<Category | null>(null);
  const [booking, setBooking] = useState(false);

  if (check.isPending) return <Spin style={{ display: 'block', padding: '64px 0' }} />;
  if (check.isError) return <Result status="error" title="资料检查加载失败" subTitle={check.error.message} />;

  const o = checkOverview(check.data.items);
  const opened = o.categories.find((c) => c.category === openCategory) ?? null;
  const firstMissing = o.missing[0];
  const firstMissingCategory = o.categories.find((c) => c.items.some((i) => i.key === firstMissing?.key));
  const selfFill = task.startMethod === 'self_fill';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {firstMissing && firstMissingCategory ? (
        <Banner
          tone="warning"
          title={`请补充${firstMissing.label}${o.missing.length > 1 ? ` 等 ${o.missing.length} 项` : ''}`}
          text={`${firstMissing.startPart ? `开始编制需要：${firstMissing.startPart}。` : '这是开始编制必需的资料。'}没有文件可以直接告诉我们，拿不准可以请专家电话联系。`}
          action={
            <Button type="primary" onClick={() => setOpenCategory(firstMissingCategory.category)}>
              补充{firstMissing.label.length <= 6 ? firstMissing.label : '资料'}
            </Button>
          }
        />
      ) : (
        <Banner
          tone="info"
          title={o.withExpert.length > 0 ? '必需资料已齐，其余由耕云核实' : '必需资料已齐，可以提交'}
          text={
            o.withExpert.length > 0
              ? `${o.withExpert.map((i) => i.label).join('、')} 由耕云专家处理，不影响提交。`
              : '「可稍后补」的项不影响提交，专家审核时会提醒您。'
          }
        />
      )}

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 24 }}>
        <section aria-label="本次资料检查" style={{ ...panel, flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '24px 24px 16px' }}>
            <h2 style={{ margin: 0, fontSize: 18, lineHeight: '26px', fontWeight: 500, color: gy.text }}>本次资料检查</h2>
            <span style={{ fontSize: 14, color: gy.secondary }}>
              {(['done', 'missing', 'verifying'] as CategoryStatus[])
                .filter((s) => o.counts[s] > 0)
                .map((s) => `${o.counts[s]} ${CATEGORY_STATUS_LABELS[s]}`)
                .join(' · ')}
            </span>
          </div>
          {o.categories.map((c) => (
            <CategoryRow key={c.category} category={c} check={check.data} onOpen={() => setOpenCategory(c.category)} />
          ))}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px 24px',
              borderTop: `1px solid ${gy.split}`,
              fontSize: 14,
              color: gy.secondary,
            }}
          >
            <span>
              {selfFill ? '资料来自企业自填' : `本次关联 ${docs.data?.length ?? 0} 份文件`} · 按资料项是否满足判断，不按文件数
            </span>
            {selfFill ? (
              <button type="button" style={link} onClick={() => navigate(`/customer/tasks/${task.id}/fill/1`)}>
                继续填写
              </button>
            ) : (
              onBackToFiles && (
                <button type="button" style={link} onClick={onBackToFiles}>
                  查看 / 补充原始文件
                </button>
              )
            )}
          </div>
        </section>

        <aside aria-label="处理分工" style={{ ...panel, width: 304, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 20, padding: 24 }}>
          <Side
            title="您来处理"
            text={
              o.missing.length > 0
                ? `补充${o.missing.map((i) => i.label).join('、')}。`
                : '暂时无需操作。有新资料或发现事实变化时，可继续补充。'
            }
          />
          <Side
            title="耕云来处理"
            text={
              o.withExpert.length > 0
                ? `${o.withExpert.map((i) => i.label).join('、')}：${o.withExpert.some((i) => i.state === 'call') ? '专家会电话联系您' : '由注册安全工程师判断'}。已有原件，无需重复上传。`
                : '危化品、特种设备、耐火等级等专业判断由注册安全工程师完成。'
            }
          />
          <div style={{ height: 1, background: gy.split }} />
          <Button
            size="large"
            block
            type={o.canSubmit ? 'primary' : 'default'}
            disabled={!o.canSubmit}
            onClick={() =>
              selfFill
                ? navigate(`/customer/tasks/${task.id}/fill/5`)
                : message.info('资料已检查完毕，提交功能即将开放；资料都已保存。')
            }
          >
            提交生成申请
          </Button>
          <span style={{ fontSize: 14, lineHeight: '22px', color: gy.secondary }}>
            {o.canSubmit ? '提交后由负责专家审核，缺什么会在任务里告诉您。' : '完成以上事项后才可提交。'}
          </span>
          <button type="button" style={link} onClick={() => setBooking(true)}>
            联系耕云核实 / 现场调研
          </button>
          <span style={{ fontSize: 14, color: gy.success }}>资料与草稿已保存</span>
        </aside>
      </div>

      <CheckDrawer task={task} category={opened} check={check.data} onClose={() => setOpenCategory(null)} />
      <OnSiteDialog taskId={task.id} open={booking} onClose={() => setBooking(false)} />
    </div>
  );
}

// 一类资料：名称、涉及的文件或待办、状态、明细入口
function CategoryRow({ category: c, check, onOpen }: { category: CategoryCheck; check: TaskCheck; onOpen: () => void }) {
  const files = [...new Set(c.items.flatMap((i) => i.item?.fileIds ?? []).map((f) => check.fileNames[f] ?? '已上传文件'))];
  const missing = c.items.filter((i) => i.state === 'missing').map((i) => `${i.label}待补充`);
  const later = c.items.filter((i) => i.state === 'later').length;
  const parts = [`${c.items.length} 项`, ...files.slice(0, 2), ...missing.slice(0, 2), later > 0 ? `${later} 项可稍后补` : ''].filter(
    Boolean,
  );
  return (
    <div
      data-testid={`category-${c.category}`}
      style={{ display: 'flex', alignItems: 'center', gap: 24, padding: '14px 24px', borderTop: `1px solid ${gy.split}` }}
    >
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: 14, lineHeight: '22px', fontWeight: 500, color: gy.text }}>{c.label}</span>
        <span style={{ fontSize: 12, lineHeight: '20px', color: gy.tertiary }}>{parts.join(' · ')}</span>
      </div>
      <span style={{ width: 72, flexShrink: 0, fontSize: 14, color: STATUS_COLOR[c.status] }}>{CATEGORY_STATUS_LABELS[c.status]}</span>
      <button type="button" style={{ ...link, width: 72, flexShrink: 0, textAlign: 'left' }} aria-label={`${c.label}明细`} onClick={onOpen}>
        {c.status === 'missing' ? '补充资料' : c.status === 'verifying' ? '查看说明' : '明细'}
      </button>
    </div>
  );
}

function Banner({ tone, title, text, action }: { tone: 'warning' | 'info'; title: string; text: string; action?: ReactNode }) {
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 24,
        padding: '20px 24px',
        borderRadius: 8,
        background: tone === 'warning' ? '#FFF7E6' : gy.selected,
        border: `1px solid ${tone === 'warning' ? '#D9A441' : '#9DB7EE'}`,
      }}
    >
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 14, lineHeight: '22px', fontWeight: 500, color: gy.text }}>{title}</span>
        <span style={{ fontSize: 14, lineHeight: '22px', color: gy.secondary }}>{text}</span>
      </div>
      {action}
    </div>
  );
}

function Side({ title, text }: { title: string; text: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h3 style={{ margin: 0, fontSize: 16, lineHeight: '24px', fontWeight: 500, color: gy.text }}>{title}</h3>
      <p style={{ margin: 0, fontSize: 14, lineHeight: '22px', color: gy.secondary }}>{text}</p>
    </div>
  );
}

const panel: CSSProperties = { borderRadius: 8, background: gy.surface, border: `1px solid ${gy.split}` };
const link: CSSProperties = {
  alignSelf: 'flex-start',
  textAlign: 'left',
  padding: 0,
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  fontSize: 14,
  lineHeight: '22px',
  color: gy.primary,
};
