import { CALL_TIMES, onSiteRequestSchema, type CallTime } from '@genyun/shared';
import { CheckOutlined, CloseOutlined } from '@ant-design/icons';
import { App, Button, Form, Input, Modal } from 'antd';
import { useState, type ReactNode } from 'react';
import { useRequestOnSite, useTaskReview, type OnSiteRequest } from '../../api/tasks';
import { gy } from '../../theme/tokens';

const muted = '#3F4A5C';
// 「需要帮忙整理」先显示几项，其余收起
const SHOWN_ITEMS = 4;

interface Values {
  contactName: string;
  contactPhone: string;
  note?: string;
}

// 预约耕云上门（12 页「S05 · 预约上门弹窗」）：联系人、电话按任务联系人带出；需要帮忙的内容默认带出稍后补的项。
// 提交后同一个弹窗换成「已收到」
export function OnSiteDialog({
  taskId,
  open,
  onClose,
  withLaterItems = true,
}: {
  taskId: string;
  open: boolean;
  onClose: () => void;
  // false：还没开始填（S00），不带出待补项
  withLaterItems?: boolean;
}) {
  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      closable={false}
      width={520}
      destroyOnHidden
      styles={{ container: { padding: 0, borderRadius: 10 } }}
    >
      <DialogBody taskId={taskId} onClose={onClose} withLaterItems={withLaterItems} />
    </Modal>
  );
}

function DialogBody({ taskId, onClose, withLaterItems }: { taskId: string; onClose: () => void; withLaterItems: boolean }) {
  const review = useTaskReview(taskId);
  const request = useRequestOnSite(taskId);
  const { message } = App.useApp();
  const [form] = Form.useForm<Values>();
  const [callTime, setCallTime] = useState<CallTime | undefined>();
  const [items, setItems] = useState<string[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [done, setDone] = useState<OnSiteRequest | null>(null);

  if (done) return <Received phone={done.contactPhone} onClose={onClose} />;
  if (!review.data) return <div style={{ height: 320 }} aria-busy="true" />;

  const later = withLaterItems ? review.data.review.steps.flatMap((s) => s.later) : [];
  const helpItems = items ?? later;
  const shown = expanded ? helpItems : helpItems.slice(0, SHOWN_ITEMS);

  const submit = (values: Values) => {
    const parsed = onSiteRequestSchema.safeParse({ ...values, callTime, helpItems });
    if (!parsed.success) {
      message.error(parsed.error.issues[0]?.message ?? '请检查输入');
      return;
    }
    request.mutate(parsed.data, {
      onSuccess: setDone,
      onError: (err) => message.error(err.message),
    });
  };

  return (
    <Form
      form={form}
      layout="vertical"
      requiredMark={false}
      initialValues={{ contactName: review.data.contact.name, contactPhone: review.data.contact.phone }}
      onFinish={submit}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '24px 24px 16px' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h2 style={{ margin: 0, fontSize: 18, lineHeight: '26px', fontWeight: 600, color: gy.text }}>请耕云专家上门</h2>
          <p style={{ margin: 0, fontSize: 13, lineHeight: '20px', color: gy.secondary }}>
            留下联系方式，耕云会电话联系您，商量上门的时间和内容。
          </p>
        </div>
        <button type="button" aria-label="关闭" onClick={onClose} style={iconButton}>
          <CloseOutlined />
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '8px 24px 20px' }}>
        <div>
          <div style={{ display: 'flex', gap: 12 }}>
            <Form.Item
              name="contactName"
              label="联系人 *"
              style={{ flex: 1, margin: 0 }}
              rules={[{ required: true, whitespace: true, message: '请填写联系人' }]}
            >
              <Input maxLength={50} />
            </Form.Item>
            <Form.Item
              name="contactPhone"
              label="联系电话 *"
              style={{ flex: 1, margin: 0 }}
              rules={[
                { required: true, whitespace: true, message: '请填写联系电话' },
                { pattern: /^[\d\s\-+()（）]+$/, message: '电话只能填数字、空格和短横线' },
              ]}
            >
              <Input maxLength={30} inputMode="tel" />
            </Form.Item>
          </div>
          <div style={{ marginTop: 8, fontSize: 12, lineHeight: '18px', color: gy.tertiary }}>已按任务联系人带出，可修改</div>
        </div>

        <Section label="方便接电话的时间">
          <div role="radiogroup" aria-label="方便接电话的时间" style={{ display: 'flex', gap: 8 }}>
            {(Object.keys(CALL_TIMES) as CallTime[]).map((k) => {
              const on = callTime === k;
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setCallTime(on ? undefined : k)}
                  style={{
                    height: 30,
                    padding: '0 12px',
                    borderRadius: 15,
                    border: `1px solid ${on ? gy.primary : '#D9D9D9'}`,
                    background: on ? gy.selected : gy.surface,
                    color: on ? gy.primary : gy.text,
                    fontSize: 13,
                    lineHeight: '20px',
                    cursor: 'pointer',
                  }}
                >
                  {CALL_TIMES[k]}
                </button>
              );
            })}
          </div>
        </Section>

        <Section
          label="需要帮忙整理"
          hint={later.length > 0 ? `已带出待补的 ${later.length} 项，可删减` : '选填，也可以写在备注里'}
        >
          {helpItems.length > 0 && (
            <ul
              aria-label="需要帮忙整理"
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 6,
                margin: 0,
                padding: '10px 12px',
                listStyle: 'none',
                borderRadius: 6,
                border: '1px solid #D9D9D9',
              }}
            >
              {shown.map((item) => (
                <li
                  key={item}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '2px 8px',
                    borderRadius: 4,
                    background: gy.neutralBg,
                    fontSize: 12,
                    lineHeight: '18px',
                    color: muted,
                  }}
                >
                  {item}
                  <button
                    type="button"
                    aria-label={`删去${item}`}
                    onClick={() => setItems(helpItems.filter((x) => x !== item))}
                    style={{ ...iconButton, fontSize: 10, color: gy.tertiary }}
                  >
                    <CloseOutlined />
                  </button>
                </li>
              ))}
              {helpItems.length > SHOWN_ITEMS && (
                <li>
                  <button
                    type="button"
                    onClick={() => setExpanded(!expanded)}
                    style={{ ...iconButton, padding: '2px 8px', fontSize: 12, lineHeight: '18px', color: gy.primary }}
                  >
                    {expanded ? '收起' : `还有 ${helpItems.length - SHOWN_ITEMS} 项`}
                  </button>
                </li>
              )}
            </ul>
          )}
        </Section>

        <Section label="备注">
          <Form.Item name="note" noStyle>
            <Input.TextArea aria-label="备注" autoSize={{ minRows: 2, maxRows: 5 }} maxLength={500} />
          </Form.Item>
        </Section>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '16px 24px',
          borderTop: '1px solid #EEF0F3',
        }}
      >
        <span style={{ flex: 1, fontSize: 12, lineHeight: '18px', color: gy.tertiary }}>上门费用与时间由耕云电话沟通确认</span>
        <Button onClick={onClose}>取消</Button>
        <Button type="primary" htmlType="submit" loading={request.isPending}>
          提交
        </Button>
      </div>
    </Form>
  );
}

function Section({ label, hint = '选填', children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 14, lineHeight: '22px', color: gy.text }}>{label}</span>
        <span style={{ fontSize: 12, lineHeight: '18px', color: gy.tertiary }}>{hint}</span>
      </div>
      {children}
    </div>
  );
}

function Received({ phone, onClose }: { phone: string; onClose: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '40px 32px 32px' }}>
      <span
        style={{
          width: 48,
          height: 48,
          borderRadius: 24,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#E8F5EE',
          color: gy.success,
          fontSize: 18,
        }}
      >
        <CheckOutlined />
      </span>
      <h2 style={{ margin: '4px 0 0', fontSize: 18, lineHeight: '26px', fontWeight: 600, color: gy.text }}>
        已收到您的上门需求
      </h2>
      <p style={{ margin: 0, fontSize: 14, lineHeight: '22px', color: gy.secondary, textAlign: 'center' }}>
        耕云会尽快打 {phone} 联系您。
        <br />
        编制任务照常进行，补齐的资料随时可以上传。
      </p>
      <Button style={{ marginTop: 8 }} onClick={onClose}>
        知道了
      </Button>
    </div>
  );
}

// 虚线提示条：S00「资料不齐、没人手整理？」、S05「稍后补超过 5 项」。已提交过的显示提交日期
export function OnSiteBanner({
  title,
  description,
  submittedAt,
  onBook,
}: {
  title: string;
  description: string;
  submittedAt?: string;
  onBook: () => void;
}) {
  return (
    <section
      aria-label="预约耕云上门"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 20,
        padding: '20px 32px',
        borderRadius: 12,
        border: '1px dashed #C9CED6',
        background: gy.surface,
      }}
    >
      <span
        style={{
          width: 48,
          height: 48,
          flexShrink: 0,
          borderRadius: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#F1F3F6',
        }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"
            fill="none"
            stroke={muted}
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <circle cx="12" cy="10" r="2.4" fill="none" stroke={muted} strokeWidth="1.6" />
        </svg>
      </span>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 16, lineHeight: '24px', fontWeight: 600, color: gy.text }}>{title}</span>
        <span style={{ fontSize: 14, lineHeight: '22px', color: gy.secondary }}>{description}</span>
      </div>
      {submittedAt ? (
        <span style={{ flexShrink: 0, fontSize: 13, lineHeight: '20px', color: gy.success }}>
          <CheckOutlined style={{ marginRight: 6 }} />
          已提交上门需求 · {shortDate(submittedAt)}
        </span>
      ) : (
        <Button size="large" style={{ flexShrink: 0, fontWeight: 500, fontSize: 15, paddingInline: 20 }} onClick={onBook}>
          预约上门
        </Button>
      )}
    </section>
  );
}

// 「10.27」
export function shortDate(iso: string): string {
  const [, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(iso)).split('-');
  return `${Number(m)}.${d}`;
}

const iconButton = {
  padding: 0,
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  color: gy.tertiary,
  fontSize: 14,
  lineHeight: 1,
} as const;
