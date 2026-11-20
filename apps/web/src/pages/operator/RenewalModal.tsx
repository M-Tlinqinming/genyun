import { CloseOutlined } from '@ant-design/icons';
import { chinaToday, contractGaps, renewalDefaultDates, type OrgOpenDraft } from '@genyun/shared';
import { App, Button, Modal } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { useOperatorOrg, useOrgCredits, useRenewOrg } from '../../api/operator';
import { linkButton, Loading } from '../../components/ui';
import { gy, type, weight } from '../../theme/tokens';
import { ContractFields, contractPayload, emptyContractDraft, type ContractDraftState } from './ContractFields';

const dotted = (date: string) => date.replaceAll('-', '.');

/**
 * 登记续约（画板没画，样式照开通弹窗）：合同编号、合同购买和赠送次数、合同原件（选填）、到账、合同有效期。
 * 默认从现在到期日的后一天开始（已到期的从今天开始），到期日 = 开始日加一年减一天
 */
export function RenewalModal({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  const detail = useOperatorOrg(orgId);
  const credits = useOrgCredits(orgId);
  const renew = useRenewOrg(orgId);
  const { message, modal } = App.useApp();
  const [contract, setContract] = useState<ContractDraftState>(emptyContractDraft);
  const [dirty, setDirty] = useState(false);
  const [prefilled, setPrefilled] = useState(false);

  const org = detail.data;
  const today = chinaToday();

  // 默认日期；之前上传过、还没挂到合同上的合同原件直接带出来
  useEffect(() => {
    if (!org || prefilled) return;
    const d = renewalDefaultDates(org, today);
    setContract((c) => ({ ...c, file: org.contractFile, period: [dayjs(d.startsAt), dayjs(d.endsAt)] }));
    setPrefilled(true);
  }, [org, prefilled, today]);

  const startsAt = contract.period?.[0]?.format('YYYY-MM-DD') ?? null;
  const endsAt = contract.period?.[1]?.format('YYYY-MM-DD') ?? null;
  const draft: OrgOpenDraft = { ...contractPayload(contract), startsAt, endsAt };
  const gaps = contractGaps(draft);
  const expired = !!org?.contractEndsAt && org.contractEndsAt < today;

  const close = () => {
    if (!dirty || renew.isPending) return onClose();
    modal.confirm({
      title: '放弃这次续约登记？',
      content: '关闭后，刚才填写的合同信息不会保存（已上传的合同原件会保留）。',
      okText: '放弃',
      cancelText: '继续填写',
      okButtonProps: { danger: true },
      onOk: onClose,
    });
  };

  const submit = () => {
    if (gaps.length > 0 || !startsAt || !endsAt) return;
    renew.mutate(
      // 还差的项都填齐了才会走到这里（到账、合同购买次数都已确认）
      {
        ...contractPayload(contract),
        purchasedCredits: contract.purchasedCredits ?? 0,
        paymentReceived: true,
        contractStartsAt: startsAt,
        contractEndsAt: endsAt,
      },
      {
        onSuccess: (r) => {
          // 还有成果在等、新合同又还没开始：到开始日每小时那次扫描会放开
          const waiting = (credits.data?.awaiting ?? 0) - r.released;
          const later = waiting > 0 && startsAt > today ? `，等次数的成果到 ${dotted(startsAt).slice(5)} 自动放开` : '';
          message.success(`续约已登记${r.released > 0 ? `，放开了 ${r.released} 份成果` : ''}${later}`);
          onClose();
        },
        onError: (err) => message.error(err.message),
      },
    );
  };

  const subtitle = org
    ? org.contractEndsAt
      ? expired
        ? `${org.name} · 年度服务已于 ${dotted(org.contractEndsAt)} 到期`
        : `${org.name} · 现在的合同到 ${dotted(org.contractEndsAt)}`
      : org.name
    : '';

  return (
    <Modal
      open
      width={600}
      onCancel={close}
      closeIcon={<CloseOutlined aria-label="关闭" />}
      title={
        <div>
          <div style={{ ...type.subtitle, fontWeight: weight.strong }}>登记续约</div>
          <div style={{ ...type.body, fontWeight: 400, color: gy.secondary, marginTop: 4 }}>{subtitle}</div>
        </div>
      }
      footer={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {org && gaps.length > 0 && (
            <div role="status" style={{ textAlign: 'right', ...type.caption, color: gy.secondary }}>
              还差：{gaps.join('、')}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={close}>取消</Button>
            <Button type="primary" onClick={submit} disabled={!org || gaps.length > 0} loading={renew.isPending}>
              登记续约
            </Button>
          </div>
        </div>
      }
    >
      {detail.isPending ? (
        <Loading rows={8} card={false} />
      ) : detail.isError ? (
        <div role="alert" style={{ ...type.body, color: gy.error }}>
          {detail.error.message}{' '}
          <button type="button" style={linkButton} onClick={() => void detail.refetch()}>
            重新加载
          </button>
        </div>
      ) : (
        org && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, paddingTop: 8 }}>
            <ContractFields
              orgId={orgId}
              value={contract}
              onChange={(patch) => {
                setContract((c) => ({ ...c, ...patch }));
                setDirty(true);
              }}
              paymentNote="没到账不能登记续约"
              periodHint={
                expired || !org.contractEndsAt
                  ? '新合同生效后客户就能新建任务。'
                  : `新合同要接着现在的合同，到期日要晚于 ${dotted(org.contractEndsAt)}。`
              }
            />
          </div>
        )
      )}
    </Modal>
  );
}
