import {
  selectedPages,
  figuresView,
  riskView,
  scopeView,
  type AdoptedMaterial,
  type GenerationMaterials,
  type WorkupGap,
} from '@genyun/shared';
import { App, Button, Skeleton, Tooltip } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type CSSProperties } from 'react';
import { openFile } from '../../../api/documents';
import { materialsKey, useConfirmGeneration, useMaterials } from '../../../api/generation';
import { ApiError } from '../../../api/request';
import { useDrawings, workupKey, type Workup } from '../../../api/workup';
import { linkButton } from '../../../components/ui';
import { gy, stage } from '../../../theme/tokens';

const text14: CSSProperties = { fontSize: 14, lineHeight: '22px' };
const card: CSSProperties = { background: gy.surface, border: `1px solid ${gy.split}`, borderRadius: 8 };
const COLS = { version: 64, change: 200, action: 172 };

function stamp(iso: string): string {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(iso));
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? '';
  return `${p('month')}.${p('day')} ${p('hour')}:${p('minute')}`;
}

// I05 · E18-01 确认采用资料：左表本次采用的资料与变化提示，右侧将生成的内容概要，底部一个确认按钮。
// 点确认时后台再查一次整理版本和资料；资料有变化时留在本页，把变了的行标出来
export function ConfirmView({
  taskId,
  workup,
  gaps,
  required,
  hasDrafts,
  editedSections,
  onBackToWorkup,
  onNextMissing,
  onStarted,
}: {
  taskId: string;
  workup: Workup;
  gaps: WorkupGap[];
  required: number;
  // 已经生成过一批：确认后重新生成
  hasDrafts: boolean;
  // 上一批里专家保存过修订的节数：重新生成前先确认
  editedSections: number;
  onBackToWorkup: () => void;
  onNextMissing: () => void;
  onStarted: () => void;
}) {
  const materials = useMaterials(taskId, true);
  const confirm = useConfirmGeneration(taskId);
  const client = useQueryClient();
  const { message, modal } = App.useApp();
  // 确认时发现变了的行（与专家看到的那一版比）
  const [changed, setChanged] = useState<Set<string>>(new Set());

  // 附件 7 放几页客户图纸（第 10c 项）
  const drawings = useDrawings(taskId, true);
  const drawingPages = (drawings.data?.drawings ?? []).reduce(
    (n, d) => n + (d.pageCount ? selectedPages(workup.data.figures?.drawings, d.fileId, d.pageCount).length : 0),
    0,
  );

  const summary = useMemo(() => {
    const risks = riskView(workup.snapshot, workup.data).rows.filter((r) => !r.excluded);
    const scope = scopeView(workup.snapshot, workup.data);
    const figures = figuresView(workup.snapshot, workup.data);
    const counted = (list: { state: string }[]) => list.filter((p) => p.state !== 'pendingOut').length;
    return {
      risks: risks.length,
      riskEdited: risks.filter((r) => r.added || r.changes.length > 0).length,
      specialty: counted(scope.preview.specialty),
      site: counted(scope.preview.site),
      figures: figures.required - figures.pending.length,
    };
  }, [workup]);

  // 已有人工修订时，重新生成前先提醒（11-01 通宵定的，待 Martin 决定，见 DESIGN-DIFF）
  const start = () => {
    if (editedSections === 0) return void submit();
    modal.confirm({
      title: '重新生成三份草稿？',
      content: `已有 ${editedSections} 节人工修订。重新生成后，这些修订需要在新稿里重新对照。`,
      okText: '确认重新生成',
      cancelText: '先不生成',
      onOk: () => submit(),
    });
  };

  const submit = async () => {
    if (!materials.data) return;
    try {
      await confirm.mutateAsync({ version: workup.version, materials: materials.data.fingerprint });
      onStarted();
    } catch (err) {
      if (err instanceof ApiError && err.body?.reason === 'materials') {
        const now = err.body.materials as GenerationMaterials;
        setChanged(diff(materials.data.rows, now.rows));
        client.setQueryData(materialsKey(taskId), now);
        message.warning(err.message);
        return;
      }
      if (err instanceof ApiError && (err.body?.reason === 'stale' || err.body?.reason === 'gaps')) {
        message.warning(err.message);
        await client.invalidateQueries({ queryKey: workupKey(taskId) });
        return;
      }
      message.error(err instanceof ApiError ? err.message : '没有提交成功，请检查网络后重试');
    }
  };

  const rows = materials.data?.rows ?? [];
  const flagged = rows.filter((r) => r.change).length;
  const ready = gaps.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16 }}>
        <h2 style={{ margin: 0, fontSize: 20, lineHeight: '28px', fontWeight: 500, color: gy.text }}>确认本次编制使用的资料</h2>
        <span style={{ ...text14, color: gy.secondary }}>
          专业整理开始于 {stamp(workup.snapshotAt)}
          {workup.updatedByName ? `　·　整理人员：${workup.updatedByName}` : ''}
        </span>
      </div>
      <div style={{ ...text14, color: gy.text, padding: '12px 16px', borderRadius: 6, background: flagged ? gy.warningBg : gy.selected }}>
        {flagged
          ? `有 ${flagged} 份资料在专业整理开始以后又有变化。如果会影响已整理的事实，请发起事实补件；不影响可以直接确认。`
          : '下面是专业整理时对照的客户资料。确认后锁定这些资料和本次整理结果，作为生成三份草稿的依据。'}
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        <section aria-label="本次采用的资料" style={{ ...card, flex: 1, minWidth: 0, overflow: 'hidden', minHeight: 375 }}>
          <div style={{ display: 'flex', padding: '16px 20px', background: gy.canvas, ...text14, color: gy.text }}>
            <span style={{ flex: 1 }}>资料来源</span>
            <span style={{ width: COLS.version, flexShrink: 0 }}>版本</span>
            <span style={{ width: COLS.change, flexShrink: 0 }}>变化提示</span>
            <span style={{ width: COLS.action, flexShrink: 0 }}>操作</span>
          </div>
          {materials.isPending ? (
            <div style={{ padding: 20 }}>
              <Skeleton active paragraph={{ rows: 4 }} title={false} />
            </div>
          ) : (
            <ul role="list" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {rows.map((r) => (
                <MaterialLine key={r.key} row={r} justChanged={changed.has(r.key)} />
              ))}
            </ul>
          )}
        </section>

        <aside aria-label="将生成的内容" style={{ ...card, width: 376, flexShrink: 0, padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <span style={{ fontSize: 16, lineHeight: '24px', fontWeight: 500, color: gy.text }}>将生成的内容</span>
          <span style={{ ...text14, color: ready ? stage.done.color : stage.action.color }}>
            {ready ? `✓ 必需项 ${required} / ${required} 已整理` : `必需项 ${required - gaps.length} / ${required}，还差 ${gaps.length} 项`}
          </span>
          <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: '96px 1fr', rowGap: 6, ...text14 }}>
            <dt style={{ color: gy.secondary }}>危险源</dt>
            <dd style={{ margin: 0, color: gy.text }}>
              {summary.risks} 项{summary.riskEdited ? `（专家改过 ${summary.riskEdited} 项）` : ''}
            </dd>
            <dt style={{ color: gy.secondary }}>专项预案</dt>
            <dd style={{ margin: 0, color: gy.text }}>{summary.specialty} 份</dd>
            <dt style={{ color: gy.secondary }}>现场处置方案</dt>
            <dd style={{ margin: 0, color: gy.text }}>{summary.site} 份</dd>
            <dt style={{ color: gy.secondary }}>图件</dt>
            <dd style={{ margin: 0, color: gy.text }}>已采用 {summary.figures} 张</dd>
            <dt style={{ color: gy.secondary }}>客户图纸</dt>
            <dd style={{ margin: 0, color: gy.text }}>
              {drawings.isLoading ? '读取中…' : drawingPages ? `附件 7 放 ${drawingPages} 页` : '没有，附件 7 写待补充'}
            </dd>
            {workup.updatedByName && (
              <>
                <dt style={{ color: gy.secondary }}>保存时间</dt>
                <dd style={{ margin: 0, color: gy.text }}>{stamp(workup.updatedAt)}</dd>
              </>
            )}
          </dl>
          <Button block onClick={onBackToWorkup}>
            查看并编辑专业整理
          </Button>
          <span style={{ ...text14, color: gy.secondary, paddingTop: 16, borderTop: `1px solid ${gy.split}` }}>
            {hasDrafts
              ? '已经生成过一批草稿。确认后按现在的资料与整理重新生成三份，替换上一批。'
              : '已保存不等于已采用。确认后锁定左侧资料与本次整理，作为首次生成的依据。'}
          </span>
        </aside>
      </div>

      <section
        aria-label="确认采用"
        style={{ ...card, display: 'flex', alignItems: 'center', gap: 12, padding: 20 }}
      >
        <span style={{ flex: 1, ...text14, color: ready ? gy.secondary : stage.action.color }}>
          {ready ? (
            '确认时会再检查一次资料版本；资料有变化时停留在本页重新核对。'
          ) : (
            <>
              还差 {gaps.length} 项没有整理完，补齐后才能生成。
              <button type="button" style={{ ...linkButton, ...text14, marginLeft: 8 }} onClick={onNextMissing}>
                下一个缺失项
              </button>
            </>
          )}
        </span>
        <Button onClick={onBackToWorkup}>返回专业整理</Button>
        <Button type="primary" disabled={!ready || !materials.data} loading={confirm.isPending} onClick={start}>
          确认采用并生成三份草稿
        </Button>
      </section>
    </div>
  );
}

function MaterialLine({ row, justChanged }: { row: AdoptedMaterial; justChanged: boolean }) {
  const { message } = App.useApp();
  const c = row.change;
  return (
    <li
      aria-label={row.name}
      data-changed={c ? 'true' : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '17px 20px',
        borderTop: `1px solid ${gy.split}`,
        background: c ? gy.warningBg : gy.surface,
        boxShadow: justChanged ? `inset 3px 0 0 ${gy.warning}` : undefined,
        ...text14,
      }}
    >
      <span style={{ flex: 1, minWidth: 0, color: gy.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {row.step ? (
          <>
            {row.name}
            <span style={{ color: gy.secondary }}>　客户自填 · 第 {row.step} 步</span>
          </>
        ) : (
          row.name
        )}
        {justChanged && <span style={{ color: gy.warning }}>　刚有变化</span>}
      </span>
      <span style={{ width: COLS.version, flexShrink: 0, color: gy.text }}>{row.version ? `V${row.version}` : '—'}</span>
      <span style={{ width: COLS.change, flexShrink: 0, color: c ? stage.action.color : stage.done.color }}>
        {!c ? '✓ 与整理时一致' : c.kind === 'newer' ? `资料库已有 V${c.version}（${stamp(c.uploadedAt)}）` : '整理开始后客户上传'}
      </span>
      <span style={{ width: COLS.action, flexShrink: 0, display: 'flex', gap: 16 }}>
        {row.fileId && (
          <button
            type="button"
            style={{ ...linkButton, ...text14 }}
            onClick={() => openFile(row.fileId!).catch(() => message.error('打不开这份文件，请稍后重试'))}
          >
            查看原文件
          </button>
        )}
        {c && (
          <Tooltip title="事实补件即将开放；现在可以先打电话向客户问清">
            <span style={{ ...text14, color: gy.tertiary, cursor: 'not-allowed' }}>发起事实补件</span>
          </Tooltip>
        )}
      </span>
    </li>
  );
}

// 与专家看到的那一版相比：新出现的行、变化提示不同的行
function diff(before: AdoptedMaterial[], after: AdoptedMaterial[]): Set<string> {
  const sig = (r: AdoptedMaterial) => JSON.stringify([r.version, r.change]);
  const old = new Map(before.map((r) => [r.key, sig(r)]));
  return new Set(after.filter((r) => old.get(r.key) !== sig(r)).map((r) => r.key));
}
