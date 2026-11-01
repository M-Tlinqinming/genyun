import { SearchOutlined } from '@ant-design/icons';
import type { DeliveredVersion, TaskDeliveries } from '@genyun/shared';
import { App, Button, Input, Result, Select, Tooltip } from 'antd';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { downloadBundle, downloadWord, useOrgDeliveries } from '../../../api/deliveries';
import { useOrgTasks } from '../../../api/enterprises';
import { Loading } from '../../../components/ui';
import { useWorkspace } from '../../../layouts/workspace';
import { gy, stage } from '../../../theme/tokens';
import { card, NOT_READABLE, stampShort, text14, textLink, textLinkDisabled, versionText, WordIcon } from './shared';

type VersionFilter = 'latest' | 'all';

// C06 成果文档｜已交付成果检索：每个已交付任务一张卡，同一次交付的三份 Word 放在一起；
// 默认只看最新版本，可切到全部版本；按企业、任务编号、文档名称搜索
export function DocumentsPage() {
  const { orgId } = useWorkspace();
  const list = useOrgDeliveries(orgId);
  const tasks = useOrgTasks(orgId);
  const [keyword, setKeyword] = useState('');
  const [enterprise, setEnterprise] = useState('all');
  const [versions, setVersions] = useState<VersionFilter>('latest');

  const all = list.data ?? [];
  const k = keyword.trim().toUpperCase();
  const cards = all
    .filter((t) => enterprise === 'all' || t.enterpriseId === enterprise)
    .flatMap((t) => (versions === 'latest' ? t.versions.slice(0, 1) : t.versions).map((v) => ({ task: t, version: v, latest: v === t.versions[0] })))
    .filter(
      ({ task, version }) =>
        !k ||
        task.enterpriseName.toUpperCase().includes(k) ||
        task.taskNumber.toUpperCase().includes(k) ||
        version.files.some((f) => f.name.toUpperCase().includes(k)),
    );
  const enterprises = [...new Map(all.map((t) => [t.enterpriseId, t.enterpriseName])).entries()];
  const inProgress = (tasks.data ?? []).filter((t) => t.closedAt === null).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: '40px', fontWeight: 500, color: gy.text }}>成果文档</h1>
        <span style={{ ...text14, color: gy.secondary }}>注安师审核后交付的成果。同一次交付的三份 Word 始终放在一起，避免混用版本。</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Input
          allowClear
          aria-label="搜索成果"
          prefix={<SearchOutlined style={{ color: gy.tertiary }} />}
          placeholder="搜索企业 / 任务编号 / 文档名称"
          onChange={(e) => setKeyword(e.target.value)}
          style={{ flex: 1 }}
        />
        <Select
          aria-label="按企业筛选"
          value={enterprise}
          onChange={setEnterprise}
          style={{ width: 168, flexShrink: 0 }}
          options={[{ value: 'all', label: '企业：全部' }, ...enterprises.map(([id, name]) => ({ value: id, label: name }))]}
        />
        <Select
          aria-label="按版本筛选"
          value={versions}
          onChange={setVersions}
          style={{ width: 168, flexShrink: 0 }}
          options={[
            { value: 'latest', label: '版本：仅最新' },
            { value: 'all', label: '版本：全部版本' },
          ]}
        />
      </div>

      {list.isPending ? (
        <Loading rows={5} />
      ) : list.isError ? (
        <Result status="error" title="成果加载失败" subTitle={list.error.message} />
      ) : all.length === 0 ? (
        <div style={{ ...card, padding: '24px 24px', ...text14, color: gy.secondary }}>还没有已交付的成果。注安师审核并发布后，三份 Word 会出现在这里。</div>
      ) : cards.length === 0 ? (
        <div style={{ ...card, padding: '24px 24px', ...text14, color: gy.secondary }}>没有符合条件的成果。</div>
      ) : (
        cards.map(({ task, version, latest }) => <DeliveryCard key={`${task.taskId}-${version.version}`} task={task} version={version} latest={latest} />)
      )}

      {inProgress > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px', borderRadius: 8, background: gy.selected }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ ...text14, fontWeight: 500, color: gy.text }}>还有 {inProgress} 项任务在办理中</span>
            <span style={{ ...text14, color: gy.secondary }}>成果经注安师审核并发布后才会出现在这里。办理进度请在业务任务中查看。</span>
          </div>
          <Link to="/customer/tasks" style={textLink}>
            查看业务任务 →
          </Link>
        </div>
      )}
    </div>
  );
}

function DeliveryCard({ task, version, latest }: { task: TaskDeliveries; version: DeliveredVersion; latest: boolean }) {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [bundling, setBundling] = useState(false);
  const detail = `/customer/documents/${task.taskId}${latest ? '' : `?v=${version.version}`}`;
  const tone = latest ? stage.done : stage.progress;

  const bundle = async () => {
    setBundling(true);
    try {
      await downloadBundle(task.taskId, version.version, task.enterpriseName);
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
    <section aria-label={`${task.enterpriseName} ${versionText(version.version)}`} style={{ ...card, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '20px 24px', borderBottom: `1px solid ${gy.split}` }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 16, lineHeight: '24px', fontWeight: 500, color: gy.text }}>{task.enterpriseName}</span>
            <span style={{ padding: '0 8px', borderRadius: 4, fontSize: 13, lineHeight: '20px', color: tone.color, background: tone.bg, whiteSpace: 'nowrap' }}>
              {versionText(version.version)} · {latest ? '最新' : '历史版本'}
            </span>
          </div>
          <span style={{ fontSize: 13, lineHeight: '20px', color: gy.secondary }}>
            {task.taskName} · {task.taskNumber} · {stampShort(version.publishedAt)} 发布 · 注安师审核通过
          </span>
        </div>
        <Button onClick={() => navigate(detail)}>查看交付详情</Button>
        <Button type="primary" loading={bundling} onClick={() => void bundle()}>
          下载整套 Word
        </Button>
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
          <WordIcon />
          <span style={{ ...text14, flex: 1, minWidth: 0, color: gy.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
          {f.readable ? (
            <Link to={`/customer/documents/${task.taskId}/read/${f.kind}?v=${version.version}`} style={textLink} aria-label={`在线阅读 ${f.name}`}>
              在线阅读
            </Link>
          ) : (
            <Tooltip title={NOT_READABLE}>
              <span style={textLinkDisabled} aria-disabled>
                在线阅读
              </span>
            </Tooltip>
          )}
          <button type="button" style={textLink} aria-label={`下载 ${f.name}`} onClick={() => void one(f.fileId, f.name)}>
            下载
          </button>
        </div>
      ))}
    </section>
  );
}
