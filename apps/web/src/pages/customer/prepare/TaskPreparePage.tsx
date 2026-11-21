import { CheckOutlined, DownloadOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { INTAKE_TEMPLATE_VERSION, type IntakeFileSlot, type IntakeFileView, type IntakeView } from '@genyun/shared';
import { useQueryClient } from '@tanstack/react-query';
import { App, Button, Modal, Result, Spin } from 'antd';
import { useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import {
  INTAKE_TEMPLATE_URL,
  downloadFile,
  intakeKey,
  removeIntakeFile,
  setNoEvacuationMap,
  useIntake,
  viewFile,
} from '../../../api/intake';
import { ApiError } from '../../../api/request';
import { useTask } from '../../../api/tasks';
import { membershipsIn, useSession } from '../../../auth/session';
import { ActionBar } from '../../../components/ActionBar';
import { CUSTOMER_STAGES, WizardLayout } from '../../../layouts/WizardLayout';
import { DeleteTaskDialog, SubmitDialog } from '../submitted/dialogs';
import { gy, type, weight } from '../../../theme/tokens';
import {
  Card,
  CardHead,
  DrawingsCard,
  HelpBar,
  ItemRow,
  LinkButton,
  OptionalBar,
  QrLink,
  SheetSummary,
  TitledNotice,
  UploadButton,
  UploadsCard,
} from './IntakeParts';
import {
  clock,
  dayLabel,
  footerNote,
  headline,
  missingSplit,
  optionalNote,
  optionalSummary,
  phaseOf,
  shortName,
  stamp,
} from './intakeText';
import { useUploads } from './useUploads';

// 准备资料（12 页 U1–U2e，S02–S05）：下载资料模板，填好整份传上来，再传两张必填图。
// 系统读表格、列出缺的必填；必填齐了「提交给专家」才能点（确认弹窗 U2c）。还没提交的可以删除任务（S06）。
// 撤回以后回到这里，顶部一直提示已撤回，直到再次提交（S01 ②）。

const DRAWING_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.dwg,.dxf';
const ACCEPT: Record<IntakeFileSlot, string> = {
  data_sheet: '.xlsx',
  site_plan: DRAWING_ACCEPT,
  evacuation_map: DRAWING_ACCEPT,
  other: DRAWING_ACCEPT,
};

const SHEET_DESC = '只收这份资料模板，整份上传，不用拆表。.xlsx，20 MB 以内；可以反复重传，以最后一次为准。';
const SITE_PLAN_DESC = '手绘拍照也可以。PDF、图片、CAD 都可以。';
const EVACUATION_DESC = '手绘拍照也可以。确实没有的，点「这张图我们没有」，也能提交。';
const OTHER_DESC = '营业执照、消防设施布置图、安全相关证照，车间、仓库、消防设施现场照片。PDF、图片、CAD 都可以，可多选。';
const TEMPLATE_DESC =
  '一份 Excel，分 6 张表：企业信息、建筑与场所、生产与设备、原辅料与危化品、应急组织、应急资源。带「*」且黄色底纹的格子必填，其余可以留空。';

export function TaskPreparePage() {
  const session = useSession();
  const { taskId = '' } = useParams();
  const navigate = useNavigate();
  const task = useTask(taskId);
  const isIntake = task.data?.flow === 'intake' && task.data.status === 'preparing';
  const intake = useIntake(taskId, isIntake);

  if (session.isPending) return <Spin fullscreen />;
  if (!session.data || membershipsIn(session.data, 'customer').length === 0) return <Navigate to="/login" replace />;

  const back = (
    <Button onClick={() => navigate('/customer')} style={{ borderColor: gy.controlLine }}>
      返回工作台
    </Button>
  );

  if (task.isPending) return <Spin fullscreen />;
  if (task.isError) {
    const notFound = task.error instanceof ApiError && task.error.status === 404;
    return (
      <WizardLayout stages={CUSTOMER_STAGES} current={0} headerExtra={back}>
        <Result
          status={notFound ? '404' : 'error'}
          title={notFound ? '找不到这个任务' : '任务加载失败'}
          subTitle={notFound ? '任务可能已删除，或您没有查看权限。' : task.error.message}
          extra={<Link to="/customer/tasks">返回任务列表</Link>}
        />
      </WizardLayout>
    );
  }
  // 旧任务、已经提交的任务：看任务详情页
  if (!isIntake) return <Navigate to={`/customer/tasks/${taskId}`} replace />;

  if (intake.isPending) return <Spin fullscreen />;
  if (intake.isError) {
    return (
      <WizardLayout
        title="编制应急预案"
        enterpriseName={task.data.enterpriseName}
        stages={CUSTOMER_STAGES}
        current={0}
        headerExtra={back}
      >
        <Result
          status="error"
          title="资料加载失败"
          subTitle={intake.error.message}
          extra={<Button onClick={() => void intake.refetch()}>重新加载</Button>}
        />
      </WizardLayout>
    );
  }

  return <PrepareBody taskId={taskId} enterpriseName={task.data.enterpriseName} view={intake.data} back={back} />;
}

function PrepareBody({
  taskId,
  enterpriseName,
  view,
  back,
}: {
  taskId: string;
  enterpriseName: string;
  view: IntakeView;
  back: ReactNode;
}) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const uploads = useUploads(taskId);
  const input = useRef<HTMLInputElement>(null);
  const slotRef = useRef<IntakeFileSlot>('data_sheet');
  const [askNoEvacuation, setAskNoEvacuation] = useState(false);
  const [dialog, setDialog] = useState<'submit' | 'delete' | null>(null);
  const [saving, setSaving] = useState(false);

  const canEdit = view.canEdit;
  const phase = phaseOf(view);
  const { title, subtitle } = headline(view);
  const read = phase === 'read';
  const complete = read && (view.requiredCheck?.missing.length ?? 0) === 0;

  const pick = (slot: IntakeFileSlot) => {
    if (!input.current) return;
    slotRef.current = slot;
    input.current.accept = ACCEPT[slot];
    input.current.multiple = slot === 'other' || slot === 'evacuation_map';
    input.current.value = '';
    input.current.click();
  };

  const apply = (next: IntakeView) => queryClient.setQueryData(intakeKey(taskId), next);
  const fail = (err: unknown) => {
    message.error(err instanceof Error ? err.message : '没有成功，请再试一次');
    void queryClient.invalidateQueries({ queryKey: intakeKey(taskId) });
  };

  const remove = async (file: IntakeFileView) => {
    try {
      apply(await removeIntakeFile(taskId, file.id));
      message.success(`已删除 ${file.originalName}`);
    } catch (err) {
      fail(err);
    }
  };

  const setNoEvacuation = async (value: boolean) => {
    setSaving(true);
    try {
      apply(await setNoEvacuationMap(taskId, value));
      setAskNoEvacuation(false);
    } catch (err) {
      fail(err);
    } finally {
      setSaving(false);
    }
  };

  const open = (file: IntakeFileView) => void viewFile(file.fileId).catch(fail);
  const drawingProps = {
    view,
    canEdit,
    pick,
    onView: open,
    onRemove: (f: IntakeFileView) => void remove(f),
    onAskNoEvacuation: () => setAskNoEvacuation(true),
    onUndoNoEvacuation: () => void setNoEvacuation(false),
  };

  const hasDrawings = Boolean(view.sitePlan) || view.evacuationMaps.length > 0 || view.others.length > 0;
  const anything = Boolean(view.dataSheet) || hasDrawings || view.noEvacuationMap;
  // 读到表格以后，说明了没有的疏散图不在缺项里，撤销只能放在「已传的图纸和照片」里：这时一张图没传也要显示这张卡片
  const showDrawings = hasDrawings || (read && view.noEvacuationMap);
  const headerExtra = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
      {anything && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, ...type.body, color: gy.success }}>
          <CheckOutlined style={{ fontSize: 14 }} />
          已自动保存 {clock(view.updatedAt)}
        </span>
      )}
      {back}
    </div>
  );

  const note = (
    <>
      {footerNote(view)}
      {read && !complete && (
        <>
          {' · 填不上？'}
          <QrLink placement="topLeft">联系客服</QrLink>
        </>
      )}
    </>
  );

  const footer = (
    <ActionBar
      danger={
        canEdit ? (
          <Button type="link" danger style={{ padding: 0 }} onClick={() => setDialog('delete')}>
            删除任务
          </Button>
        ) : undefined
      }
      note={note}
    >
      {/* 必填齐了才可点；能不能提交以接口为准，规则和接口一致 */}
      <Button type="primary" disabled={!complete || !canEdit} onClick={() => setDialog('submit')}>
        提交给专家
      </Button>
    </ActionBar>
  );

  return (
    <WizardLayout
      title="编制应急预案"
      enterpriseName={enterpriseName}
      stages={CUSTOMER_STAGES}
      current={0}
      headerExtra={headerExtra}
      footer={footer}
    >
      <input
        ref={input}
        type="file"
        hidden
        data-testid="intake-file-input"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) uploads.start(slotRef.current, files);
        }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h1 style={{ ...type.pageTitle, fontWeight: weight.strong, color: gy.text, margin: 0 }}>{title}</h1>
          <p style={{ ...type.body, color: gy.secondary, margin: 0 }}>{subtitle}</p>
        </div>
        {!canEdit && (
          <TitledNotice tone="info">您可以查看这里的资料。上传和删除要由组织管理员，或负责这家企业的同事来做。</TitledNotice>
        )}
        {view.withdrawnAt && (
          <TitledNotice tone="warning" title="已撤回，改好后再提交">
            {stamp(view.withdrawnAt)} 撤回。已经传的表格、图纸和照片都还在。
          </TitledNotice>
        )}
        <Notices view={view} enterpriseName={enterpriseName} canEdit={canEdit} pick={pick} />
        <UploadsCard entries={uploads.entries} onCancel={uploads.cancel} onRetry={uploads.retry} onDismiss={uploads.dismiss} />
        {read ? (
          <ReadLayout view={view} canEdit={canEdit} pick={pick} onAskNoEvacuation={() => setAskNoEvacuation(true)}>
            {showDrawings && <DrawingsCard {...drawingProps} undoNoEvacuationHere />}
          </ReadLayout>
        ) : (
          <>
            <Card>
              <TemplateHead view={view} />
              <CardHead title="把这几样传上来" desc="传一样勾一样，必填的都勾上就能提交。" />
              <ChecklistRows {...drawingProps} />
            </Card>
            {showDrawings && <DrawingsCard {...drawingProps} undoNoEvacuationHere={false} />}
            <HelpBar action={<QrLink />}>不知道怎么填？加耕云客服的企业微信，客服会一项项带您填。</HelpBar>
          </>
        )}
      </div>
      <Modal
        open={askNoEvacuation}
        title="确认没有紧急疏散示意图？"
        okText="确认没有"
        cancelText="取消"
        width={400}
        confirmLoading={saving}
        onOk={() => void setNoEvacuation(true)}
        onCancel={() => setAskNoEvacuation(false)}
        destroyOnHidden
      >
        <p style={{ ...type.body, color: gy.secondary, margin: 0 }}>
          提交后专家会看到您说明了没有。编制前还要补上这张图，客服会联系您。车间墙上贴的疏散图拍照也可以。
        </p>
      </Modal>
      <SubmitDialog
        open={dialog === 'submit'}
        taskId={taskId}
        enterpriseName={enterpriseName}
        view={view}
        onClose={() => setDialog(null)}
      />
      <DeleteTaskDialog
        open={dialog === 'delete'}
        taskId={taskId}
        enterpriseName={enterpriseName}
        view={view}
        onClose={() => setDialog(null)}
      />
    </WizardLayout>
  );
}

/** 页面顶部的提示：不是模板、别家企业、改了企业名称、旧版模板 */
function Notices({
  view,
  enterpriseName,
  canEdit,
  pick,
}: {
  view: IntakeView;
  enterpriseName: string;
  canEdit: boolean;
  pick: (slot: IntakeFileSlot) => void;
}) {
  const phase = phaseOf(view);
  if (phase === 'not_template' && view.dataSheet) {
    return (
      <TitledNotice
        tone="error"
        paddingLeft={16}
        title="这不是耕云的资料模板，没有读取"
        action={<LinkButton href={INTAKE_TEMPLATE_URL}>重新下载模板</LinkButton>}
      >
        刚才传的「{view.dataSheet.file.originalName}」里没有找到模板的 6 张表。请用下面的资料模板填好再传；自己另做的表格、其他单位的资料清单都读不了。
      </TitledNotice>
    );
  }
  if (phase === 'other_enterprise') {
    const other = view.otherEnterprise;
    const otherName =
      other?.enterpriseName ??
      view.warnings.find((w) => w.kind === 'other_enterprise')?.matchedEnterpriseName ??
      '另一家企业';
    const otherShort = shortName(otherName);
    let action: ReactNode;
    if (other?.visible && other.openTaskId) {
      action = <LinkButton href={`/customer/tasks/${other.openTaskId}/prepare`}>去{otherShort}的任务</LinkButton>;
    } else if (other?.visible) {
      action = <LinkButton href={`/customer/enterprises/${other.enterpriseId}`}>去看{otherShort}的企业概览</LinkButton>;
    }
    return (
      <TitledNotice tone="error" paddingLeft={16} title={`这张表像是「${otherName}」的，没有读取`} action={action}>
        表格里填的企业名称是「{otherName}」，和您名下另一家企业同名；这个任务是给「{enterpriseName}」编制的。传错了，换成
        {shortName(enterpriseName)}的表重新上传；这张表确实是{otherShort}的，请到它的任务里上传。
      </TitledNotice>
    );
  }
  if (phase !== 'read') return null;
  const renamed = view.warnings.find((w) => w.kind === 'enterprise_renamed');
  const mismatchAt = (view.requiredCheck?.missing ?? []).flatMap((m, i) => (m.mismatch ? [i + 1] : []));
  return (
    <>
      {renamed && (
        <TitledNotice
          tone="info"
          paddingLeft={16}
          icon={<InfoCircleOutlined style={{ fontSize: 16, color: gy.primary, flexShrink: 0 }} />}
          action={canEdit ? <LinkButton onClick={() => pick('data_sheet')}>传错了表？重新上传</LinkButton> : undefined}
        >
          表格里的企业名称是「{renamed.newName}」，已按表格改好企业名称（原来填的是「{renamed.previousName}」）。
        </TitledNotice>
      )}
      {view.dataSheet?.oldTemplate && (
        <TitledNotice
          tone="warning"
          title="您用的是旧版模板，不用换模板重填"
          action={<LinkButton href={INTAKE_TEMPLATE_URL}>下载新版模板</LinkButton>}
        >
          能对上的内容都读进来了。物料的年用量、最大存放量，旧版统一按「吨」填，已按吨读入。
          {mismatchAt.length > 0 &&
            `有 ${mismatchAt.length} 处和新版对不上，列在下面第 ${mismatchAt.join('、')} 条。`}
        </TitledNotice>
      )}
    </>
  );
}

/** 还没有读得了的表格时，卡片顶上那一节：下载资料模板（以前提交过的，多一个「下载上次提交的表」） */
function TemplateHead({ view }: { view: IntakeView }) {
  const { message } = App.useApp();
  const previous = phaseOf(view) === 'previous' ? view.previousSheet : null;
  const templateButton = (
    <Button type="primary" icon={<DownloadOutlined />} href={INTAKE_TEMPLATE_URL}>
      下载资料模板
    </Button>
  );
  return (
    <CardHead
      first
      title="下载资料模板"
      desc={TEMPLATE_DESC}
      meta={
        previous
          ? `这家企业 ${dayLabel(previous.submittedAt)}提交过一份。在它上面改，比从头填快。`
          : `模板版本 ${INTAKE_TEMPLATE_VERSION} · 约 30 分钟填完`
      }
      action={
        previous ? (
          <>
            <Button
              icon={<DownloadOutlined />}
              style={{ borderColor: gy.controlLine }}
              onClick={() => void downloadFile(previous.fileId).catch((err: Error) => message.error(err.message))}
            >
              下载上次提交的表
            </Button>
            {templateButton}
          </>
        ) : (
          templateButton
        )
      }
    />
  );
}

const statusText = (text: string, color: string = gy.success) => (
  <span style={{ color, fontWeight: weight.strong }}>{text}</span>
);
const fileLine = (text: string) => (
  <span style={{ ...type.caption, color: gy.tertiary, overflowWrap: 'anywhere' }}>{text}</span>
);

/** 「把这几样传上来」四行 */
function ChecklistRows({
  view,
  canEdit,
  pick,
  onAskNoEvacuation,
  onUndoNoEvacuation,
}: {
  view: IntakeView;
  canEdit: boolean;
  pick: (slot: IntakeFileSlot) => void;
  onAskNoEvacuation: () => void;
  onUndoNoEvacuation: () => void;
}) {
  const sheet = view.dataSheet;
  const evac = view.evacuationMaps;
  return (
    <>
      <ItemRow
        align="center"
        label="填好的资料表格"
        tag="必填 · 表格"
        title="填好的资料表格"
        desc={SHEET_DESC}
        extra={sheet && fileLine(`${sheet.file.originalName} · ${stamp(sheet.file.uploadedAt)} 上传`)}
        status={sheet ? statusText('没有读取', gy.error) : '还没传'}
        actions={canEdit ? <UploadButton onClick={() => pick('data_sheet')}>{sheet ? '重新上传' : '上传'}</UploadButton> : null}
      />
      <ItemRow
        align="center"
        label="总平面布置图"
        tag="必填 · 图纸"
        title="总平面布置图"
        desc={SITE_PLAN_DESC}
        extra={view.sitePlan && fileLine(view.sitePlan.originalName)}
        status={view.sitePlan ? statusText('已传') : '还没传'}
        actions={
          canEdit ? <UploadButton onClick={() => pick('site_plan')}>{view.sitePlan ? '替换' : '上传'}</UploadButton> : null
        }
      />
      <ItemRow
        align="center"
        label="紧急疏散示意图"
        tag="必填 · 图纸"
        title="紧急疏散示意图"
        desc={EVACUATION_DESC}
        extra={evac.length > 0 && fileLine(evac.map((f) => f.originalName).join('、'))}
        status={
          evac.length > 0 ? statusText('已传') : view.noEvacuationMap ? statusText('已说明没有', gy.warning) : '还没传'
        }
        actions={
          !canEdit ? null : evac.length > 0 ? (
            <UploadButton onClick={() => pick('evacuation_map')}>再传一张</UploadButton>
          ) : view.noEvacuationMap ? (
            <LinkButton onClick={onUndoNoEvacuation}>撤销，我要上传</LinkButton>
          ) : (
            <>
              <LinkButton onClick={onAskNoEvacuation}>这张图我们没有</LinkButton>
              <UploadButton onClick={() => pick('evacuation_map')} />
            </>
          )
        }
      />
      <ItemRow
        align="center"
        label="其他图纸与照片"
        tag="选填 · 图纸与照片"
        title="其他图纸与照片"
        desc={OTHER_DESC}
        status={view.others.length > 0 ? statusText(`已传 ${view.others.length} 张`) : ''}
        actions={canEdit ? <UploadButton onClick={() => pick('other')} /> : null}
      />
    </>
  );
}

/** 读到表格以后：左边缺项或选填、已传的图纸，右边小结；缺必填时下面一句选填提示 */
function ReadLayout({
  view,
  canEdit,
  pick,
  onAskNoEvacuation,
  children,
}: {
  view: IntakeView;
  canEdit: boolean;
  pick: (slot: IntakeFileSlot) => void;
  onAskNoEvacuation: () => void;
  children: ReactNode;
}) {
  const { sheet, drawings } = missingSplit(view);
  const optional = view.requiredCheck?.optional ?? [];
  const missing = sheet.length + drawings.length;
  const summary = optionalSummary(optional);
  const reupload = (primary: boolean) =>
    canEdit ? (
      <UploadButton primary={primary} onClick={() => pick('data_sheet')}>
        重新上传表格
      </UploadButton>
    ) : undefined;

  return (
    <>
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 24 }}>
          {missing > 0 ? (
            <Card>
              {sheet.length > 0 && (
                <>
                  <CardHead
                    first
                    title={`回表格改 ${sheet.length} 项`}
                    desc="在您电脑上那份表格里改好，再整份重新上传。"
                    action={reupload(true)}
                  />
                  {sheet.map((m) => (
                    <ItemRow
                      key={`${m.field}-${m.cell ?? ''}`}
                      label={m.label}
                      tag={m.sheet ? `${m.sheet}${m.row ? ` · 第 ${m.row} 行` : ''}` : ''}
                      title={m.label}
                      desc={m.note}
                    />
                  ))}
                </>
              )}
              {drawings.length > 0 && (
                <>
                  <CardHead
                    first={sheet.length === 0}
                    title={`在这里直接传 ${drawings.length} 张图`}
                    desc="图纸不在表格里，直接传到这里，不用重新上传表格。"
                  />
                  {drawings.map((m) => {
                    const evacuation = m.field === 'drawing.evacuation_plan';
                    return (
                      <ItemRow
                        key={m.field}
                        label={m.label}
                        tag="图纸"
                        actionsWidth="auto"
                        title={m.label}
                        desc={evacuation ? EVACUATION_DESC : SITE_PLAN_DESC}
                        actions={
                          canEdit ? (
                            <>
                              {evacuation && <LinkButton onClick={onAskNoEvacuation}>这张图我们没有</LinkButton>}
                              <UploadButton onClick={() => pick(evacuation ? 'evacuation_map' : 'site_plan')} />
                            </>
                          ) : null
                        }
                      />
                    );
                  })}
                </>
              )}
            </Card>
          ) : (
            optional.length > 0 && (
              <Card>
                <CardHead
                  first
                  title={`另有 ${optional.length} 项选填没填`}
                  desc="可以不填，不影响提交。想现在补，在表格里填好再整份重新上传。"
                  action={reupload(false)}
                />
                {optional.map((item) => (
                  <ItemRow
                    key={`${item.field}-${item.row ?? ''}`}
                    label={item.label}
                    tag={item.sheet}
                    title={item.label}
                    desc={optionalNote(item)}
                  />
                ))}
              </Card>
            )
          )}
          {children}
        </div>
        <SheetSummary view={view} canEdit={canEdit} onReplaceSitePlan={() => pick('site_plan')} />
      </div>
      {missing > 0 && summary && <OptionalBar summary={summary} items={optional} />}
    </>
  );
}
