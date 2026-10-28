import { PhoneOutlined, WechatOutlined } from '@ant-design/icons';
import { App, Button, Modal } from 'antd';
import { useState, type ReactNode } from 'react';
import wechatQr from '../assets/wechat-qr.svg';
import { gy } from '../theme/tokens';

// 耕云对外联系方式（Martin 10-28 提供）：电话 + 企业微信二维码（二维码暂为占位图）
export const GENGYUN_PHONE = '0752-5200831';

// 「联系耕云」：点开显示电话和微信二维码。trigger 不传时显示为文字链接
export function ContactLink({
  children = '联系耕云',
  trigger,
  title = '联系耕云',
  hint,
}: {
  children?: ReactNode;
  trigger?: (open: () => void) => ReactNode;
  title?: string;
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const { message } = App.useApp();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(GENGYUN_PHONE);
      message.success('电话号码已复制');
    } catch {
      message.info(`电话：${GENGYUN_PHONE}`);
    }
  };

  return (
    <>
      {trigger ? (
        trigger(() => setOpen(true))
      ) : (
        <Button type="link" style={{ padding: 0, height: 'auto' }} onClick={() => setOpen(true)}>
          {children}
        </Button>
      )}
      <Modal open={open} title={title} footer={null} width={400} onCancel={() => setOpen(false)} destroyOnHidden>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, paddingTop: 8 }}>
          {hint && <p style={{ margin: 0, fontSize: 14, lineHeight: '22px', color: gy.secondary }}>{hint}</p>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <PhoneOutlined style={{ fontSize: 18, color: gy.primary }} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 13, color: gy.secondary }}>电话</span>
              <span style={{ fontSize: 20, lineHeight: '28px', fontWeight: 500, color: gy.text, userSelect: 'all' }}>{GENGYUN_PHONE}</span>
            </div>
            <Button onClick={() => void copy()}>复制</Button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, paddingTop: 16, borderTop: `1px solid ${gy.split}` }}>
            <img src={wechatQr} alt="耕云微信二维码" width={120} height={120} style={{ borderRadius: 6, border: `1px solid ${gy.split}` }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 500, color: gy.text }}>
                <WechatOutlined style={{ color: gy.success }} />
                微信扫码联系
              </span>
              <span style={{ fontSize: 13, lineHeight: '20px', color: gy.secondary }}>用手机微信扫一扫，添加耕云客服。</span>
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}
