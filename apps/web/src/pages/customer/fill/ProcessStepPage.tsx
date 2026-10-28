import { CheckOutlined, LoadingOutlined } from '@ant-design/icons';
import {
  checkProcessEquipment,
  newId,
  PROCESS_STEP_MAX,
  PROCESS_TEMPLATE_IDS,
  PROCESS_TEMPLATES,
  recommendedTemplate,
  snakeRows,
  stepsFromDescription,
  stepsFromTemplate,
  type DraftProcessStep,
  type ProcessDraft,
  type ProcessTemplateId,
  type ProductionStep,
} from '@genyun/shared';
import { App, Button, Input, Modal, Popconfirm, Upload } from 'antd';
import { Fragment, useState, type CSSProperties, type ReactNode } from 'react';
import type { Task } from '../../../api/tasks';
import { gy, source } from '../../../theme/tokens';
import { OnSiteDialog } from '../OnSiteVisit';
import { AFTER_FILLING, FillCard, FillFrame, SidePanel, StepTitle } from './FillFrame';
import { useProductionDraft } from './useProductionDraft';
import { linkButton, Loading } from '../../../components/ui';

const IMAGE_ACCEPT = '.jpg,.jpeg,.png,.pdf';
const newStepId = () => newId('p');
const named = (steps: DraftProcessStep[]) => steps.filter((s) => s.name.trim() !== '');

const link: CSSProperties = linkButton;

// S03b 企业自填第 3 步第 2 页「工艺流程」：选行业模板再增删工序，或写一句话、拍照上传；流程图自动生成
export function ProcessStepPage({ task }: { task: Task }) {
  const { modal } = App.useApp();
  const { step, saved, fileNames, uploading, leaving, autosave, update, leave, upload, removeLinked } =
    useProductionDraft(task);
  const [booking, setBooking] = useState(false);
  const process = step?.process;
  const setProcess = (p: ProcessDraft) => step && update({ ...step, process: p });

  // 替换已有工序前先问一句
  const replaceSteps = (count: number, title: string, run: () => void) => {
    if (count === 0) return run();
    modal.confirm({
      title,
      content: `现在的 ${count} 道工序会被替换。`,
      okText: '替换',
      cancelText: '取消',
      onOk: run,
    });
  };

  const steps = process ? named(process.steps) : [];
  const summary = !process
    ? ''
    : steps.length > 0
      ? `工艺流程已有 ${steps.length} 道工序${
          process.source === 'template' ? '，来自行业模板' : process.source === 'text' ? '，来自一句话描述' : ''
        }`
      : process.sketchFileIds.length > 0
        ? `已上传 ${process.sketchFileIds.length} 份流程图`
        : process.description
          ? '已写一句话描述'
          : '还没有填写工艺流程';

  const footer = (
    <>
      <span style={{ fontSize: 14, lineHeight: '22px', color: gy.tertiary }}>
        第 3 步（共 2 页）{summary && ` · ${summary}`}
      </span>
      <div style={{ display: 'flex', gap: 12 }}>
        <Button size="large" disabled={leaving} onClick={() => void leave(`/customer/tasks/${task.id}/fill/3`)}>
          上一页
        </Button>
        <Button
          size="large"
          type="primary"
          loading={leaving}
          onClick={() => void leave(`/customer/tasks/${task.id}/fill/4`)}
        >
          下一步：应急资源与图纸
        </Button>
      </div>
    </>
  );

  return (
    <FillFrame
      step={3}
      enterpriseName={task.enterpriseName}
      saveState={autosave.state}
      savedAt={autosave.savedAt}
      onExit={() => void leave(`/customer/enterprises/${task.enterpriseId}`)}
      exiting={leaving}
      footer={footer}
    >
      <div style={{ width: 760, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <StepTitle
          title="您的产品是怎么做出来的"
          description="选一个最接近的行业模板，再按实际情况增删工序。不用自己画图，系统会自动生成。"
        />
        {!step || !process ? (
          <div style={{ flex: 1 }}><Loading rows={8} /></div>
        ) : (
          <>
            <TemplateCard
              process={process}
              businessScope={saved.current?.businessScope ?? null}
              fileNames={fileNames}
              uploading={uploading === 'sketch'}
              onTemplate={(templateId) =>
                replaceSteps(steps.length, `换成「${PROCESS_TEMPLATES[templateId].label}」？`, () =>
                  setProcess({
                    ...process,
                    source: 'template',
                    templateId,
                    steps: stepsFromTemplate(templateId, newStepId),
                  }),
                )
              }
              onDescription={(description) => setProcess({ ...process, source: 'text', description })}
              onSplit={() =>
                replaceSteps(steps.length, '按这句话重新生成工序？', () =>
                  setProcess({
                    ...process,
                    source: 'text',
                    steps: stepsFromDescription(process.description ?? '', newStepId),
                  }),
                )
              }
              onSketch={(file) =>
                upload(
                  'sketch',
                  file,
                  'image_or_pdf',
                  (s, fileId) => ({
                    ...s,
                    process: { ...s.process, source: 'sketch', sketchFileIds: [...s.process.sketchFileIds, fileId] },
                  }),
                  'process_flow',
                )
              }
              onOnSite={() => setBooking(true)}
              onRemoveSketch={(fileId) =>
                void removeLinked('process_flow', fileId, (s, id) => ({
                  ...s,
                  process: { ...s.process, sketchFileIds: s.process.sketchFileIds.filter((f) => f !== id) },
                }))
              }
            />
            <StepsCard step={step} onChange={update} />
            <ChartCard steps={steps} />
          </>
        )}
      </div>

      <SidePanel
        why={[
          '工艺流程图是预案的附图之一。每道工序的风险不同：电焊对应触电与烫伤，电芯检测对应短路起火，注册安全工程师据此辨识危险源。',
          '顺序大致对就行，专家审核时会再确认。没有接近的模板，也可以写一句话或拍照上传。',
        ]}
        after={AFTER_FILLING}
      />
      <OnSiteDialog taskId={task.id} open={booking} onClose={() => setBooking(false)} />
    </FillFrame>
  );
}

function CardHeading({ title, description, extra }: { title: string; description: string; extra?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <h2 style={{ margin: 0, fontSize: 16, lineHeight: '24px', fontWeight: 600, color: gy.text }}>{title}</h2>
        <p style={{ margin: 0, fontSize: 13, lineHeight: '20px', color: gy.tertiary }}>{description}</p>
      </div>
      {extra}
    </div>
  );
}

const chip: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 36,
  padding: '0 14px',
  borderRadius: 18,
  // 分开写边框，选中样式只改颜色
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: '#D9D9D9',
  background: gy.surface,
  color: gy.text,
  fontSize: 14,
  lineHeight: '22px',
  cursor: 'pointer',
  fontFamily: 'inherit',
};
const chipOn: CSSProperties = { ...chip, background: gy.selected, borderColor: gy.primary, color: gy.primary };

function TemplateCard({
  process,
  businessScope,
  fileNames,
  uploading,
  onTemplate,
  onDescription,
  onSplit,
  onSketch,
  onRemoveSketch,
  onOnSite,
}: {
  process: ProcessDraft;
  businessScope: string | null;
  fileNames: Record<string, string>;
  uploading: boolean;
  onTemplate: (id: ProcessTemplateId) => void;
  onDescription: (text: string) => void;
  onSplit: () => void;
  onSketch: (file: File) => void;
  onRemoveSketch: (fileId: string) => void;
  onOnSite: () => void;
}) {
  const recommended = recommendedTemplate(businessScope ?? undefined);
  // 推荐的排在最前
  const ids = recommended ? [recommended, ...PROCESS_TEMPLATE_IDS.filter((t) => t !== recommended)] : PROCESS_TEMPLATE_IDS;
  const selected = process.source === 'template' ? process.templateId : undefined;
  const [writing, setWriting] = useState(Boolean(process.description));
  const canSplit = stepsFromDescription(process.description ?? '', () => '').length > 0;

  return (
    <FillCard>
      <CardHeading
        title="从行业模板开始"
        description={
          recommended
            ? '按经营范围推荐。选中后工序和常用设备会一起预填。'
            : '选一个最接近的。选中后工序和常用设备会一起预填。'
        }
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {ids.map((tid) => {
          const on = selected === tid;
          return (
            <button
              key={tid}
              type="button"
              aria-pressed={on}
              style={on ? chipOn : chip}
              onClick={() => !on && onTemplate(tid)}
            >
              {on && <CheckOutlined aria-hidden style={{ fontSize: 12 }} />}
              {PROCESS_TEMPLATES[tid].label}
              {tid === recommended && (
                <span
                  style={{
                    padding: '0 6px',
                    borderRadius: 4,
                    fontSize: 12,
                    lineHeight: '18px',
                    color: gy.primary,
                    background: on ? gy.surface : gy.selected,
                  }}
                >
                  推荐
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          paddingTop: 12,
          borderTop: '1px solid #EEF0F3',
        }}
      >
        <span style={{ fontSize: 13, lineHeight: '20px', color: gy.tertiary }}>都不像？</span>
        <button type="button" style={link} onClick={() => setWriting(true)}>
          写一句话描述
        </button>
        <Upload
          accept={IMAGE_ACCEPT}
          multiple
          showUploadList={false}
          disabled={uploading}
          beforeUpload={(file) => {
            onSketch(file);
            return false;
          }}
        >
          <button type="button" style={link}>
            {uploading && <LoadingOutlined style={{ marginRight: 6 }} />}
            拍照上传已有流程图
          </button>
        </Upload>
        <button type="button" style={link} onClick={onOnSite}>
          预约耕云上门整理
        </button>
      </div>
      {writing && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Input.TextArea
            aria-label="一句话描述生产过程"
            autoFocus={!process.description}
            autoSize={{ minRows: 2, maxRows: 5 }}
            maxLength={500}
            placeholder="按先后顺序写，用顿号隔开，如：熔融、压铸、攻牙、喷砂、组装、品质检测、包装出货"
            value={process.description ?? ''}
            onChange={(e) => onDescription(e.target.value)}
          />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ fontSize: 12, lineHeight: '18px', color: gy.tertiary }}>
              写好后可以拆成下面的工序，自动画出流程图；只写这句话也可以，专家会帮您整理。
            </span>
            <Button disabled={!canSplit} onClick={onSplit}>
              按这句话生成工序
            </Button>
          </div>
        </div>
      )}
      {process.sketchFileIds.map((id) => (
        <div
          key={id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '6px 6px 6px 12px',
            borderRadius: 6,
            background: '#F3F7FF',
            border: '1px solid #CFDDFB',
          }}
        >
          <span style={{ flex: 1, fontSize: 13, lineHeight: '20px', color: gy.text }}>
            已有流程图：{fileNames[id] ?? '照片'}
          </span>
          <Popconfirm title="移除这个文件？" okText="移除" cancelText="取消" onConfirm={() => onRemoveSketch(id)}>
            <Button type="link" size="small">
              移除
            </Button>
          </Popconfirm>
        </div>
      ))}
    </FillCard>
  );
}

function StepsCard({ step, onChange }: { step: ProductionStep; onChange: (s: ProductionStep) => void }) {
  const steps = step.process.steps;
  const [editing, setEditing] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const setSteps = (next: DraftProcessStep[]) => onChange({ ...step, process: { ...step.process, steps: next } });

  const rename = (id: string, name: string) => setSteps(steps.map((s) => (s.id === id ? { ...s, name } : s)));
  // 改完名称：清空了就当删掉
  const commit = (id: string) => {
    setEditing(null);
    if (steps.find((s) => s.id === id)?.name.trim() === '') setSteps(steps.filter((s) => s.id !== id));
  };
  const add = () => {
    const created = { id: newStepId(), name: '', equipment: [] };
    setSteps([...steps, created]);
    setEditing(created.id);
  };
  const moveBefore = (dragId: string, targetId: string) => {
    if (dragId === targetId) return;
    const moving = steps.find((s) => s.id === dragId);
    if (!moving) return;
    const rest = steps.filter((s) => s.id !== dragId);
    const at = rest.findIndex((s) => s.id === targetId);
    // 往后拖放到目标后面，往前拖放到目标前面
    const after = steps.findIndex((s) => s.id === dragId) < steps.findIndex((s) => s.id === targetId);
    rest.splice(after ? at + 1 : at, 0, moving);
    setSteps(rest);
  };

  const check = checkProcessEquipment(step.process.steps, step.equipment);
  const addMissing = () =>
    onChange({
      ...step,
      equipment: [
        ...step.equipment.filter((e) => e.name.trim() !== ''),
        ...check.missing.map((name) => ({ id: newId('e'), name })),
      ],
    });

  return (
    <FillCard>
      <CardHeading
        title="按您工厂的实际顺序调整"
        description="拖动调整先后，点 × 删除不做的工序，点名称可直接改。"
      />
      {steps.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, lineHeight: '20px', color: gy.tertiary }}>
          还没有工序。选上面的行业模板，或者直接添加。
        </p>
      ) : null}
      <ol
        aria-label="工序"
        style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: 0, padding: 0, listStyle: 'none' }}
      >
        {steps.map((s, i) => (
          <li
            key={s.id}
            data-testid="process-step"
            draggable={editing !== s.id}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', s.id);
              setDragging(s.id);
            }}
            onDragEnd={() => setDragging(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              moveBefore(e.dataTransfer.getData('text/plain') || dragging || '', s.id);
              setDragging(null);
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              height: 36,
              padding: '0 10px 0 6px',
              borderRadius: 6,
              // 拖动时其余工序显示虚线框，提示可以放下
              borderWidth: 1,
              borderStyle: dragging && dragging !== s.id ? 'dashed' : 'solid',
              borderColor: dragging && dragging !== s.id ? gy.primary : '#D9D9D9',
              background: gy.surface,
              opacity: dragging === s.id ? 0.4 : 1,
              cursor: editing === s.id ? 'default' : 'grab',
            }}
          >
            <span
              aria-hidden
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 22,
                height: 22,
                flexShrink: 0,
                borderRadius: 11,
                background: '#F0F2F5',
                fontSize: 12,
                lineHeight: '18px',
                color: gy.secondary,
              }}
            >
              {i + 1}
            </span>
            {editing === s.id ? (
              <Input
                autoFocus
                size="small"
                aria-label={`第 ${i + 1} 道工序名称`}
                variant="borderless"
                maxLength={20}
                placeholder="工序名称"
                style={{ width: Math.max(96, s.name.length * 15 + 24), padding: 0, fontSize: 14 }}
                value={s.name}
                onChange={(e) => rename(s.id, e.target.value)}
                onPressEnter={() => commit(s.id)}
                onBlur={() => commit(s.id)}
              />
            ) : (
              <button
                type="button"
                title="点击修改名称"
                style={{ ...link, color: gy.text, cursor: 'text' }}
                onClick={() => setEditing(s.id)}
              >
                {s.name}
              </button>
            )}
            <button
              type="button"
              aria-label={`删除工序${s.name}`}
              style={{ ...link, color: '#A0A7B4', fontSize: 16 }}
              onClick={() => setSteps(steps.filter((x) => x.id !== s.id))}
            >
              ×
            </button>
          </li>
        ))}
        {steps.length < PROCESS_STEP_MAX && (
          <li>
            <button
              type="button"
              style={{
                ...link,
                height: 36,
                padding: '0 12px',
                borderRadius: 6,
                border: '1px dashed #A9B4C6',
              }}
              onClick={add}
            >
              + 添加工序
            </button>
          </li>
        )}
      </ol>
      {(check.linked.length > 0 || check.missing.length > 0) && (
        <div
          role="note"
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            padding: '10px 12px',
            borderRadius: 6,
            background: source.system.bg,
          }}
        >
          <span style={{ flexShrink: 0, fontSize: 13, lineHeight: '20px', fontWeight: 500, color: source.system.color }}>
            系统提示
          </span>
          <span style={{ fontSize: 13, lineHeight: '20px', color: gy.text }}>
            {check.linked
              .slice(0, 2)
              .map((l) => `「${l.step}」已关联设备表中的${l.equipment}${l.quantity ? ` ${l.quantity}` : ''}`)
              .join('；')}
            {check.linked.length > 0 && check.missing.length > 0 && '；'}
            {check.missing.length > 0 && (
              <>
                工序用到的{check.missing.join('、')}尚未在设备表中，
                <button type="button" style={{ ...link, fontSize: 13, lineHeight: '20px' }} onClick={addMissing}>
                  加到设备表
                </button>
              </>
            )}
          </span>
        </div>
      )}
    </FillCard>
  );
}

function ChartCard({ steps }: { steps: DraftProcessStep[] }) {
  const [zoom, setZoom] = useState(false);
  return (
    <FillCard>
      <CardHeading
        title="自动生成的工艺流程图"
        description="改动工序后实时更新；这张图会放进预案附图，专家审核时可微调。"
        extra={
          steps.length > 0 && (
            <button type="button" style={{ ...link, flexShrink: 0 }} onClick={() => setZoom(true)}>
              放大预览
            </button>
          )
        }
      />
      <FlowChart steps={steps} />
      <Modal
        title="生产工艺流程图"
        open={zoom}
        width={1000}
        footer={null}
        onCancel={() => setZoom(false)}
        styles={{ body: { paddingTop: 8 } }}
      >
        <FlowChart steps={steps} scale={1.3} />
      </Modal>
    </FillCard>
  );
}

const PER_ROW = 5;
const INK = gy.text;

// 方框加箭头，每行 5 道，蛇形折行（与 Word 附图同一规则）
export function FlowChart({ steps, scale = 1 }: { steps: DraftProcessStep[]; scale?: number }) {
  const box = { width: 112 * scale, height: 44 * scale };
  const gap = 28 * scale;
  const width = box.width * PER_ROW + gap * (PER_ROW - 1);
  const rows = snakeRows(steps, PER_ROW);
  return (
    <figure
      data-testid="process-chart"
      style={{
        margin: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '32px 0',
        borderRadius: 6,
        background: '#FAFBFC',
        border: '1px solid #EEF0F3',
      }}
    >
      {rows.length === 0 ? (
        <span style={{ padding: '24px 0', fontSize: 13, lineHeight: '20px', color: gy.tertiary }}>
          选模板或添加工序后，这里自动画出流程图
        </span>
      ) : (
        rows.map((row, r) => (
          <Fragment key={r}>
            {r > 0 && (
              // 上一行的末尾向下接到这一行：正向行末在右，反向行末在左
              <div
                style={{
                  display: 'flex',
                  justifyContent: rows[r - 1]!.reversed ? 'flex-start' : 'flex-end',
                  width,
                }}
              >
                <div style={{ width: box.width, display: 'flex', justifyContent: 'center' }}>
                  <svg width={12} height={36 * scale} viewBox="0 0 12 36" preserveAspectRatio="none" aria-hidden>
                    <path
                      d="M6 4v26M2 25l4 5 4-5"
                      fill="none"
                      stroke={INK}
                      strokeWidth="1.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              </div>
            )}
            <div
              data-testid="process-chart-row"
              style={{ display: 'flex', alignItems: 'center', justifyContent: row.reversed ? 'flex-end' : 'flex-start', width }}
            >
              {row.items.map((s, i) => (
                <Fragment key={s.id}>
                  {i > 0 && (
                    <svg width={gap} height={12} viewBox="0 0 28 12" aria-hidden style={{ flexShrink: 0 }}>
                      <path
                        d={row.reversed ? 'M25 6H5M10 2L5 6l5 4' : 'M3 6h20M18 2l5 4-5 4'}
                        fill="none"
                        stroke={INK}
                        strokeWidth="1.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      width: box.width,
                      minHeight: box.height,
                      padding: '2px 6px',
                      boxSizing: 'border-box',
                      border: `1.2px solid ${INK}`,
                      background: gy.surface,
                      color: INK,
                      fontSize: 14 * scale,
                      lineHeight: `${20 * scale}px`,
                      textAlign: 'center',
                    }}
                  >
                    {s.name}
                  </div>
                </Fragment>
              ))}
            </div>
          </Fragment>
        ))
      )}
      <figcaption style={{ paddingTop: 20, fontSize: 13, lineHeight: '20px', color: '#3F4A5C' }}>
        附图　生产工艺流程图
      </figcaption>
    </figure>
  );
}
