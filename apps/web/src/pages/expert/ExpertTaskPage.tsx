import { ArrowLeftOutlined } from '@ant-design/icons';
import {
  FACT_SECTIONS,
  nextMissing,
  workupFacts,
  workupProgress,
  type Fact,
  type FactSection,
  type FactValue,
} from '@genyun/shared';
import { App, Button, Result, Tooltip } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ApiError } from '../../api/request';
import { useTask } from '../../api/tasks';
import { useSaveFact, useWorkup, workupKey } from '../../api/workup';
import { linkButton, Loading } from '../../components/ui';
import { FadeSwap } from '../../theme/motion';
import { gy, stage } from '../../theme/tokens';
import { FactsPanel, SourceTag, type EditMode } from './workup/FactsPanel';
import { OriginalsPanel, originalTitle } from './workup/OriginalsPanel';

const STAGES = ['资料核实', '专业编制', '审核与修订', '成果发布'];
// 后续整理模块，在 M2 第 6–8 项开放
const LATER_MODULES = [
  { label: '生产设备与物料', item: 6 },
  { label: '危险源辨识', item: 7 },
  { label: '适用范围', item: 8 },
];

const text14: CSSProperties = { fontSize: 14, lineHeight: '22px' };
const text13: CSSProperties = { fontSize: 13, lineHeight: '22px' };

function clock(iso: string): string {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  );
}

// I05 处理工作台 · 专业整理（14 页 E18-00A、E18-00A2）：左栏整理模块、中栏企业事实、右栏原件对照
export function ExpertTaskPage() {
  const { taskId = '' } = useParams();
  const task = useTask(taskId);
  const workup = useWorkup(taskId);
  const save = useSaveFact(taskId);
  const client = useQueryClient();
  const navigate = useNavigate();
  const { message } = App.useApp();

  const [onlyMissing, setOnlyMissing] = useState(false);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ key: string; mode: EditMode } | null>(null);
  const [fileId, setFileId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<FactSection>('basic');
  const sections = useRef(new Map<FactSection, HTMLElement>());
  const rows = useRef(new Map<string, HTMLElement>());

  const facts = useMemo(
    () => (workup.data ? workupFacts(workup.data.snapshot, workup.data.data) : []),
    [workup.data],
  );
  const progress = useMemo(() => workupProgress(facts), [facts]);
  const originals = useMemo(() => workup.data?.originals ?? [], [workup.data]);
  const currentFile = originals.find((o) => o.fileId === fileId) ?? originals[0];

  const scrollTo = (el: HTMLElement | undefined) => el?.scrollIntoView({ behavior: 'smooth', block: 'center' });

  const goToSection = (section: FactSection) => {
    setActiveSection(section);
    setOnlyMissing(false);
    requestAnimationFrame(() => sections.current.get(section)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const goToNextMissing = () => {
    const next = nextMissing(facts, focusKey ?? undefined);
    if (!next) return;
    setFocusKey(next.key);
    setActiveSection(next.section);
    requestAnimationFrame(() => scrollTo(rows.current.get(next.key)));
  };

  // 点来源标签：右栏打开这一项对应的原件（记下的那份，或这类资料的第一份）
  const sourceHandler = useCallback(
    (fact: Fact) => {
      const target =
        originals.find((o) => o.fileId === fact.fileId) ??
        (fact.itemKey ? originals.find((o) => o.itemKeys.includes(fact.itemKey!)) : undefined);
      if (!target) return undefined;
      return () => {
        setFileId(target.fileId);
        setFocusKey(fact.key);
      };
    },
    [originals],
  );

  const saveFact = async (fact: Fact, value: FactValue | null, mode: EditMode) => {
    if (!workup.data) return;
    try {
      await save.mutateAsync({
        version: workup.data.version,
        key: fact.key,
        value,
        source: mode,
        fileId: mode === 'expert' && value !== null ? currentFile?.fileId : undefined,
      });
      setEditing(null);
      setFocusKey(fact.key);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        message.warning(err.message);
        setEditing(null);
        await client.invalidateQueries({ queryKey: workupKey(taskId) });
        return;
      }
      message.error(err instanceof ApiError ? err.message : '保存失败，请检查网络后重试');
    }
  };

  const back = (
    <button type="button" style={linkButton} onClick={() => navigate('/expert')}>
      <ArrowLeftOutlined /> 返回任务中心
    </button>
  );
  if (task.isPending || workup.isPending) return <Loading rows={6} />;
  if (task.isError) {
    return <Result status="404" title="找不到该任务" subTitle="任务不存在，或没有分派给您。" extra={back} />;
  }
  if (workup.isError) {
    return <Result status="info" title="还不能开始整理" subTitle={workup.error.message} extra={back} />;
  }

  const w = workup.data;
  const saved = w.updatedByName ? `已自动保存 ${clock(w.updatedAt)}` : '还没有修改';
  const missingLabels = progress.missing.map((f) => f.label);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, margin: '-16px 0 -24px' }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <nav aria-label="面包屑" style={{ ...text14, color: gy.secondary }}>
          <Link to="/expert" style={{ color: gy.secondary }}>
            任务中心
          </Link>
          {`　/　${task.data.enterpriseName}　/　专业整理`}
        </nav>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 500, lineHeight: '32px', color: gy.text }}>{task.data.enterpriseName}</h1>
          <span style={{ ...text14, color: gy.secondary }}>{task.data.number}</span>
          <span style={{ flex: 1 }} />
          <span style={{ ...text14, padding: '2px 10px', borderRadius: 4, background: stage.action.bg, color: stage.action.color }}>
            整理中 · 必需项 {progress.done} / {progress.required}
          </span>
        </div>
        <ol
          aria-label="处理阶段"
          style={{ display: 'flex', gap: 28, margin: 0, padding: '0 0 12px', listStyle: 'none', borderBottom: `1px solid ${gy.split}` }}
        >
          {STAGES.map((s, i) => (
            <li key={s} aria-current={i === 1 ? 'step' : undefined} style={{ ...text14, color: i === 1 ? gy.primary : gy.secondary }}>
              {i + 1}　{s}
            </li>
          ))}
        </ol>
      </header>

      <div style={{ display: 'flex', gap: 16, height: 640 }}>
        <nav
          aria-label="整理模块"
          style={{
            width: 200,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            padding: '12px 8px',
            background: gy.surface,
            border: `1px solid ${gy.split}`,
            borderRadius: 8,
          }}
        >
          <div style={{ padding: '4px 12px 8px', fontSize: 13, lineHeight: '20px', color: gy.secondary }}>整理模块</div>
          <button
            type="button"
            onClick={() => goToSection('basic')}
            style={{ ...linkButton, display: 'flex', flexDirection: 'column', gap: 2, padding: '8px 12px', borderRadius: 6, background: gy.selected, textAlign: 'left' }}
          >
            <span style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
              <span style={{ ...text14, fontWeight: 500, color: gy.primary }}>企业事实</span>
              <span style={{ ...text13, color: progress.missing.length ? stage.action.color : stage.done.color }}>
                {progress.done} / {progress.required}
              </span>
            </span>
            <span style={{ fontSize: 13, lineHeight: '20px', color: gy.secondary }}>基本信息 · 属地 · 组织</span>
          </button>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 12px 4px 24px' }}>
            {progress.sections.map((s) => (
              <button
                key={s.section}
                type="button"
                onClick={() => goToSection(s.section)}
                style={{ ...linkButton, display: 'flex', justifyContent: 'space-between', width: '100%', ...text13 }}
              >
                <span style={{ color: s.section === activeSection ? gy.primary : gy.text }}>{FACT_SECTIONS[s.section]}</span>
                <span style={{ color: s.missing ? stage.action.color : stage.done.color }}>{s.missing ? `缺 ${s.missing}` : '✓'}</span>
              </button>
            ))}
          </div>
          {LATER_MODULES.map((m) => (
            <Tooltip key={m.label} title={`在 M2 第 ${m.item} 项开放`} placement="right">
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', ...text14, color: gy.tertiary }}>
                <span>{m.label}</span>
                <span style={text13}>待开放</span>
              </div>
            </Tooltip>
          ))}
          <span style={{ flex: 1 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 12, borderTop: `1px solid ${gy.split}` }}>
            <span style={{ fontSize: 13, lineHeight: '20px', color: gy.secondary }}>来源图例</span>
            <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <SourceTag kind="original" />
              <SourceTag kind="expert" />
              <SourceTag kind="system" />
              <SourceTag kind="customer" />
            </span>
          </div>
        </nav>

        <FactsPanel
          facts={facts}
          onlyMissing={onlyMissing}
          onOnlyMissingChange={setOnlyMissing}
          focusKey={focusKey}
          editing={editing}
          onEdit={(key, mode) => {
            setEditing({ key, mode });
            setFocusKey(key);
          }}
          onCancelEdit={() => setEditing(null)}
          onSave={saveFact}
          onSourceClick={sourceHandler}
          originalName={currentFile ? originalTitle(currentFile) : undefined}
          saving={save.isPending}
          registerSection={(section, el) => {
            if (el) sections.current.set(section, el);
            else sections.current.delete(section);
          }}
          registerRow={(key, el) => {
            if (el) rows.current.set(key, el);
            else rows.current.delete(key);
          }}
        />

        <OriginalsPanel originals={originals} selectedId={currentFile?.fileId ?? null} onSelect={setFileId} />
      </div>

      <section
        aria-label="整理进度"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '14px 20px',
          background: gy.surface,
          border: `1px solid ${gy.split}`,
          borderRadius: 8,
        }}
      >
        <span role="status" style={{ fontSize: 13, lineHeight: '20px', color: w.updatedByName ? stage.done.color : gy.secondary }}>
          <FadeSwap id={save.isPending ? 'saving' : saved}>{save.isPending ? '保存中…' : w.updatedByName ? `✓ ${saved}` : saved}</FadeSwap>
        </span>
        <span style={{ width: 1, height: 16, background: gy.split }} />
        <span style={{ flex: 1, minWidth: 0, ...text14, color: gy.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {missingLabels.length ? `还差 ${missingLabels.length} 项：${missingLabels.join(' · ')}` : '企业事实的必需项已齐'}
        </span>
        <Button onClick={goToNextMissing} disabled={missingLabels.length === 0}>
          下一个缺失项
        </Button>
        <Tooltip title="生成三份草稿在 M2 第 10 项开放">
          <Button type="primary" disabled>
            完成整理，去核对
          </Button>
        </Tooltip>
      </section>
    </div>
  );
}
