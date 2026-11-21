import { CloseOutlined } from '@ant-design/icons';
import {
  CREDIT_ADJUST_TYPES,
  CREDIT_ENTRY_POOL,
  CREDIT_ENTRY_TYPE_LABELS,
  creditAdjustSchema,
  type CreditAdjustType,
} from '@genyun/shared';
import { App, Button, Input, InputNumber, Modal, Select } from 'antd';
import { useId, useState, type CSSProperties } from 'react';
import { useAdjustCredits, useOrgCredits } from '../../api/operator';
import { linkButtonSmall, Loading } from '../../components/ui';
import { gy, type, weight } from '../../theme/tokens';
import { Field, hint } from './ContractFields';

const TYPE_NOTE: Record<CreditAdjustType, string> = {
  top_up: '合同外加买，线下已收款',
  gift: '活动送的，不算收入',
  compensation: '因耕云的原因补给客户',
  contract_purchase: '更正开通或续约时登记的次数',
};
const POOL_LABEL = { gift: '赠送', purchase: '购买' } as const;

const dotted = (date: string) => date.replaceAll('-', '.');

/**
 * 调整次数（Paper 16 页「调整次数」弹窗）：四种类型、加还是减、活动名称（赠送时）、原因。
 * 画板一排画了三张类型卡片；按开发计划还有「合同购买」，做成 2×2 四张。
 * 次数记在 adjustTarget 那份合同上（生效的合同里到期最晚的；没有就挑还没开始的里最早开始的）
 */
export function AdjustCreditsModal({
  orgId,
  orgName,
  onClose,
  onRenew,
}: {
  orgId: string;
  orgName: string;
  onClose: () => void;
  /** 没有可加的合同时，打开登记续约 */
  onRenew: () => void;
}) {
  const credits = useOrgCredits(orgId);
  const adjust = useAdjustCredits(orgId);
  const { message } = App.useApp();
  const id = useId();
  const [kind, setKind] = useState<CreditAdjustType>('top_up');
  const [sign, setSign] = useState<1 | -1>(1);
  const [count, setCount] = useState<number | null>(null);
  const [campaign, setCampaign] = useState('');
  const [reason, setReason] = useState('');

  const c = credits.data;
  const target = c?.adjustTarget ?? null;
  const pool = CREDIT_ENTRY_POOL[kind];
  const poolName = POOL_LABEL[pool];
  const n = count ?? 0;
  const delta = sign * n;
  const left = target?.balance[pool] ?? 0;
  const overDecrease = sign === -1 && n > 0 && n > left;
  const parsed = creditAdjustSchema.safeParse({ type: kind, delta, reason, campaign: kind === 'gift' ? campaign : null });
  const canSubmit = !!c && !!target && parsed.success && !overDecrease;

  const submit = () => {
    if (!parsed.success || !canSubmit) return;
    adjust.mutate(parsed.data, {
      onSuccess: (r) => {
        message.success(`已调整${r.released > 0 ? `，放开了 ${r.released} 份成果` : ''}`);
        onClose();
      },
      onError: (err) => message.error(err.message),
    });
  };

  const subtitle = c
    ? `${orgName} · 现在剩余 ${c.remaining.total} 次（赠送 ${c.remaining.gift} 次，购买 ${c.remaining.purchase} 次）`
    : orgName;

  // 预览：还没开始的合同按那份合同上的余额算，生效的按现在的剩余算
  const preview = () => {
    if (!c || !target) return null;
    const before = target.upcoming
      ? { total: target.balance.gift + target.balance.purchase, pool: target.balance[pool] }
      : { total: c.remaining.total, pool: c.remaining[pool] };
    const after = { total: before.total + delta, pool: before.pool + delta };
    const head = target.upcoming ? `确认后：${dotted(target.startsAt)} 起可用` : '确认后：剩余';
    const line = `${head} ${before.total} 次 → ${after.total} 次（${poolName} ${before.pool} 次 → ${after.pool} 次）`;
    const note = target.upcoming
      ? `这家客户现在的合同还没开始。这次加的次数记在 ${dotted(target.startsAt)} – ${dotted(target.endsAt)} 的合同上，到 ${dotted(target.startsAt)} 起生效。`
      : sign === 1
        ? `马上生效，加的次数跟合同一起到期（${dotted(target.endsAt)}）。交付成果时先扣赠送的，再扣购买的。如果这家客户有因为次数用完被锁住的成果，会按任务生成的先后自动解锁，每份算 1 次。`
        : '马上生效，不会影响已经交付、已经放开的成果。';
    return (
      <div style={{ background: gy.neutralBg, borderRadius: 6, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {n > 0 && <div style={{ ...type.body, fontWeight: weight.strong, color: gy.text }}>{line}</div>}
        <div style={{ ...type.caption, color: gy.secondary }}>{note}</div>
      </div>
    );
  };

  const card = (t: CreditAdjustType): CSSProperties => {
    const on = t === kind;
    return {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-start',
      gap: 2,
      padding: '12px 16px',
      borderRadius: 6,
      textAlign: 'left',
      cursor: 'pointer',
      border: `1px solid ${on ? gy.primary : gy.controlLine}`,
      background: on ? gy.selected : gy.surface,
      font: 'inherit',
    };
  };

  return (
    <Modal
      open
      width={600}
      onCancel={onClose}
      closeIcon={<CloseOutlined aria-label="关闭" />}
      title={
        <div>
          <div style={{ ...type.subtitle, fontWeight: weight.strong }}>调整次数</div>
          <div style={{ ...type.body, fontWeight: 400, color: gy.secondary, marginTop: 4 }}>{subtitle}</div>
        </div>
      }
      footer={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {c && !target && (
            <div role="status" style={{ textAlign: 'right', ...type.caption, color: gy.warning }}>
              没有有效合同，请先登记续约{' '}
              <button type="button" style={{ ...linkButtonSmall, ...type.caption }} onClick={onRenew}>
                登记续约
              </button>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" onClick={submit} disabled={!canSubmit} loading={adjust.isPending}>
              确认调整
            </Button>
          </div>
        </div>
      }
    >
      {credits.isPending ? (
        <Loading rows={6} card={false} />
      ) : credits.isError ? (
        <div role="alert" style={{ ...type.body, color: gy.error }}>
          {credits.error.message}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, paddingTop: 8 }}>
          <div role="radiogroup" aria-label="这次调整是哪一种">
            <div style={{ ...type.body, color: gy.text, marginBottom: 8 }}>
              这次调整是哪一种<span style={{ color: gy.error }}> *</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {CREDIT_ADJUST_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={t === kind}
                  style={card(t)}
                  onClick={() => setKind(t)}
                >
                  <span style={{ ...type.body, color: t === kind ? gy.primary : gy.text, fontWeight: t === kind ? weight.strong : 400 }}>
                    {CREDIT_ENTRY_TYPE_LABELS[t]}
                  </span>
                  <span style={{ ...type.caption, color: gy.secondary }}>{TYPE_NOTE[t]}</span>
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 16 }}>
              <Field label="加还是减、几次" id={`${id}-count`}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Select<1 | -1>
                    aria-label="加还是减"
                    value={sign}
                    onChange={setSign}
                    style={{ width: 96, flexShrink: 0 }}
                    options={[
                      { value: 1, label: '增加' },
                      { value: -1, label: '减少' },
                    ]}
                  />
                  <InputNumber
                    id={`${id}-count`}
                    min={1}
                    max={1000}
                    precision={0}
                    value={count}
                    onChange={(v) => setCount(v)}
                    suffix="次"
                    status={overDecrease ? 'error' : undefined}
                    style={{ flex: 1 }}
                  />
                </div>
              </Field>
              <Field label="活动名称（赠送时填）" id={`${id}-campaign`} required={false}>
                <Input
                  id={`${id}-campaign`}
                  value={kind === 'gift' ? campaign : ''}
                  disabled={kind !== 'gift'}
                  onChange={(e) => setCampaign(e.target.value)}
                  maxLength={50}
                />
              </Field>
            </div>
            {overDecrease && (
              <div role="alert" style={{ ...type.caption, color: gy.error }}>
                {left > 0 ? `这份合同的${poolName}次数只剩 ${left} 次，最多减 ${left} 次` : `这份合同的${poolName}次数已经是 0 次，不能再减`}
              </div>
            )}
          </div>

          <div>
            <Field label="原因" id={`${id}-reason`}>
              <Input.TextArea
                id={`${id}-reason`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={200}
                style={{ height: 76, resize: 'none' }}
              />
            </Field>
            <div style={hint}>必须写。每一次手动调整都会连同原因、操作人和时间记进「次数记录」。</div>
          </div>

          {preview()}
        </div>
      )}
    </Modal>
  );
}
