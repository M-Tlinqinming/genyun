import { chinaToday, UPLOAD_RULES } from '@genyun/shared';
import { App, Button, Checkbox, DatePicker, Input, InputNumber, Popover } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { uploadContractFile, type ContractFile } from '../../api/operator';
import { inlineUrl } from '../../api/workup';
import { linkButtonSmall } from '../../components/ui';
import { gy } from '../../theme/tokens';

export const hint: CSSProperties = { fontSize: 12, lineHeight: '20px', color: gy.secondary, marginTop: 8 };
export const fieldLabel: CSSProperties = { display: 'block', fontSize: 14, lineHeight: '22px', color: gy.text, marginBottom: 8 };

export function Field({
  label,
  children,
  id,
  required = true,
  style,
}: {
  label: string;
  children: ReactNode;
  id: string;
  required?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div style={{ flex: 1, minWidth: 0, ...style }}>
      <label htmlFor={id} style={fieldLabel}>
        {label}
        {required && <span style={{ color: gy.error }}> *</span>}
      </label>
      {children}
    </div>
  );
}

const sizeText = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const monthDay = (iso: string) => chinaToday(new Date(iso)).slice(5).replace('-', '.');

/** 开通、登记续约共用的合同部分 */
export interface ContractDraftState {
  contractNumber: string;
  purchasedCredits: number | null;
  giftCredits: number | null;
  giftCampaign: string;
  file: ContractFile | null;
  paymentReceived: boolean;
  period: [Dayjs | null, Dayjs | null] | null;
}

export const emptyContractDraft: ContractDraftState = {
  contractNumber: '',
  purchasedCredits: null,
  giftCredits: 0,
  giftCampaign: '',
  file: null,
  paymentReceived: false,
  period: null,
};

/** 计费规则（开通、续约弹窗「合同款已到账」后面） */
export function BillingRules() {
  return (
    <Popover
      trigger="click"
      content={
        <div style={{ maxWidth: 280, fontSize: 12, lineHeight: '20px' }}>
          专家交付成果才算 1 次；重新打开再交付、撤回重发不再算。先扣赠送的，再扣购买的。次数跟合同一起到期。
        </div>
      }
    >
      <button type="button" style={{ ...linkButtonSmall, fontSize: 12, lineHeight: '20px' }}>
        计费规则
      </button>
    </Popover>
  );
}

/**
 * 合同编号、合同购买次数、赠送次数和活动名称、已签合同原件（选填）、合同款已到账、合同有效期。
 * paymentNote：到账下面那句（开通「没到账不能开通」，续约「没到账不能登记续约」）；periodHint：有效期下面的提示
 */
export function ContractFields({
  orgId,
  value,
  onChange,
  paymentNote,
  periodHint,
  defaultPickerValue,
}: {
  orgId: string;
  value: ContractDraftState;
  onChange: (patch: Partial<ContractDraftState>) => void;
  paymentNote: string;
  periodHint: string;
  defaultPickerValue?: [Dayjs, Dayjs];
}) {
  const { message } = App.useApp();
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const { file } = value;

  const upload = async (picked: File | undefined) => {
    if (!picked) return;
    setUploadError(null);
    if (picked.size > UPLOAD_RULES.contract.maxBytes) {
      setUploadError('合同原件超过 20 MB。请降低扫描分辨率后重新上传');
      return;
    }
    setUploading(true);
    try {
      onChange({ file: await uploadContractFile(orgId, picked) });
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

  const hasGift = (value.giftCredits ?? 0) > 0;

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 16 }}>
          <Field label="合同编号" id={`${id}-number`}>
            <Input
              id={`${id}-number`}
              value={value.contractNumber}
              onChange={(e) => onChange({ contractNumber: e.target.value })}
              placeholder="如：GY-HT-2026-018"
              maxLength={50}
            />
          </Field>
          <Field label="合同购买次数" id={`${id}-purchased`}>
            <InputNumber
              id={`${id}-purchased`}
              min={0}
              max={100000}
              precision={0}
              value={value.purchasedCredits}
              onChange={(v) => onChange({ purchasedCredits: v })}
              suffix="次"
              style={{ width: '100%' }}
            />
          </Field>
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          <Field label="赠送次数（没有填 0）" id={`${id}-gift`} required={false}>
            <InputNumber
              id={`${id}-gift`}
              min={0}
              max={100000}
              precision={0}
              value={value.giftCredits}
              onChange={(v) => onChange({ giftCredits: v })}
              suffix="次"
              style={{ width: '100%' }}
            />
          </Field>
          <Field label="活动名称（有赠送时填）" id={`${id}-campaign`} required={false}>
            <Input
              id={`${id}-campaign`}
              value={value.giftCampaign}
              disabled={!hasGift}
              onChange={(e) => onChange({ giftCampaign: e.target.value })}
              placeholder={hasGift ? '如：新客户开通活动' : undefined}
              maxLength={50}
            />
          </Field>
        </div>
      </div>

      <div>
        <span style={fieldLabel}>已签合同原件（选填）</span>
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
        <div style={hint}>双方盖章的 PDF，最大 20 MB，仅运营可见。</div>
      </div>

      <div>
        <Checkbox checked={value.paymentReceived} onChange={(e) => onChange({ paymentReceived: e.target.checked })}>
          合同款已到账
        </Checkbox>
        <div style={{ ...hint, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>{paymentNote} · 专家交付才算 1 次</span>
          <BillingRules />
        </div>
      </div>

      <div>
        <label htmlFor={`${id}-period`} style={fieldLabel}>
          合同有效期 <span style={{ color: gy.error }}>*</span>
        </label>
        <DatePicker.RangePicker
          id={{ start: `${id}-period` }}
          value={value.period}
          onChange={(v) => onChange({ period: v as [Dayjs | null, Dayjs | null] | null })}
          format="YYYY.MM.DD"
          placeholder={['开始日', '到期日']}
          defaultPickerValue={defaultPickerValue ?? [dayjs(), dayjs().add(1, 'year')]}
          style={{ width: '100%' }}
        />
        <div style={hint}>{periodHint}</div>
      </div>
    </>
  );
}

/** 合同部分 → 接口要的字段（开通、续约共用） */
export function contractPayload(v: ContractDraftState) {
  return {
    contractNumber: v.contractNumber,
    purchasedCredits: v.purchasedCredits,
    giftCredits: v.giftCredits ?? 0,
    giftCampaign: (v.giftCredits ?? 0) > 0 ? v.giftCampaign : null,
    contractFileId: v.file?.id ?? null,
    paymentReceived: v.paymentReceived,
  };
}
