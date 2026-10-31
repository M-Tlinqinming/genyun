import { CloseOutlined } from '@ant-design/icons';
import {
  chinaToday,
  INVITATION_TTL_DAYS,
  openingGaps,
  regionHasLocalAgencies,
  UPLOAD_RULES,
  type OrgOpenDraft,
  type ServiceScopeKind,
} from '@genyun/shared';
import { App, Button, Checkbox, DatePicker, Input, InputNumber, Modal, Select, Space } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router';
import { uploadContractFile, useOpenOrg, useOperatorOrg, type ContractFile } from '../../api/operator';
import { inlineUrl } from '../../api/workup';
import { linkButton, linkButtonSmall, Loading } from '../../components/ui';
import { gy } from '../../theme/tokens';
import { RegisterOrgModal } from './RegisterOrgModal';

const hint: CSSProperties = { fontSize: 12, lineHeight: '20px', color: gy.secondary, marginTop: 8 };
const fieldLabel: CSSProperties = { display: 'block', fontSize: 14, lineHeight: '22px', color: gy.text, marginBottom: 8 };
const box: CSSProperties = { borderRadius: 6, padding: '8px 12px', fontSize: 12, lineHeight: '20px' };

function Field({ label, children, id, style }: { label: string; children: ReactNode; id: string; style?: CSSProperties }) {
  return (
    <div style={{ flex: 1, minWidth: 0, ...style }}>
      <label htmlFor={id} style={fieldLabel}>
        {label} <span style={{ color: gy.error }}>*</span>
      </label>
      {children}
    </div>
  );
}

const sizeText = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const monthDay = (iso: string) => chinaToday(new Date(iso)).slice(5).replace('-', '.');

// 开通客户组织（Paper 16 页「开通与邀请弹窗」）：登记合同、确认到账、填合同有效期和首位管理员，
// 开通后系统给首位管理员发邀请邮件。缺任一项都不能开通
export function OpenOrgModal({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  const detail = useOperatorOrg(orgId);
  const openOrg = useOpenOrg(orgId);
  const { message, modal } = App.useApp();
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);

  const [contractNumber, setContractNumber] = useState('');
  const [scopeKind, setScopeKind] = useState<ServiceScopeKind>('annual');
  const [scopeEnterprises, setScopeEnterprises] = useState<number | null>(null);
  const [file, setFile] = useState<ContractFile | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [paymentReceived, setPaymentReceived] = useState(false);
  const [period, setPeriod] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [adminName, setAdminName] = useState('');
  const [adminPhone, setAdminPhone] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [dirty, setDirty] = useState(false);
  const [editingOrg, setEditingOrg] = useState(false);
  const [prefilled, setPrefilled] = useState(false);

  // 首位管理员默认填登记时的主联系人；之前上传过的合同原件直接带出来
  useEffect(() => {
    const d = detail.data;
    if (!d || prefilled) return;
    setAdminName(d.contactName ?? '');
    setAdminPhone(d.contactPhone ?? '');
    setAdminEmail(d.contactEmail ?? '');
    setFile(d.contractFile);
    setPrefilled(true);
  }, [detail.data, prefilled]);

  const touch = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setDirty(true);
  };

  const draft: OrgOpenDraft = {
    contractNumber,
    scopeKind,
    scopeEnterprises: scopeKind === 'annual' ? scopeEnterprises : null,
    contractFileId: file?.id ?? null,
    paymentReceived,
    startsAt: period?.[0]?.format('YYYY-MM-DD') ?? null,
    endsAt: period?.[1]?.format('YYYY-MM-DD') ?? null,
    adminName,
    adminPhone,
    adminEmail,
  };
  const gaps = openingGaps(draft);

  const close = () => {
    if (!dirty || openOrg.isPending) return onClose();
    modal.confirm({
      title: '放弃这次开通？',
      content: '关闭后，刚才填写的合同信息和管理员不会保存（已上传的合同原件会保留）。',
      okText: '放弃',
      cancelText: '继续填写',
      okButtonProps: { danger: true },
      onOk: onClose,
    });
  };

  const upload = async (picked: File | undefined) => {
    if (!picked) return;
    setUploadError(null);
    if (picked.size > UPLOAD_RULES.contract.maxBytes) {
      setUploadError('合同原件超过 20 MB。请降低扫描分辨率后重新上传');
      return;
    }
    setUploading(true);
    try {
      setFile(await uploadContractFile(orgId, picked));
      setDirty(true);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : '上传失败，请重新上传');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  // 先开一个空白页，拿到签名链接后再跳转，避免浏览器拦截弹窗
  const preview = async () => {
    if (!file) return;
    const win = window.open('', '_blank');
    try {
      const { url } = await inlineUrl(file.id);
      if (win) win.location.href = url;
      else window.location.href = url;
    } catch (err) {
      win?.close();
      message.error(err instanceof Error ? err.message : '预览失败，请重试');
    }
  };

  const submit = () => {
    if (gaps.length > 0) return;
    openOrg.mutate(draft, {
      onSuccess: (r) => {
        // 模拟发信（本机、预览环境）时说明邮件没有真的发出
        const simulated = r.invitation.mailSimulated ? '（预览环境未真实发送邮件）' : '';
        if (r.invitation.mailSent) message.success(`已开通，邀请已发到 ${r.invitation.email}${simulated}`);
        else message.warning('已开通，但邀请邮件没发出去。请稍后在组织详情里重新发送');
        onClose();
      },
      onError: (err) => message.error(err.message),
    });
  };

  const org = detail.data;
  const registeredOn = org ? `${monthDay(org.createdAt)} ${org.registeredByName ?? '耕云运营'}登记` : '';

  return (
    <Modal
      open
      width={600}
      onCancel={close}
      closeIcon={<CloseOutlined aria-label="关闭" />}
      title={
        <div>
          <div style={{ fontSize: 16, lineHeight: '24px', fontWeight: 500 }}>开通客户组织</div>
          <div style={{ fontSize: 14, lineHeight: '22px', fontWeight: 400, color: gy.secondary, marginTop: 4 }}>
            合同已签、款已到账后开通，系统会向首位管理员发送邀请。
          </div>
        </div>
      }
      footer={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {org && gaps.length > 0 && (
            <div role="status" style={{ textAlign: 'right', fontSize: 12, lineHeight: '20px', color: gy.secondary }}>
              还差：{gaps.join('、')}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={close}>取消</Button>
            <Button type="primary" onClick={submit} disabled={!org || gaps.length > 0} loading={openOrg.isPending}>
              开通并发送邀请
            </Button>
          </div>
        </div>
      }
    >
      {detail.isPending ? (
        <Loading rows={8} card={false} />
      ) : detail.isError ? (
        <div role="alert" style={{ ...box, background: gy.errorBg, color: gy.error, fontSize: 14 }}>
          {detail.error.message}{' '}
          <button type="button" style={linkButton} onClick={() => void detail.refetch()}>
            重新加载
          </button>
        </div>
      ) : (
        org && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, paddingTop: 8 }}>
            <div style={{ background: '#FAFAFB', border: `1px solid ${gy.split}`, borderRadius: 6, padding: '12px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                <span style={{ fontSize: 14, lineHeight: '22px', fontWeight: 500, minWidth: 0 }}>{org.name}</span>
                <button
                  type="button"
                  style={{ ...linkButtonSmall, whiteSpace: 'nowrap', flexShrink: 0 }}
                  onClick={() => setEditingOrg(true)}
                >
                  修改资料
                </button>
              </div>
              <div style={{ fontSize: 12, lineHeight: '20px', color: gy.secondary, marginTop: 4 }}>
                {[org.region, org.socialCreditCode, registeredOn, '合作已确认'].filter(Boolean).join(' · ')}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 16 }}>
              <Field label="合同编号" id={`${id}-number`}>
                <Input
                  id={`${id}-number`}
                  value={contractNumber}
                  onChange={(e) => touch(setContractNumber)(e.target.value)}
                  placeholder="如：GY-HT-2026-018"
                  maxLength={50}
                />
              </Field>
              <Field label="服务范围" id={`${id}-scope`}>
                <Space.Compact style={{ width: '100%' }}>
                  <Select<ServiceScopeKind>
                    id={`${id}-scope`}
                    value={scopeKind}
                    onChange={touch(setScopeKind)}
                    style={{ flex: 1, minWidth: 0 }}
                    options={[
                      { value: 'annual', label: '年度服务' },
                      { value: 'single', label: '编制 1 家企业' },
                    ]}
                  />
                  {scopeKind === 'annual' && (
                    <InputNumber
                      aria-label="年度服务包含几家企业"
                      min={1}
                      max={9999}
                      precision={0}
                      value={scopeEnterprises}
                      onChange={touch(setScopeEnterprises)}
                      placeholder="家数"
                      suffix="家企业"
                      style={{ width: 128 }}
                    />
                  )}
                </Space.Compact>
              </Field>
            </div>

            <div>
              <span style={fieldLabel}>
                已签合同原件 <span style={{ color: gy.error }}>*</span>
              </span>
              <input
                ref={fileInput}
                type="file"
                accept="application/pdf,.pdf"
                hidden
                aria-label="选择已签合同原件"
                onChange={(e) => void upload(e.target.files?.[0])}
              />
              {file ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    background: '#FAFAFB',
                    border: `1px solid ${gy.split}`,
                    borderRadius: 6,
                    padding: '10px 12px',
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 28,
                      height: 32,
                      flexShrink: 0,
                      borderRadius: 4,
                      background: gy.errorBg,
                      color: gy.error,
                      fontSize: 10,
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    PDF
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, lineHeight: '22px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {file.originalName}
                    </div>
                    <div style={{ fontSize: 12, lineHeight: '20px', color: gy.secondary }}>
                      {sizeText(file.sizeBytes)} · {monthDay(file.createdAt)} {file.uploadedByName}上传
                    </div>
                  </div>
                  <button type="button" style={linkButtonSmall} onClick={() => void preview()}>
                    预览
                  </button>
                  <button type="button" style={linkButtonSmall} disabled={uploading} onClick={() => fileInput.current?.click()}>
                    {uploading ? '正在上传…' : '重新上传'}
                  </button>
                </div>
              ) : (
                <Button block loading={uploading} onClick={() => fileInput.current?.click()} style={{ height: 54, borderStyle: 'dashed' }}>
                  {uploading ? '正在上传…' : '上传合同原件（PDF）'}
                </Button>
              )}
              {uploadError && (
                <div role="alert" style={{ ...hint, color: gy.error }}>
                  {uploadError}
                </div>
              )}
              <div style={hint}>只接受 PDF，需双方签字盖章的扫描件，最大 20 MB。仅耕云运营可见。</div>
            </div>

            <div>
              <Checkbox checked={paymentReceived} onChange={(e) => touch(setPaymentReceived)(e.target.checked)}>
                合同款已到账
              </Checkbox>
              <div style={hint}>
                合同原件未上传或未勾选到账时不能开通。服务范围可选「编制 1 家企业」或「年度服务 · N 家企业」。报价、收款、开票都在线下完成，系统不记录金额；超出范围由运营人工判断。
              </div>
            </div>

            <div>
              <label htmlFor={`${id}-period`} style={fieldLabel}>
                合同有效期 <span style={{ color: gy.error }}>*</span>
              </label>
              <DatePicker.RangePicker
                id={{ start: `${id}-period` }}
                value={period}
                onChange={(v) => touch(setPeriod)(v as [Dayjs | null, Dayjs | null] | null)}
                format="YYYY.MM.DD"
                placeholder={['开始日', '到期日']}
                defaultPickerValue={[dayjs(), dayjs().add(1, 'year')]}
                style={{ width: '100%' }}
              />
              <div style={hint}>按合同填写。开通后管理员即可登录建档；到期后不能新建任务，已交付成果仍可下载。</div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ fontSize: 14, lineHeight: '22px', fontWeight: 500 }}>首位管理员</div>
              <div style={{ display: 'flex', gap: 16 }}>
                <Field label="姓名" id={`${id}-admin-name`}>
                  <Input id={`${id}-admin-name`} value={adminName} onChange={(e) => touch(setAdminName)(e.target.value)} maxLength={50} />
                </Field>
                <Field label="手机号" id={`${id}-admin-phone`}>
                  <Input id={`${id}-admin-phone`} value={adminPhone} onChange={(e) => touch(setAdminPhone)(e.target.value)} maxLength={30} />
                </Field>
              </div>
              <div>
                <Field label="邮箱" id={`${id}-admin-email`}>
                  <Input
                    id={`${id}-admin-email`}
                    type="email"
                    value={adminEmail}
                    onChange={(e) => touch(setAdminEmail)(e.target.value)}
                  />
                </Field>
                <div style={hint}>
                  邀请链接发到邮箱，{INVITATION_TTL_DAYS} 天内有效；对方没收到可提醒查看垃圾邮件，或在组织详情中重新发送。
                </div>
              </div>
            </div>

            <div style={{ ...box, background: gy.selected, color: gy.text }}>
              管理员接受邀请后，自行邀请成员、建档企业和分配负责人；耕云不代为添加客户成员。
            </div>
            {!regionHasLocalAgencies(org.region) && (
              <div style={{ ...box, background: gy.warningBg, color: gy.warning, display: 'flex', gap: 12 }}>
                <span style={{ flex: 1 }}>
                  知识库还没有{org.region ?? '该地区'}的属地机构，不影响开通，但编制前需要补齐。
                </span>
                <Link to="/operator/knowledge" target="_blank" style={{ fontSize: 12 }}>
                  去知识库
                </Link>
              </div>
            )}
          </div>
        )
      )}
      <RegisterOrgModal orgId={editingOrg ? orgId : null} open={editingOrg} onClose={() => setEditingOrg(false)} />
    </Modal>
  );
}
