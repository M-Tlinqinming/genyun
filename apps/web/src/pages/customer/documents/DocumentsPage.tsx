import { SearchOutlined } from '@ant-design/icons';
import { chinaToday, type DeliveredVersion, type TaskDeliveries } from '@genyun/shared';
import { App, Button, Input, Result, Select } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { downloadBundle, downloadWord, useOrgDeliveries } from '../../../api/deliveries';
import { ContactLink } from '../../../components/ContactLink';
import { FileTypeIcon } from '../../../components/FileTypeIcon';
import { Loading } from '../../../components/ui';
import { useWorkspace } from '../../../layouts/workspace';
import { gy, stage, type, weight } from '../../../theme/tokens';
import { card, lockText, stampFull, stampShort, text14, textLink, textLinkDisabled, WORD_TYPE } from './shared';

type Period = 'all' | '30' | '90' | 'year';
const PERIODS: { value: Period; label: string }[] = [
  { value: 'all', label: '交付时间：全部' },
  { value: '30', label: '最近 30 天' },
  { value: '90', label: '最近 90 天' },
  { value: 'year', label: '今年' },
];
const DAY = 86_400_000;

function inPeriod(publishedAt: string, period: Period, now: Date) {
  if (period === 'all') return true;
  if (period === 'year') return chinaToday(new Date(publishedAt)).slice(0, 4) === chinaToday(now).slice(0, 4);
  return now.getTime() - new Date(publishedAt).getTime() <= Number(period) * DAY;
}

// C06 成果文档｜每个已交付任务一张卡，最新一次交付的三份 Word 放在一起（客户只看最新一次交付）；
// 按企业、任务编号、文档名称搜索，按企业、交付时间筛选。正在办理的任务在工作台和任务列表里看
export function DocumentsPage() {
  const { orgId } = useWorkspace();
  const list = useOrgDeliveries(orgId);
  const [keyword, setKeyword] = useState('');
  const [enterprise, setEnterprise] = useState('all');
  const [period, setPeriod] = useState<Period>('all');
  const now = new Date();

  const all = list.data ?? [];
  const k = keyword.trim().toUpperCase();
  const cards = all
    .filter((t) => enterprise === 'all' || t.enterpriseId === enterprise)
    .flatMap((t) => t.versions.slice(0, 1).map((v) => ({ task: t, version: v })))
    .filter(({ version }) => inPeriod(version.publishedAt, period, now))
    .filter(
      ({ task, version }) =>
        !k ||
        task.enterpriseName.toUpperCase().includes(k) ||
        task.taskNumber.toUpperCase().includes(k) ||
        version.files.some((f) => f.name.toUpperCase().includes(k)),
    );
  const enterprises = [...new Map(all.map((t) => [t.enterpriseId, t.enterpriseName])).entries()];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h1 style={{ margin: 0, ...type.pageTitle, fontWeight: weight.strong, color: gy.text }}>成果文档</h1>
        <span style={{ ...type.body, color: gy.secondary }}>专家交付的三份 Word 都在这里，同一次交付的放在一起。</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Input
          allowClear
          aria-label="搜索成果"
          prefix={<SearchOutlined style={{ color: gy.tertiary }} />}
          placeholder="搜索企业 / 任务编号 / 文档名称"
          onChange={(e) => setKeyword(e.target.value)}
          style={{ width: 280, flexShrink: 0 }}
        />
        <Select
          aria-label="按企业筛选"
          value={enterprise}
          onChange={setEnterprise}
          style={{ width: 160, flexShrink: 0 }}
          options={[{ value: 'all', label: '企业：全部' }, ...enterprises.map(([id, name]) => ({ value: id, label: name }))]}
        />
        <Select aria-label="按交付时间筛选" value={period} onChange={setPeriod} style={{ width: 160, flexShrink: 0 }} options={PERIODS} />
      </div>

      {list.isPending ? (
        <Loading rows={5} />
      ) : list.isError ? (
        <Result status="error" title="成果加载失败" subTitle={list.error.message} />
      ) : all.length === 0 ? (
        <div style={{ ...card, padding: '24px 24px', ...text14, color: gy.secondary }}>还没有已交付的成果。专家审核并交付后，三份 Word 会出现在这里。</div>
      ) : cards.length === 0 ? (
        <div style={{ ...card, padding: '24px 24px', ...text14, color: gy.secondary }}>没有符合条件的成果。</div>
      ) : (
        cards.map(({ task, version }) => <DeliveryCard key={task.taskId} task={task} version={version} />)
      )}

    </div>
  );
}

function DeliveryCard({ task, version }: { task: TaskDeliveries; version: DeliveredVersion }) {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const { role } = useWorkspace();
  // 锁住的成果（C01·S02 状态 4）：任务那一行照常显示，标签和锁住的说明各占一栏；
  // 管理员多一个「联系耕云续约」，成员看不到「次数」「续约」；下载置灰，「查看交付详情」照常能点
  const isAdmin = role === 'customer_admin';
  const lock = task.lock ? lockText(task.lock, isAdmin) : null;
  const [bundling, setBundling] = useState(false);
  const detail = `/customer/documents/${task.taskId}`;
  const tone = lock ? stage.action : stage.done;
  const state = version.version > 1 ? '已更新' : '已交付';

  const bundle = async () => {
    setBundling(true);
    try {
      await downloadBundle(task.taskId, version.version, task.enterpriseName, version.publishedAt);
    } catch (err) {
      message.error(`整套 Word 没能下载：${err instanceof Error ? err.message : '请稍后重试'}`);
    } finally {
      setBundling(false);
    }
  };
  const one = async (fileId: string, name: string) => {
    try {
      await downloadWord(fileId, name);
    } catch (err) {
      message.error(`没能下载：${err instanceof Error ? err.message : '请稍后重试'}`);
    }
  };

  return (
    <section aria-label={`${task.enterpriseName} ${task.taskNumber}`} style={{ ...card, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '20px 24px', borderBottom: `1px solid ${gy.split}` }}>
        <div style={{ flex: lock ? '3 1 0' : 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ ...type.subtitle, fontWeight: weight.strong, color: gy.text }}>{task.enterpriseName}</span>
            {!lock && (
              <span style={{ padding: '0 8px', borderRadius: 4, ...type.caption, color: tone.color, background: tone.bg, whiteSpace: 'nowrap' }}>
                {state}
              </span>
            )}
          </div>
          <span style={{ ...type.caption, color: gy.secondary }}>
            {lock
              ? `${task.taskNumber} · ${task.taskName} · ${stampFull(version.publishedAt)} 专家已完成`
              : `${task.taskNumber} · ${task.taskName} · ${stampShort(version.publishedAt)} ${state === '已更新' ? '更新' : '交付'}`}
          </span>
        </div>
        {lock && (
          <>
            <div style={{ width: 180, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
              <span style={{ padding: '0 8px', borderRadius: 4, ...type.caption, color: tone.color, background: tone.bg, whiteSpace: 'nowrap' }}>
                {lock.tag}
              </span>
            </div>
            <span style={{ ...type.caption, flex: '2 1 0', minWidth: 0, color: gy.secondary }}>{lock.line}</span>
          </>
        )}
        <Button onClick={() => navigate(detail)} style={{ flexShrink: 0, borderColor: gy.border }}>
          {lock ? '查看' : '查看交付详情'}
        </Button>
        {lock ? (
          isAdmin && (
            <ContactLink
              title="联系耕云续约"
              trigger={(open) => (
                <Button type="primary" onClick={open} style={{ flexShrink: 0 }}>
                  联系耕云续约
                </Button>
              )}
            />
          )
        ) : (
          <Button type="primary" loading={bundling} onClick={() => void bundle()} style={{ flexShrink: 0 }}>
            下载整套 Word
          </Button>
        )}
      </div>
      {version.files.map((f, i) => (
        <div
          key={f.kind}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            height: 52,
            padding: '0 24px',
            borderBottom: i < version.files.length - 1 ? `1px solid ${gy.split}` : undefined,
          }}
        >
          <FileTypeIcon contentType={WORD_TYPE} />
          <span style={{ ...text14, flex: 1, minWidth: 0, color: gy.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
          <button
            type="button"
            style={lock ? textLinkDisabled : textLink}
            disabled={Boolean(lock)}
            aria-label={`下载 ${f.name}`}
            onClick={() => void one(f.fileId, f.name)}
          >
            下载
          </button>
        </div>
      ))}
    </section>
  );
}
