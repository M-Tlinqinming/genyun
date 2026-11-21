import {
  CheckCircleFilled,
  CloseOutlined,
  ExclamationCircleFilled,
  FileExcelOutlined,
  InfoCircleOutlined,
  MinusCircleFilled,
  PictureOutlined,
  PlusOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import type { IntakeFileView, IntakeOptionalItem, IntakeView } from '@genyun/shared';
import { useQuery } from '@tanstack/react-query';
import { Button, Popover, Progress } from 'antd';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { fileUrl } from '../../../api/intake';
import wechatQr from '../../../assets/wechat-qr.svg';
import { FileTypeIcon } from '../../../components/FileTypeIcon';
import { gy, type, weight } from '../../../theme/tokens';
import { formatSize, optionalLine, stamp } from './intakeText';
import type { UploadEntry } from './useUploads';

// 准备资料页的各个块：卡片、一行一样东西、提示条、上传过程、右栏小结、已传的图纸和照片

const strong: CSSProperties = { fontWeight: weight.strong, color: gy.text };
const link: CSSProperties = { padding: 0, height: 'auto', ...type.body };

export function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <section
      style={{
        background: gy.surface,
        border: `1px solid ${gy.split}`,
        borderRadius: 8,
        display: 'flex',
        flexDirection: 'column',
        ...style,
      }}
    >
      {children}
    </section>
  );
}

/** 卡片里一节的标题：第一节上下 20，后面的节上 28 下 16、带上分隔线 */
export function CardHead({
  title,
  desc,
  meta,
  action,
  first = false,
}: {
  title: ReactNode;
  desc?: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
  first?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: first ? '20px 24px' : '28px 24px 16px',
        borderTop: first ? undefined : `1px solid ${gy.split}`,
      }}
    >
      <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h2 style={{ margin: 0, ...type.subtitle, ...strong }}>{title}</h2>
        {desc && <div style={{ ...type.body, color: gy.secondary }}>{desc}</div>}
        {meta && <div style={{ ...type.caption, color: gy.tertiary }}>{meta}</div>}
      </div>
      {action && <div style={{ flexShrink: 0, display: 'flex', gap: 12 }}>{action}</div>}
    </div>
  );
}

/**
 * 一行：左边分类（140），中间名称和说明，右边状态（72）和操作；状态、操作可以不要。
 * U1 上传清单：垂直居中，操作栏固定 220，几行的按钮对齐。
 * U2 缺项：顶部对齐（默认），操作栏按内容宽，说明那栏占剩下的宽度。
 */
export function ItemRow({
  tag,
  title,
  desc,
  extra,
  status,
  actions,
  label,
  align = 'top',
  actionsWidth = 220,
}: {
  tag: ReactNode;
  title: ReactNode;
  desc: ReactNode;
  extra?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  label?: string;
  align?: 'top' | 'center';
  actionsWidth?: number | 'auto';
}) {
  return (
    <div
      role="group"
      aria-label={label}
      style={{
        display: 'flex',
        alignItems: align === 'center' ? 'center' : 'flex-start',
        gap: 16,
        padding: '14px 24px',
        borderTop: `1px solid ${gy.split}`,
      }}
    >
      <div style={{ width: 140, flexShrink: 0, ...type.body, color: gy.tertiary }}>{tag}</div>
      <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ ...type.body, ...strong }}>{title}</div>
        <div style={{ ...type.body, color: gy.secondary }}>{desc}</div>
        {extra}
      </div>
      {status !== undefined && (
        <div style={{ width: 72, flexShrink: 0, textAlign: 'right', ...type.body, color: gy.tertiary }}>{status}</div>
      )}
      {actions !== undefined && (
        <div style={{ width: actionsWidth, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 16 }}>
          {actions}
        </div>
      )}
    </div>
  );
}

const NOTICE = {
  error: { bg: gy.errorBg, title: gy.error },
  warning: { bg: gy.warningBg, title: gy.text },
  info: { bg: gy.selected, title: gy.text },
} as const;

/**
 * 带一行粗标题的提示条（12 页 U1c、U1d、U2d、U2e）：浅底、无边框，右边一个文字链接。
 * 左内边距各按各的画板：U1c、U1d、U2d 是 16，U2e 是 24。U2d 前面有 (i) 图标。
 */
export function TitledNotice({
  tone,
  title,
  children,
  action,
  paddingLeft = 24,
  icon,
}: {
  tone: keyof typeof NOTICE;
  title?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  paddingLeft?: 16 | 24;
  icon?: ReactNode;
}) {
  const t = NOTICE[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      data-tone={tone}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: icon ? 8 : 16,
        padding: `12px 16px 12px ${paddingLeft}px`,
        borderRadius: 8,
        background: t.bg,
      }}
    >
      {icon}
      <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {title && <div style={{ ...type.body, fontWeight: weight.strong, color: t.title }}>{title}</div>}
        <div style={{ ...type.body, color: title ? gy.secondary : gy.text }}>{children}</div>
      </div>
      {action && <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>{action}</div>}
    </div>
  );
}

export function LinkButton({
  children,
  onClick,
  href,
  danger,
  ariaLabel,
}: {
  children: ReactNode;
  onClick?: () => void;
  href?: string;
  danger?: boolean;
  ariaLabel?: string;
}) {
  return (
    <Button type="link" danger={danger} style={link} onClick={onClick} href={href} aria-label={ariaLabel}>
      {children}
    </Button>
  );
}

export function UploadButton({ onClick, children = '上传', primary = false }: { onClick: () => void; children?: ReactNode; primary?: boolean }) {
  return (
    <Button
      type={primary ? 'primary' : 'default'}
      icon={<UploadOutlined />}
      onClick={onClick}
      style={primary ? undefined : { borderColor: gy.controlLine, minWidth: 88 }}
    >
      {children}
    </Button>
  );
}

/** 「查看客服二维码」：在链接下方弹出小浮层（12 页 S05）；底栏「联系客服」也用它，从上方弹出 */
export function QrLink({
  children = '查看客服二维码',
  placement = 'bottomRight',
}: {
  children?: ReactNode;
  placement?: 'bottomRight' | 'topLeft';
}) {
  const content = (
    <div style={{ display: 'flex', gap: 16, width: 328, padding: 4 }}>
      <img src={wechatQr} alt="耕云客服企业微信二维码" width={112} height={112} style={{ borderRadius: 6, flexShrink: 0 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 12 }}>
        <span style={{ ...type.body, ...strong }}>耕云客服</span>
        <span style={{ ...type.body, color: gy.secondary }}>用微信扫码，添加企业微信客服。表格看不懂、资料找不到都可以问。</span>
      </div>
    </div>
  );
  return (
    <Popover content={content} trigger="click" placement={placement} arrow={false}>
      <Button type="link" style={link}>
        {children}
      </Button>
    </Popover>
  );
}

export function HelpBar({ children, action }: { children: ReactNode; action: ReactNode }) {
  return (
    <div
      role="note"
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderRadius: 8, background: gy.selected }}
    >
      <InfoCircleOutlined style={{ fontSize: 16, color: gy.primary, flexShrink: 0 }} />
      <div style={{ flex: '1 1 0', ...type.body, color: gy.text }}>{children}</div>
      {action}
    </div>
  );
}

/** 选填没填：一句话加「查看是哪 n 项」，点开就地展开、再点收起（12 页 S05） */
export function OptionalBar({ summary, items }: { summary: string; items: IntakeOptionalItem[] }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <HelpBar action={<LinkButton onClick={() => setOpen(true)}>查看是哪 {items.length} 项</LinkButton>}>{summary}</HelpBar>
    );
  }
  return (
    <div
      role="region"
      aria-label="选填没填的项"
      style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 16px 16px 24px', borderRadius: 8, background: gy.selected }}
    >
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <span style={{ flex: '1 1 0', ...type.body, ...strong }}>另有 {items.length} 项选填没填</span>
        <LinkButton onClick={() => setOpen(false)}>收起</LinkButton>
      </div>
      <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 4, ...type.body, color: gy.secondary }}>
        {items.map((item) => (
          <li key={`${item.field}-${item.row ?? ''}`}>{optionalLine(item)}</li>
        ))}
      </ul>
      <div style={{ ...type.caption, color: gy.secondary }}>可以不填，不影响提交。想现在补，在表格里填好再整份重新上传。</div>
    </div>
  );
}

// ---- 上传过程（S02） ----

export function UploadsCard({
  entries,
  onCancel,
  onRetry,
  onDismiss,
}: {
  entries: UploadEntry[];
  onCancel: (key: number) => void;
  onRetry: (entry: UploadEntry) => void;
  onDismiss: (key: number) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <Card style={{ padding: '0 24px' }}>
      <h2 style={{ margin: 0, padding: '20px 0 12px', ...type.subtitle, ...strong }}>上传填好的表格和图纸</h2>
      {entries.map((e) => (
        <div
          key={e.key}
          role="group"
          aria-label={`上传 ${e.file.name}`}
          style={{ borderTop: `1px solid ${gy.split}`, padding: '14px 0', display: 'flex', flexDirection: 'column', gap: 4 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <span style={{ ...type.body, color: gy.text, overflowWrap: 'anywhere' }}>{e.file.name}</span>
              {(e.state.kind === 'failed' || e.state.kind === 'rejected') && (
                <span style={{ ...type.caption, color: gy.error }}>{e.state.message}</span>
              )}
            </div>
            {e.state.kind === 'uploading' && (
              <>
                <span style={{ ...type.caption, color: gy.secondary }}>正在上传 {e.state.percent}%</span>
                <LinkButton onClick={() => onCancel(e.key)}>取消</LinkButton>
              </>
            )}
            {e.state.kind === 'saving' && (
              <span style={{ ...type.caption, color: gy.secondary }}>
                {e.slot === 'data_sheet' ? '已上传，正在读表格…' : '已上传，正在保存…'}
              </span>
            )}
            {e.state.kind === 'failed' && (
              <Button onClick={() => onRetry(e)} style={{ borderColor: gy.controlLine }}>
                重试
              </Button>
            )}
            {(e.state.kind === 'failed' || e.state.kind === 'rejected') && (
              <Button type="text" style={{ ...link, color: gy.secondary }} onClick={() => onDismiss(e.key)}>
                移除
              </Button>
            )}
          </div>
          {e.state.kind === 'uploading' && (
            <Progress percent={e.state.percent} showInfo={false} size="small" strokeColor={gy.primary} railColor={gy.neutralBg} />
          )}
        </div>
      ))}
    </Card>
  );
}

// ---- 右栏：资料表格和图纸的小结 ----

const ok = <CheckCircleFilled style={{ color: gy.success, fontSize: 14 }} aria-label="已齐" />;
const bad = <ExclamationCircleFilled style={{ color: gy.error, fontSize: 14 }} aria-label="缺" />;
const waived = <MinusCircleFilled style={{ color: gy.warning, fontSize: 14 }} aria-label="已说明没有" />;

function SummaryLine({ icon, name, sub, right }: { icon: ReactNode; name: ReactNode; sub?: ReactNode; right: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 14, display: 'flex', flexShrink: 0 }}>{icon}</span>
      <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <span style={{ ...type.body, color: gy.text }}>{name}</span>
        {sub && <span style={{ ...type.caption, color: gy.tertiary, overflowWrap: 'anywhere' }}>{sub}</span>}
      </div>
      <span style={{ flexShrink: 0, ...type.caption }}>{right}</span>
    </div>
  );
}

export function SheetSummary({
  view,
  canEdit,
  onReplaceSitePlan,
}: {
  view: IntakeView;
  canEdit: boolean;
  onReplaceSitePlan: () => void;
}) {
  const sheet = view.dataSheet;
  if (!sheet) return null;
  const evac = view.evacuationMaps;
  return (
    <Card style={{ width: 340, flexShrink: 0, alignSelf: 'flex-start' }}>
      <div style={{ padding: '20px 20px 16px', display: 'flex', flexDirection: 'column', gap: 16 }} aria-label="资料表格" role="group">
        <div style={{ display: 'flex', gap: 12 }}>
          <FileExcelOutlined style={{ fontSize: 20, color: gy.success, marginTop: 2 }} />
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span style={{ ...type.body, ...strong, overflowWrap: 'anywhere' }}>{sheet.file.originalName}</span>
            <span style={{ ...type.caption, color: gy.tertiary }}>
              {stamp(sheet.file.uploadedAt)} 上传{sheet.oldTemplate ? ' · 旧版模板' : ''} · 读到 {sheet.sheets.length} 张表
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingLeft: 32 }}>
          {sheet.sheets.map((s) => (
            <SummaryLine
              key={s.name}
              icon={s.missing === 0 ? ok : bad}
              name={s.name}
              right={
                s.missing === 0 ? (
                  <span style={{ color: gy.tertiary }}>必填已齐</span>
                ) : (
                  <span style={{ color: gy.error, fontWeight: weight.strong }}>缺 {s.missing} 项</span>
                )
              }
            />
          ))}
        </div>
      </div>
      <div
        role="group"
        aria-label="图纸与照片"
        style={{ borderTop: `1px solid ${gy.split}`, padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <span style={{ ...type.caption, color: gy.tertiary }}>图纸与照片</span>
        <SummaryLine
          icon={view.sitePlan ? ok : bad}
          name="总平面布置图"
          sub={view.sitePlan?.originalName}
          right={
            view.sitePlan ? (
              canEdit && <LinkButton onClick={onReplaceSitePlan}>替换</LinkButton>
            ) : (
              <span style={{ color: gy.error, fontWeight: weight.strong }}>还没传</span>
            )
          }
        />
        <SummaryLine
          icon={evac.length > 0 ? ok : view.noEvacuationMap ? waived : bad}
          name="紧急疏散示意图"
          sub={evac.length > 0 ? (evac.length === 1 ? evac[0]!.originalName : `${evac[0]!.originalName} 等 ${evac.length} 张`) : undefined}
          right={
            evac.length > 0 ? (
              <span style={{ color: gy.tertiary }}>已传</span>
            ) : view.noEvacuationMap ? (
              <span style={{ color: gy.warning, fontWeight: weight.strong }}>已说明没有</span>
            ) : (
              <span style={{ color: gy.error, fontWeight: weight.strong }}>还没传</span>
            )
          }
        />
        <SummaryLine
          icon={<PictureOutlined style={{ color: gy.tertiary, fontSize: 14 }} />}
          name="其他图纸与照片 · 选填"
          right={<span style={{ color: gy.tertiary }}>{view.others.length > 0 ? `已传 ${view.others.length} 张` : '还没传'}</span>}
        />
      </div>
    </Card>
  );
}

// ---- 已传的图纸和照片（S03） ----

const isPicture = (contentType: string) => /^image\/(jpeg|png|webp)$/.test(contentType);

function Thumb({ file, onView, onRemove }: { file: IntakeFileView; onView: () => void; onRemove?: () => void }) {
  const picture = isPicture(file.contentType);
  const url = useQuery({
    queryKey: ['files', file.fileId, 'inline-url'],
    queryFn: () => fileUrl(file.fileId, true),
    enabled: picture,
    staleTime: 4 * 60 * 1000,
  });
  return (
    <div style={{ position: 'relative', width: 72, height: 72 }}>
      <button
        type="button"
        onClick={onView}
        title={file.originalName}
        aria-label={`查看 ${file.originalName}`}
        style={{
          width: 72,
          height: 72,
          padding: 0,
          border: 'none',
          borderRadius: 6,
          overflow: 'hidden',
          background: gy.neutralBg,
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
        }}
      >
        {picture && url.data ? (
          <img src={url.data.url} alt="" style={{ width: 72, height: 72, objectFit: 'cover' }} />
        ) : (
          <>
            <FileTypeIcon contentType={file.contentType} />
            <span
              style={{
                ...type.caption,
                color: gy.secondary,
                maxWidth: 64,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {file.originalName}
            </span>
          </>
        )}
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`删除 ${file.originalName}`}
          style={{
            position: 'absolute',
            top: 4,
            right: 4,
            width: 20,
            height: 20,
            borderRadius: 10,
            border: 'none',
            background: gy.mask,
            color: gy.surface,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
          }}
        >
          <CloseOutlined style={{ fontSize: 12 }} />
        </button>
      )}
    </div>
  );
}

function DrawingSection({ label, sub, children }: { label: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <div
      role="group"
      aria-label={label}
      style={{ display: 'flex', gap: 16, padding: '16px 0 24px', borderTop: `1px solid ${gy.split}` }}
    >
      <div style={{ width: 156, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
        <span style={{ ...type.body, color: gy.secondary }}>{label}</span>
        {sub && <span style={{ ...type.caption, color: gy.tertiary }}>{sub}</span>}
      </div>
      <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
    </div>
  );
}

function FileLine({ file, actions }: { file: IntakeFileView; actions: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <span style={{ ...type.body, color: gy.text, overflowWrap: 'anywhere' }}>{file.originalName}</span>
      </div>
      <div style={{ display: 'flex', gap: 12, flexShrink: 0 }}>{actions}</div>
    </div>
  );
}

/**
 * 两张必传的图，「上传」「这张图我们没有」「撤销，我要上传」整页只放一处：
 * 还没传的在上面那一行（把这几样传上来 / 在这里直接传），这里只写「还没传」；
 * 读到表格以后说明了没有的疏散图已不在缺项里，撤销放在这里（undoNoEvacuationHere），没读到表格时上面那一行已经有撤销
 */
export function DrawingsCard({
  view,
  canEdit,
  pick,
  onView,
  onRemove,
  onUndoNoEvacuation,
  undoNoEvacuationHere,
}: {
  view: IntakeView;
  canEdit: boolean;
  pick: (slot: 'site_plan' | 'evacuation_map' | 'other') => void;
  onView: (file: IntakeFileView) => void;
  onRemove: (file: IntakeFileView) => void;
  onUndoNoEvacuation: () => void;
  undoNoEvacuationHere: boolean;
}) {
  const plan = view.sitePlan;
  const notYet = <span style={{ ...type.body, color: gy.tertiary }}>还没传</span>;
  return (
    <Card style={{ padding: '20px 24px 0' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingBottom: 12 }}>
        <h2 style={{ margin: 0, ...type.subtitle, ...strong }}>已传的图纸和照片</h2>
        <span style={{ ...type.body, color: gy.secondary }}>
          {canEdit ? '提交给专家之前，都可以换掉或删掉。' : '这里能查看已经传上来的图纸和照片。'}
        </span>
      </div>
      <DrawingSection label="总平面布置图">
        {plan ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <span style={{ ...type.body, color: gy.text, overflowWrap: 'anywhere' }}>{plan.originalName}</span>
              <span style={{ ...type.caption, color: gy.tertiary }}>
                {stamp(plan.uploadedAt)} 上传 · {formatSize(plan.sizeBytes)}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 12, flexShrink: 0 }}>
              <LinkButton onClick={() => onView(plan)}>查看</LinkButton>
              {canEdit && <LinkButton onClick={() => pick('site_plan')}>替换</LinkButton>}
            </div>
          </div>
        ) : (
          notYet
        )}
      </DrawingSection>
      <DrawingSection label="紧急疏散示意图">
        {view.evacuationMaps.map((f) => (
          <FileLine
            key={f.id}
            file={f}
            actions={
              <>
                <LinkButton onClick={() => onView(f)}>查看</LinkButton>
                {canEdit && <LinkButton onClick={() => onRemove(f)}>删除</LinkButton>}
              </>
            }
          />
        ))}
        {view.evacuationMaps.length > 0 && canEdit && (
          <div>
            <LinkButton onClick={() => pick('evacuation_map')}>
              <PlusOutlined /> 再传一张
            </LinkButton>
          </div>
        )}
        {view.evacuationMaps.length === 0 &&
          (view.noEvacuationMap ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ flex: '1 1 0' }}>
                <span style={{ ...type.caption, color: gy.secondary, background: gy.neutralBg, borderRadius: 4, padding: '1px 8px' }}>
                  已说明没有
                </span>
              </span>
              {canEdit && undoNoEvacuationHere && <LinkButton onClick={onUndoNoEvacuation}>撤销，我要上传</LinkButton>}
            </div>
          ) : (
            notYet
          ))}
      </DrawingSection>
      <DrawingSection label="其他图纸与照片 · 选填" sub={view.others.length > 0 ? `已传 ${view.others.length} 张` : undefined}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {view.others.map((f) => (
            <Thumb key={f.id} file={f} onView={() => onView(f)} onRemove={canEdit ? () => onRemove(f) : undefined} />
          ))}
          {canEdit && (
            <button
              type="button"
              onClick={() => pick('other')}
              style={{
                width: 72,
                height: 72,
                borderRadius: 6,
                border: `1px dashed ${gy.controlLine}`,
                background: gy.surface,
                color: gy.secondary,
                cursor: 'pointer',
                ...type.caption,
              }}
            >
              <PlusOutlined /> 添加
            </button>
          )}
          {!canEdit && view.others.length === 0 && notYet}
        </div>
      </DrawingSection>
    </Card>
  );
}
