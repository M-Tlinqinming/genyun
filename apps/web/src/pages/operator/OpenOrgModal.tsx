import { CloseOutlined } from '@ant-design/icons';
import {
  chinaToday,
  formatRegion,
  openingGaps,
  regionHasDistrictAgencies,
  regionHasLocalAgencies,
  type OrgOpenDraft,
} from '@genyun/shared';
import { App, Button, Input, Modal } from 'antd';
import { useEffect, useId, useState, type CSSProperties } from 'react';
import { Link } from 'react-router';
import { useOpenOrg, useOperatorOrg } from '../../api/operator';
import { ApiError } from '../../api/request';
import { useKnowledgeAgencies } from '../../api/knowledge';
import { linkButton, linkButtonSmall, Loading } from '../../components/ui';
import { gy } from '../../theme/tokens';
import { ContractFields, contractPayload, emptyContractDraft, Field, hint, type ContractDraftState } from './ContractFields';
import { RegisterOrgModal } from './RegisterOrgModal';

const box: CSSProperties = { borderRadius: 6, padding: '8px 12px', fontSize: 12, lineHeight: '20px' };
const monthDay = (iso: string) => chinaToday(new Date(iso)).slice(5).replace('-', '.');

// 开通客户组织（Paper 16 页「开通与邀请弹窗」）：登记合同和次数、确认到账、填合同有效期和首位管理员，
// 开通后系统给首位管理员发邀请邮件。合同原件选填，其余缺任一项都不能开通
export function OpenOrgModal({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  const detail = useOperatorOrg(orgId);
  // 属地机构按知识库现在的数据判断；知识库读不到时不提醒（不影响开通）
  const knowledge = useKnowledgeAgencies();
  const openOrg = useOpenOrg(orgId);
  const { message, modal } = App.useApp();
  const id = useId();

  const [contract, setContract] = useState<ContractDraftState>(emptyContractDraft);
  const [adminName, setAdminName] = useState('');
  const [adminPhone, setAdminPhone] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  // 邮箱已有耕云账号等，接口指明是邮箱的问题时显示在邮箱下面
  const [emailError, setEmailError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [editingOrg, setEditingOrg] = useState(false);
  const [prefilled, setPrefilled] = useState(false);

  // 首位管理员默认填登记时的主联系人；之前上传过、还没挂到合同上的合同原件直接带出来
  useEffect(() => {
    const d = detail.data;
    if (!d || prefilled) return;
    setAdminName(d.contactName ?? '');
    setAdminPhone(d.contactPhone ?? '');
    setAdminEmail(d.contactEmail ?? '');
    setContract((c) => ({ ...c, file: d.contractFile }));
    setPrefilled(true);
  }, [detail.data, prefilled]);

  const touch = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setDirty(true);
  };

  const draft: OrgOpenDraft = {
    ...contractPayload(contract),
    startsAt: contract.period?.[0]?.format('YYYY-MM-DD') ?? null,
    endsAt: contract.period?.[1]?.format('YYYY-MM-DD') ?? null,
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

  const submit = () => {
    if (gaps.length > 0) return;
    openOrg.mutate(draft, {
      onSuccess: (r) => {
        // 模拟发信（本机、预览环境）时说明邮件没有真的发出
        const simulated = r.invitation.mailSimulated
          ? `（预览环境未真实发送${r.invitation.mailInOutbox ? '，可在「模拟发件箱」查看' : ''}）`
          : '';
        if (r.invitation.mailSent) message.success(`已开通，邀请已发到 ${r.invitation.email}${simulated}`);
        else message.warning('已开通，但邀请邮件没发出去。请稍后在组织详情里重新发送');
        onClose();
      },
      onError: (err) => {
        if (err instanceof ApiError && err.body?.field === 'email') setEmailError(err.message);
        else message.error(err.message);
      },
    });
  };

  const org = detail.data;
  const registeredOn = org ? `${monthDay(org.createdAt)} ${org.registeredByName ?? '耕云运营'}登记` : '';
  const regionText = org ? (org.regionParts ? formatRegion(org.regionParts, 'full') : org.region) : null;
  // 有三级地区时按省、市、区县查；老数据只有文字时按文字查
  const hasAgencies =
    org && knowledge.data
      ? org.regionParts
        ? regionHasDistrictAgencies(org.regionParts, knowledge.data.regions)
        : regionHasLocalAgencies(org.region, knowledge.data.regions)
      : true;

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
            <div style={{ background: gy.subtleBg, border: `1px solid ${gy.split}`, borderRadius: 6, padding: '12px 16px' }}>
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
                {[regionText, org.socialCreditCode, registeredOn, '合作已确认'].filter(Boolean).join(' · ')}
              </div>
            </div>

            <ContractFields
              value={contract}
              orgId={orgId}
              onChange={(patch) => {
                setContract((c) => ({ ...c, ...patch }));
                setDirty(true);
              }}
              paymentNote="没到账不能开通"
              periodHint="到期后不能新建任务，已交付的仍可下载。"
            />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
                    status={emailError ? 'error' : undefined}
                    aria-describedby={emailError ? `${id}-admin-email-error` : undefined}
                    onChange={(e) => {
                      touch(setAdminEmail)(e.target.value);
                      setEmailError(null);
                    }}
                  />
                </Field>
                {emailError && (
                  <div id={`${id}-admin-email-error`} role="alert" style={{ ...hint, color: gy.error }}>
                    {emailError}
                  </div>
                )}
                <div style={hint}>邀请链接 7 天有效，管理员接受后自己邀请成员。</div>
              </div>
            </div>

            {!hasAgencies && (
              <div style={{ ...box, background: gy.warningBg, color: gy.warning, display: 'flex', gap: 12 }}>
                <span style={{ flex: 1 }}>知识库还没有{regionText ?? '该地区'}的属地机构，不影响开通，但编制前需要补齐。</span>
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
